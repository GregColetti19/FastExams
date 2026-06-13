import { PROMPTS, parseJsonResponse } from './prompts'
import { getClient, AI_MODEL } from './client'

export interface GeneratedFlashcard {
  front: string
  back: string
}

export interface FlashcardGenerationResult {
  flashcards: GeneratedFlashcard[]
}

export async function generateFlashcardsFromText(
  text: string,
  topic: string,
  subtopic: string,
  language: string = 'en',
  numFlashcards: number = 5
): Promise<GeneratedFlashcard[]> {
  const prompt = PROMPTS.flashcardGeneration({
    n: numFlashcards,
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

  const parsed = parseJsonResponse(responseText) as FlashcardGenerationResult

  return parsed.flashcards || []
}

/**
 * Generate flashcards from multiple chunks
 */
export async function generateFlashcardsFromChunks(
  chunks: Array<{ text: string }>,
  topic: string,
  subtopic: string,
  language: string = 'en'
): Promise<GeneratedFlashcard[]> {
  const allFlashcards: GeneratedFlashcard[] = []

  for (const chunk of chunks) {
    try {
      const flashcards = await generateFlashcardsFromText(
        chunk.text,
        topic,
        subtopic,
        language,
        3 // 3 flashcards per chunk
      )
      allFlashcards.push(...flashcards)
      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch (error) {
      console.error('Error generating flashcards from chunk:', error)
    }
  }

  return allFlashcards
}
