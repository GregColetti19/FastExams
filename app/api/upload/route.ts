import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_, getCurrentUser } from '@/lib/supabase/server'
import { checkUploadQuota, windowStart } from '@/lib/upload-quota'
import { FileRole } from '@/types'

// 50MB is the Supabase free-tier per-file storage cap. Keeping the app limit at
// the real ceiling means an oversized file is rejected instantly instead of
// uploading for minutes and then 413ing at storage. Raise both together if the
// project moves to a paid tier.
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '50')

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient_()

    const user = await getCurrentUser(supabase)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const examId = formData.get('examId') as string
    const fileRole = formData.get('fileRole') as FileRole

    // Validation
    if (!file) {
      return NextResponse.json({ error: 'No file provided', code: 'NO_FILE' }, { status: 400 })
    }

    if (!examId) {
      return NextResponse.json({ error: 'examId required', code: 'MISSING_EXAM_ID' }, { status: 400 })
    }

    if (!fileRole || !['theory', 'past_exam'].includes(fileRole)) {
      return NextResponse.json({ error: 'Invalid fileRole', code: 'INVALID_FILE_ROLE' }, { status: 400 })
    }

    // Check file type
    const fileName = file.name.toLowerCase()
    let fileType: 'pdf' | 'pptx' | null = null

    if (fileName.endsWith('.pdf')) {
      fileType = 'pdf'
    } else if (fileName.endsWith('.pptx')) {
      fileType = 'pptx'
    } else {
      return NextResponse.json(
        { error: 'Only PDF and PPTX files are supported', code: 'INVALID_FILE_TYPE' },
        { status: 400 }
      )
    }

    // Check file size
    const fileSizeMB = file.size / (1024 * 1024)
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_FILE_SIZE_MB}MB limit`, code: 'FILE_TOO_LARGE' },
        { status: 400 }
      )
    }

    // Verify the exam exists AND belongs to the caller. RLS enforces this too;
    // the explicit filter keeps it correct if RLS is ever toggled off.
    const { data: exam } = await supabase
      .from('exams')
      .select('id')
      .eq('id', examId)
      .eq('user_id', user.id)
      .single() as any

    if (!exam) {
      return NextResponse.json({ error: 'Exam not found', code: 'EXAM_NOT_FOUND' }, { status: 404 })
    }

    // Daily upload budget. Checked before the storage write and before any AI
    // work, so a rejected upload costs nothing. RLS scopes `files` to the
    // caller, making this sum inherently per-user.
    const { data: recentFiles } = await supabase
      .from('files')
      .select('size_bytes')
      .gte('created_at', windowStart().toISOString()) as any

    const quota = checkUploadQuota(
      ((recentFiles ?? []) as Array<{ size_bytes: number | null }>).map((f) => f.size_bytes ?? 0),
      file.size
    )

    if (!quota.allowed) {
      return NextResponse.json(
        {
          error:
            `Daily upload limit reached (${quota.usedMB}MB of ${quota.budgetMB}MB used). ` +
            `${quota.remainingMB}MB left today — try again tomorrow or upload a smaller file.`,
          code: 'QUOTA_EXCEEDED',
        },
        { status: 429 }
      )
    }

    // Upload file to Supabase Storage
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    // Owner prefix is load-bearing, not cosmetic: storage RLS (migration 014)
    // authorises on the first path segment, so an object written without it is
    // readable by nobody. Must stay in sync with the policy predicate.
    const storagePath = `${user.id}/${Date.now()}-${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('uploads')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upload(storagePath, fileBuffer, { contentType: file.type }) as any

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      // Supabase storage returns statusCode '413' when the file exceeds the
      // bucket's size limit (distinct from our own MAX_FILE_SIZE_MB check above,
      // which only validates against the app-configured limit).
      const isTooLarge =
        (uploadError as any).statusCode === '413' ||
        String((uploadError as any).message).includes('maximum allowed size')
      if (isTooLarge) {
        return NextResponse.json(
          { error: 'File exceeds the storage size limit. Try a smaller file.', code: 'FILE_TOO_LARGE' },
          { status: 413 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to upload file', code: 'UPLOAD_FAILED' },
        { status: 500 }
      )
    }

    // Insert file record with pending status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fileRecord, error: dbError } = (await (supabase.from('files') as any)
      .insert([
        {
          exam_id: examId,
          file_name: fileName,
          file_type: fileType,
          file_role: fileRole,
          storage_path: storagePath,
          size_bytes: file.size,
          processing_status: 'pending',
        },
      ])
      .select()) as any

    if (dbError) {
      console.error('DB insert error:', dbError)
      return NextResponse.json(
        { error: 'Failed to save file record', code: 'DB_ERROR' },
        { status: 500 }
      )
    }

    const newFile = fileRecord?.[0]
    if (!newFile) {
      return NextResponse.json({ error: 'File record creation failed', code: 'DB_ERROR' }, { status: 500 })
    }

    // Kick off async processing (fire-and-forget for MVP)
    // In production, this would be a proper background queue
    setImmediate(async () => {
      try {
        await fetch(`${request.nextUrl.origin}/api/process-file`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '',
          },
          body: JSON.stringify({ fileId: newFile.id, fileRole }),
        })
      } catch (error) {
        console.error('Failed to trigger processing:', error)
      }
    })

    return NextResponse.json(
      {
        fileId: newFile.id,
        storagePath,
        processingStatus: 'pending',
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Upload endpoint error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
