import { PROMPTS, parseJsonResponse } from './prompts'
import { getClient, AI_MODEL } from './client'

export interface ExtractedTopic {
  name: string
  subtopics: string[]
}

export interface TopicExtractionResult {
  topics: ExtractedTopic[]
}

export async function extractTopics(
  outline: string,
  language: string = 'English',
  subject: string = 'medicine'
): Promise<TopicExtractionResult> {
  const prompt = PROMPTS.topicExtraction({ subject, language, outline })

  const message = await getClient().messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  })

  const responseText =
    message.content[0].type === 'text' ? (message.content[0].text ?? '') : ''

  const parsed = parseJsonResponse(responseText) as TopicExtractionResult

  return parsed
}

/**
 * Build outline from chunk headings (simple version)
 */
export function buildOutlineFromChunks(candidateHeadings: string[]): string {
  return candidateHeadings.filter((h) => h && h.length > 0).join('\n- ')
}

export interface HierarchySubtopic {
  name: string
  description: string
}
export interface HierarchyTopic {
  name: string
  subtopics: HierarchySubtopic[]
}
export interface TopicHierarchyResult {
  topics: HierarchyTopic[]
}

/**
 * Build a topic→subtopic tree from actual content excerpts (not headings).
 * Each subtopic gets a description, embedded later to seed chunk assignment.
 */
export async function extractTopicHierarchy(
  sampleTexts: string[],
  language: string = 'en',
  subject: string = 'medicine'
): Promise<TopicHierarchyResult> {
  const samples = sampleTexts
    .map((t, i) => `--- excerpt ${i + 1} ---\n${t.slice(0, 1200)}`)
    .join('\n\n')

  const prompt = PROMPTS.topicHierarchyFromContent({ subject, language, samples })
  const message = await getClient().messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  })
  const responseText =
    message.content[0]?.type === 'text' ? (message.content[0].text ?? '') : ''
  return parseJsonResponse(responseText) as TopicHierarchyResult
}

/**
 * LLM tie-break for a chunk the embedding refinement left unconfident.
 * Returns the chosen subtopic name, or null if none fit.
 */
export async function tiebreakSubtopic(
  chunkText: string,
  candidateSubtopics: string[],
  language: string = 'en'
): Promise<string | null> {
  if (candidateSubtopics.length === 0) return null

  const prompt = PROMPTS.subtopicTiebreak({
    language,
    chunk_text: chunkText.slice(0, 1500),
    candidates: candidateSubtopics,
  })
  const message = await getClient().messages.create({
    model: AI_MODEL,
    max_tokens: 256,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  })
  const responseText =
    message.content[0]?.type === 'text' ? (message.content[0].text ?? '') : ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJsonResponse(responseText) as any
  const choice = parsed?.subtopic
  if (!choice || choice === 'none') return null
  // Only accept an exact candidate name.
  return candidateSubtopics.includes(choice) ? choice : null
}
