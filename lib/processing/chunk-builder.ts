/* eslint-disable @typescript-eslint/no-unused-vars */
import { ContentChunk } from '@/types'

/**
 * Map a ContentChunk (camelCase, from buildChunks) to a chunks-table row
 * (snake_case DB columns). Without this the insert dropped content_text,
 * candidate_subtopic, etc., breaking the theory pipeline downstream.
 */
export function toChunkRow(c: ContentChunk, embedding: number[] | null = null) {
  return {
    file_id: c.fileId,
    content_text: c.text,
    image_storage_path: c.imageStoragePath,
    has_image: c.hasImage,
    page_or_slide: c.pageOrSlide,
    candidate_topic: c.candidateTopic ?? null,
    candidate_subtopic: c.candidateSubtopic ?? null,
    language: c.language,
    embedding,
  }
}

export function buildChunks(
  markdown: string,
  fileId: string,
  _pageOrSlideCount: number = 1,
  language: string = 'en'
): ContentChunk[] {
  const chunks: ContentChunk[] = []

  // Split on ## (level-2 headings) to create chunks per section
  const sections = markdown.split(/^## /m).filter((s) => s.trim())

  // First section before any ## is the intro (if it exists)
  const introMatch = markdown.match(/^(.*?)\n## /s)
  let sectionIndex = 0

  if (introMatch && introMatch[1].trim()) {
    const introText = introMatch[1].trim()
    if (introText.length > 0) {
      chunks.push(createChunk(fileId, sectionIndex, introText, '', language, false))
      sectionIndex++
    }
  }

  // Process each ## section
  for (const section of sections) {
    const lines = section.split('\n')
    const heading = lines[0] || 'Untitled'
    const content = lines.slice(1).join('\n').trim()

    if (content.length > 0) {
      chunks.push(createChunk(fileId, sectionIndex, content, heading, language, false))
      sectionIndex++
    }
  }

  // If markdown had no ## sections, treat the whole thing as one chunk
  if (chunks.length === 0 && markdown.trim().length > 0) {
    chunks.push(createChunk(fileId, 0, markdown, '', language, false))
  }

  return chunks
}

function createChunk(
  fileId: string,
  pageOrSlide: number,
  text: string,
  heading: string,
  language: string,
  hasImage: boolean
): ContentChunk {
  return {
    fileId,
    pageOrSlide,
    text,
    imageStoragePath: null,
    hasImage,
    candidateTopic: extractHeading(text, '#'),
    candidateSubtopic: heading.trim(),
    language,
  }
}

function extractHeading(text: string, headingLevel: string = '#'): string | undefined {
  // Find the first heading in the text
  const match = text.match(new RegExp(`^${headingLevel}+\\s+(.+)$`, 'm'))
  return match ? match[1].trim() : undefined
}

/**
 * Estimate token count for a string (rough approximation: 1 token ≈ 4 chars)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Split chunks by target token size
 */
export function splitChunksByTokens(
  chunks: ContentChunk[],
  targetTokensPerChunk: number = 500
): ContentChunk[] {
  const result: ContentChunk[] = []
  let chunkIndex = 0

  for (const chunk of chunks) {
    const tokens = estimateTokens(chunk.text)

    if (tokens <= targetTokensPerChunk) {
      result.push(chunk)
      chunkIndex++
    } else {
      // Split this chunk by paragraphs
      const paragraphs = chunk.text.split('\n\n')
      let currentText = ''
      let currentTokens = 0

      for (const para of paragraphs) {
        const paraTokens = estimateTokens(para)

        if (currentTokens + paraTokens > targetTokensPerChunk && currentText.length > 0) {
          // Save current chunk and start new one
          result.push({
            ...chunk,
            pageOrSlide: chunkIndex,
            text: currentText.trim(),
          })
          chunkIndex++
          currentText = para
          currentTokens = paraTokens
        } else {
          currentText += (currentText ? '\n\n' : '') + para
          currentTokens += paraTokens
        }
      }

      if (currentText.trim().length > 0) {
        result.push({
          ...chunk,
          pageOrSlide: chunkIndex,
          text: currentText.trim(),
        })
        chunkIndex++
      }
    }
  }

  return result
}
