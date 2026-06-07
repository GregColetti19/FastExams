import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'
import { convertFile } from '@/lib/processing/converter-client'
import { detectLanguage } from '@/lib/processing/language-detector'
import { buildChunks } from '@/lib/processing/chunk-builder'

export async function POST(request: NextRequest) {
  try {
    const { fileId, fileRole } = await request.json()

    if (!fileId) {
      return NextResponse.json({ error: 'fileId required', code: 'MISSING_FILE_ID' }, { status: 400 })
    }

    const supabase = await createServerClient_()

    // Fetch file record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: file } = await supabase.from('files').select('*').eq('id', fileId).single() as any

    if (!file) {
      return NextResponse.json({ error: 'File not found', code: 'FILE_NOT_FOUND' }, { status: 404 })
    }

    // Update status to processing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('files') as any)
      .update({ processing_status: 'processing' })
      .eq('id', fileId)

    try {
      // Download file from Supabase Storage
      const { data: fileBuffer, error: downloadError } = await supabase.storage
        .from('uploads')
        .download(file.storage_path) as any

      if (downloadError || !fileBuffer) {
        throw new Error('Failed to download file from storage')
      }

      // Convert file to markdown
      const buffer = Buffer.from(await (fileBuffer as Blob).arrayBuffer())
      const convertResult = await convertFile(buffer, file.file_type)

      // Detect language
      const langResult = detectLanguage(convertResult.markdown)

      // Build chunks
      const chunks = buildChunks(convertResult.markdown, fileId, 1, langResult.code)

      // Insert chunks into database
      if (chunks.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: chunkError } = await supabase.from('chunks').insert(chunks as any)

        if (chunkError) {
          throw new Error(`Failed to insert chunks: ${chunkError.message}`)
        }
      }

      // Update exam with detected language if not already set
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: exam } = await supabase
        .from('exams')
        .select('language')
        .eq('id', file.exam_id)
        .single() as any

      if (exam && !exam.language) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('exams') as any)
          .update({ language: langResult.code })
          .eq('id', file.exam_id)
      }

      // Trigger question generation (stub for now, Phase 3 implements this)
      // In production: call /api/generate-questions asynchronously
      if (fileRole === 'theory') {
        // TODO: Phase 3 - Call extract-topics and generate-questions
      } else if (fileRole === 'past_exam') {
        // TODO: Phase 3 - Call extract-past-exam-questions and match-to-theory
      }

      // Update file status to done
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('files') as any)
        .update({ processing_status: 'done' })
        .eq('id', fileId)

      return NextResponse.json(
        {
          success: true,
          fileId,
          chunksCreated: chunks.length,
          language: langResult.code,
          converterUsed: convertResult.converter_used,
        },
        { status: 200 }
      )
    } catch (error) {
      // Update file status to error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('files') as any)
        .update({
          processing_status: 'error',
          processing_error: errorMessage,
        })
        .eq('id', fileId)

      console.error(`Processing failed for file ${fileId}:`, error)

      return NextResponse.json(
        {
          success: false,
          fileId,
          error: errorMessage,
          code: 'PROCESSING_FAILED',
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Process-file endpoint error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
