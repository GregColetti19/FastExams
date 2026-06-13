import { PROMPTS, parseJsonResponse } from './prompts'
import { getClient, AI_MODEL } from './client'

export interface TheoryMatchResult {
  subtopicId: string
  matchScore: number
  matchedChunkId: string
}

export interface JustificationResult {
  justification: string
}

/**
 * Simple TF-IDF-style keyword matching between question and chunks
 */
export function scoreChunkMatch(
  questionText: string,
  chunkText: string
): number {
  const qWords = questionText.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
  const cWords = chunkText.toLowerCase().split(/\W+/).filter((w) => w.length > 3)

  if (qWords.length === 0 || cWords.length === 0) {
    return 0
  }

  const matches = qWords.filter((w) => cWords.includes(w)).length
  return matches / qWords.length
}

/**
 * Find best-matching chunk for a past exam question
 */
export function findBestMatchingChunk(
  questionText: string,
  chunks: Array<{ id: string; text: string; subtopicId: string }>
): {
  chunkId: string
  subtopicId: string
  score: number
} {
  let bestScore = 0
  let bestChunk = chunks[0]

  for (const chunk of chunks) {
    const score = scoreChunkMatch(questionText, chunk.text)
    if (score > bestScore) {
      bestScore = score
      bestChunk = chunk
    }
  }

  return {
    chunkId: bestChunk.id,
    subtopicId: bestChunk.subtopicId,
    score: bestScore,
  }
}

/**
 * Generate justification for a past exam question using matched theory content
 */
export async function generateJustification(
  questionText: string,
  correctAnswer: string,
  wrongOptions: string[],
  matchedChunkText: string,
  language: string = 'en'
): Promise<string> {
  const prompt = PROMPTS.justificationGeneration({
    language,
    question_text: questionText,
    correct_answer: correctAnswer,
    wrong_options: wrongOptions,
    matched_chunk_text: matchedChunkText,
  })

  const message = await getClient().messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  })

  const responseText =
    message.content[0].type === 'text' ? (message.content[0].text ?? '') : ''

  const parsed = parseJsonResponse(responseText) as JustificationResult

  return parsed.justification
}
