import { PROMPTS, parseJsonResponse } from './prompts'
import { getClient, getModelFor } from './client'
import { cosineSimilarity } from './embeddings'

export interface ChunkMatch {
  chunkId: string
  subtopicId: string | null
  score: number
  contentText: string
}

/**
 * pgvector RPC retrieval: find the best theory chunk for a question via Postgres
 * ANN search (ivfflat cosine index from migration 005+009). Returns the top hit.
 * Falls back to empty match on error so the caller can degrade gracefully.
 */
export async function matchChunkForQuestion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  examId: string,
  queryEmbedding: number[]
): Promise<ChunkMatch> {
  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: queryEmbedding,
    p_exam_id: examId,
    match_count: 5,
  })
  if (error || !data?.length) return { chunkId: '', subtopicId: null, score: 0, contentText: '' }
  const best = data[0]
  return {
    chunkId: best.id,
    subtopicId: best.subtopic_id,
    score: best.similarity,
    contentText: best.content_text,
  }
}

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
 * Embedding-based retrieval: find the theory chunk most semantically similar to
 * a question, by cosine similarity over precomputed embeddings. Replaces the
 * TF-IDF keyword overlap above (which misses paraphrase/synonyms, esp. in
 * Portuguese medical text). Chunks without embeddings are skipped.
 */
export function findBestChunkByEmbedding(
  queryEmbedding: number[],
  chunks: Array<{ id: string; subtopicId: string | null; embedding: number[] | null }>
): { chunkId: string; subtopicId: string | null; score: number } {
  let best = { chunkId: '', subtopicId: null as string | null, score: -1 }
  for (const c of chunks) {
    if (!c.embedding || c.embedding.length === 0) continue
    const score = cosineSimilarity(queryEmbedding, c.embedding)
    if (score > best.score) {
      best = { chunkId: c.id, subtopicId: c.subtopicId, score }
    }
  }
  return best.score < 0 ? { chunkId: '', subtopicId: null, score: 0 } : best
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
    task: 'justification',
    model: getModelFor('justification'),
    max_tokens: 1024,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  })

  const responseText =
    message.content[0].type === 'text' ? (message.content[0].text ?? '') : ''

  const parsed = parseJsonResponse(responseText) as JustificationResult

  return parsed.justification
}
