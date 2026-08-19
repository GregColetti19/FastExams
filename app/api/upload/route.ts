import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'
import { internalBaseUrl } from '@/lib/internal-url'
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

    const {
      data: { user },
    } = await supabase.auth.getUser()

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
      // Diagnostic: an RLS denial here is almost always one of two things —
      // the path lacks the owner prefix, or the request reached storage without
      // the user's JWT (role 'anon' instead of 'authenticated'). Log both facts
      // rather than inferring them from the generic 403.
      const { data: sess } = await supabase.auth.getSession()
      console.error(
        '[upload] storage denied — path=%s userId=%s hasSession=%s tokenRole=%s',
        storagePath,
        user.id,
        Boolean(sess?.session),
        (() => {
          const t = sess?.session?.access_token
          if (!t) return 'none(anon key used)'
          try {
            return JSON.parse(
              Buffer.from(t.split('.')[1] + '===', 'base64url').toString()
            ).role
          } catch {
            return 'unparseable'
          }
        })()
      )
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

    // Trigger processing before responding, NOT in setImmediate. Work scheduled
    // after the response is not guaranteed to run: the runtime may tear the
    // invocation down once the response is sent, dropping the callback silently.
    // The file then sits at 'processing' forever with no error anywhere — the
    // converter never receives a request, because nothing ever failed.
    //
    // process-file returns as soon as conversion finishes and the client polls
    // status afterwards, so awaiting here costs the upload response nothing that
    // the user was not already waiting on.
    try {
      const res = await fetch(`${internalBaseUrl()}/api/process-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '',
        },
        body: JSON.stringify({ fileId: newFile.id, fileRole }),
      })
      if (!res.ok) throw new Error(`process-file returned ${res.status}`)
    } catch (error) {
      // Record the failure on the row: the upload itself succeeded, so the
      // response stays 201, but the file must not be left claiming 'processing'.
      const message = error instanceof Error ? error.message : String(error)
      console.error('Failed to trigger processing:', error)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('files') as any)
        .update({ processing_status: 'error', processing_error: `Could not start processing: ${message}` })
        .eq('id', newFile.id)
    }

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
