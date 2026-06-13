import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'
import { convertFile } from '@/lib/processing/converter-client'
import { detectLanguage } from '@/lib/processing/language-detector'
import { buildChunks, splitChunksByTokens, toChunkRow } from '@/lib/processing/chunk-builder'
import { embedTexts } from '@/lib/ai/embeddings'

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

      // Build chunks, then size-split so heading-less docs (converters often
      // emit one giant section) become granular, embeddable units (~500 tokens).
      const chunks = splitChunksByTokens(
        buildChunks(convertResult.markdown, fileId, 1, langResult.code),
        500
      )

      // Embed for retrieval (best-effort — don't fail ingestion if embeddings do).
      let embeddings: number[][] = []
      if (chunks.length > 0) {
        try {
          embeddings = await embedTexts(chunks.map((c) => c.text))
        } catch (embedError) {
          console.error('Chunk embedding failed (continuing without):', embedError)
        }
      }

      // Map camelCase ContentChunk -> snake_case DB row (with embedding) and insert
      if (chunks.length > 0) {
        const rows = chunks.map((c, i) => toChunkRow(c, embeddings[i] ?? null))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: chunkError } = await supabase.from('chunks').insert(rows as any)

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

      // Update file status to generating_questions (before triggering async work)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('files') as any)
        .update({ processing_status: 'generating_questions' })
        .eq('id', fileId)

      // Trigger question generation
      const generateUrl = `${request.nextUrl.origin}/api/generate-questions`
      setImmediate(() => {
        fetch(generateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId, fileRole }),
        }).catch(async (error) => {
          console.error('Failed to trigger question generation:', error)
          // Write failure back to DB so client can see it
          try {
            const supabaseInner = await createServerClient_()
            await (supabaseInner.from('files') as any)
              .update({
                processing_status: 'error',
                processing_error: `Question generation trigger failed: ${error instanceof Error ? error.message : String(error)}`,
              })
              .eq('id', fileId)
          } catch (dbError) {
            console.error(`Failed to update file status for ${fileId}:`, dbError)
          }
        })
      })

      return NextResponse.json(
        {
          success: true,
          fileId,
          chunksCreated: chunks.length,
          language: langResult.code,
          converterUsed: convertResult.converter_used,
          processingStatus: 'generating_questions',
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
