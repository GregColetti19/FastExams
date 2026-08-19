import { createServerClient_ } from '@/lib/supabase/server'
import { convertFile } from '@/lib/processing/converter-client'
import { detectLanguage } from '@/lib/processing/language-detector'
import { buildChunks, splitChunksByTokens, toChunkRow } from '@/lib/processing/chunk-builder'
import { embedTexts } from '@/lib/ai/embeddings'
import { inferSubject } from '@/lib/ai/infer-subject'

export type ProcessFileResult =
  | { ok: true; fileId: string; chunksCreated: number; language: string; converterUsed: string }
  | { ok: false; fileId: string; code: 'FILE_NOT_FOUND' | 'PROCESSING_FAILED'; error: string }

/**
 * Convert, chunk and embed one uploaded file, then mark it 'ready'.
 *
 * Lives here rather than only in the route so callers can run it in-process.
 * The upload route used to reach it over HTTP by fetching its own /api endpoint,
 * which had to resolve a base URL, pass the middleware gate and land in the
 * route context — it failed on each in turn (TLS against the proxy, then a 404).
 * A direct call has none of those failure modes.
 */
export async function processFileById(fileId: string): Promise<ProcessFileResult> {
  const supabase = await createServerClient_()

  // Fetch file record
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: file } = await supabase.from('files').select('*').eq('id', fileId).single() as any

  if (!file) {
    return { ok: false, fileId, code: 'FILE_NOT_FOUND', error: 'File not found' }
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

    // Update exam with detected language + inferred subject if not already set
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: exam } = await supabase
      .from('exams')
      .select('language, subject')
      .eq('id', file.exam_id)
      .single() as any

    if (exam && !exam.language) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('exams') as any)
        .update({ language: langResult.code })
        .eq('id', file.exam_id)
    }

    // Infer the course subject once per exam, from the first theory file.
    // Best-effort: inferSubject swallows its own errors and returns a neutral
    // default, so a failure here never blocks ingestion.
    if (exam && !exam.subject && file.file_role !== 'past_exam') {
      const inferred = await inferSubject(convertResult.markdown, langResult.code)
      if (inferred.inferred) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('exams') as any)
          .update({ subject: inferred.subject, subject_domain: inferred.domain })
          .eq('id', file.exam_id)
      }
    }

    // Conversion done. Mark the file 'ready' (converted, chunked, embedded)
    // but do NOT generate questions here. Generation is an exam-level step the
    // user triggers AFTER uploading all files, so the engine decides on the
    // full set (presence/absence of past exams). See /api/generate-exam.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('files') as any)
      .update({ processing_status: 'ready' })
      .eq('id', fileId)

    return {
      ok: true,
      fileId,
      chunksCreated: chunks.length,
      language: langResult.code,
      converterUsed: convertResult.converter_used,
    }
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

    return { ok: false, fileId, code: 'PROCESSING_FAILED', error: errorMessage }
  }
}
