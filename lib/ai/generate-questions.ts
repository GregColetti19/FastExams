import { PROMPTS, parseJsonResponse } from './prompts'
import { getClient, AI_MODEL } from './client'

export interface QuestionOption {
  text: string
  is_correct: boolean
}

export interface GeneratedQuestion {
  question_text: string
  options: QuestionOption[]
  justification: string
}

export interface QuestionGenerationResult {
  questions: GeneratedQuestion[]
}

export async function generateQuestionsFromText(
  text: string,
  topic: string,
  subtopic: string,
  language: string = 'en',
  numQuestions: number = 5
): Promise<GeneratedQuestion[]> {
  const prompt = PROMPTS.questionGenerationText({
    n: numQuestions,
    language,
    topic,
    subtopic,
    text,
  })

  const message = await getClient().messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  })

  const responseText =
    message.content[0].type === 'text' ? (message.content[0].text ?? '') : ''

  const parsed = parseJsonResponse(responseText) as QuestionGenerationResult

  return parsed.questions || []
}

export async function generateQuestionsFromImage(
  imageBase64: string,
  imageMediaType: string,
  text: string,
  topic: string,
  subtopic: string,
  language: string = 'en'
): Promise<GeneratedQuestion[]> {
  const prompt = PROMPTS.questionGenerationImage({
    language,
    topic,
    subtopic,
    text,
  })

  const message = await getClient().messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    system: prompt.system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt.user },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageMediaType as
                | 'image/jpeg'
                | 'image/png'
                | 'image/gif'
                | 'image/webp',
              data: imageBase64,
            },
          },
        ],
      },
    ],
  })

  const responseText =
    message.content[0].type === 'text' ? (message.content[0].text ?? '') : ''

  const parsed = parseJsonResponse(responseText) as QuestionGenerationResult

  return parsed.questions || []
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Batch and generate questions from multiple text chunks
 * Batches up to 5 chunks per API call
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function generateQuestionsFromChunks(
  chunks: Array<{ text: string; hasImage: boolean; imagePath?: string }>,
  topic: string,
  subtopic: string,
  language: string = 'en'
): Promise<GeneratedQuestion[]> {
  const allQuestions: GeneratedQuestion[] = []
  const textChunks = chunks.filter((c) => !c.hasImage)

  // Process text chunks in batches of 5
  for (let i = 0; i < textChunks.length; i += 5) {
    const batch = textChunks.slice(i, Math.min(i + 5, textChunks.length))
    const combinedText = batch.map((c) => c.text).join('\n\n---\n\n')

    try {
      const questions = await generateQuestionsFromText(
        combinedText,
        topic,
        subtopic,
        language,
        Math.min(5, batch.length)
      )
      allQuestions.push(...questions)
      // Rate limiting: wait 500ms between batches
      if (i + 5 < textChunks.length) {
        await sleep(500)
      }
    } catch (error) {
      console.error(`Error generating questions from text batch ${i}:`, error)
    }
  }

  // TODO: Phase 3 full - Process image chunks individually
  // For MVP, skip images since we don't have image extraction
  // In production: fetch image from Supabase Storage, convert to base64, and call generateQuestionsFromImage

  return allQuestions
}
