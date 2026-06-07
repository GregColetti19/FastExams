import { Anthropic } from '@anthropic-ai/sdk'
import { PROMPTS, parseJsonResponse } from './prompts'

const client = new Anthropic()

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

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  })

  const responseText =
    message.content[0].type === 'text' ? message.content[0].text : ''

  const parsed = parseJsonResponse(responseText) as TopicExtractionResult

  return parsed
}

/**
 * Build outline from chunk headings (simple version)
 */
export function buildOutlineFromChunks(candidateHeadings: string[]): string {
  return candidateHeadings.filter((h) => h && h.length > 0).join('\n- ')
}
