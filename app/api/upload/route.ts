import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'
import { FileRole } from '@/types'

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '300')

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

    // Verify exam ownership
    const { data: exam } = await supabase
      .from('exams')
      .select('id')
      .eq('id', examId)
      .eq('user_id', user.id)
      .single() as any

    if (!exam) {
      return NextResponse.json({ error: 'Exam not found', code: 'EXAM_NOT_FOUND' }, { status: 404 })
    }

    // Upload file to Supabase Storage
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const storagePath = `${user.id}/${examId}/${Date.now()}-${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('uploads')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upload(storagePath, fileBuffer, { contentType: file.type }) as any

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
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
          headers: { 'Content-Type': 'application/json' },
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
