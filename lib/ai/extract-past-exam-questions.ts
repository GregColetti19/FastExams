import { PROMPTS, parseJsonResponse } from './prompts'
import { getClient, AI_MODEL } from './client'

export interface ExtractedExamQuestion {
  question_number: string
  question_text: string
  type: 'mcq' | 'open'
  options?: string[]
  correct_answer?: string
  correct_answer_text?: string
}

export interface ExamExtractionResult {
  year?: string
  questions: ExtractedExamQuestion[]
}

function ts() {
  return new Date().toISOString()
}

/** Single API call for a small markdown chunk (≤3 questions). */
async function extractChunk(
  markdown: string,
  language: string,
  chunkIndex: number
): Promise<ExamExtractionResult> {
  const prompt = PROMPTS.pastExamExtraction({ language, markdown })

  console.log(`[${ts()}] extractChunk[${chunkIndex}] sending ${markdown.length} chars to AI`)

  let responseText = ''
  try {
    const message = await getClient().messages.create({
      model: AI_MODEL,
      max_tokens: 8192,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    })
    responseText = message.content[0].type === 'text' ? (message.content[0].text ?? '') : ''
  } catch (apiError) {
    console.error(
      `[${ts()}] extractChunk[${chunkIndex}] API call failed.\n` +
      `  REQUEST system: ${prompt.system.slice(0, 200)}\n` +
      `  REQUEST user (first 300): ${prompt.user.slice(0, 300)}\n` +
      `  ERROR: ${apiError}`
    )
    throw apiError
  }

  try {
    const parsed = parseJsonResponse(responseText) as ExamExtractionResult
    console.log(`[${ts()}] extractChunk[${chunkIndex}] OK — ${parsed.questions?.length ?? 0} questions`)
    return parsed
  } catch (parseError) {
    // Claude returned plain text or malformed JSON (e.g. chunk was a header/intro with no questions).
    // Log full request + response so we can debug the prompt, then skip this chunk.
    console.error(
      `[${ts()}] extractChunk[${chunkIndex}] JSON parse failed — Claude returned non-JSON.\n` +
      `  PARSE ERROR: ${parseError}\n` +
      `  REQUEST system (first 300): ${prompt.system.slice(0, 300)}\n` +
      `  REQUEST user (first 500): ${prompt.user.slice(0, 500)}\n` +
      `  RESPONSE (first 500): ${responseText.slice(0, 500)}`
    )
    return { questions: [] }
  }
}

/**
 * Extract past-exam questions from markdown.
 * Always splits into 3-question chunks per API call to keep JSON output small
 * and avoid malformed-JSON failures from long single-call responses.
 */
export async function extractPastExamQuestions(
  markdown: string,
  language: string = 'en'
): Promise<ExamExtractionResult> {
  console.log(`[${ts()}] extractPastExamQuestions start — ${markdown.length} chars, lang=${language}`)

  // Split on Portuguese/English numbered question markers: "1.", "2.", etc.
  const questionPattern = /^(?:\d+\.|Question\s+\d+|Q\d+)/m
  const sections = markdown.split(questionPattern).filter((s) => s.trim())

  console.log(`[${ts()}] extractPastExamQuestions split → ${sections.length} sections`)

  // If split produced nothing useful (no question markers found), treat the
  // whole markdown as one chunk and let the AI do its best.
  if (sections.length <= 1) {
    return extractChunk(markdown.substring(0, 8000), language, 0)
  }

  const allQuestions: ExtractedExamQuestion[] = []
  const chunkSize = 3
  let yearDetected = ''

  for (let i = 0; i < sections.length; i += chunkSize) {
    const chunk = sections
      .slice(i, Math.min(i + chunkSize, sections.length))
      .join('\n\n')
      .substring(0, 8000)

    const result = await extractChunk(chunk, language, i)
    allQuestions.push(...result.questions)
    if (result.year && !yearDetected) yearDetected = result.year

    if (i + chunkSize < sections.length) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  console.log(`[${ts()}] extractPastExamQuestions done — ${allQuestions.length} total questions`)
  return { year: yearDetected, questions: allQuestions }
}
