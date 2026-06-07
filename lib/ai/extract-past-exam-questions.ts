import { Anthropic } from '@anthropic-ai/sdk'
import { PROMPTS, parseJsonResponse } from './prompts'

const client = new Anthropic()

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

export async function extractPastExamQuestions(
  markdown: string,
  language: string = 'en'
): Promise<ExamExtractionResult> {
  // For large exams, split at ~8000 token boundary
  // Rough heuristic: 6000 chars ≈ 2000 tokens
  if (markdown.length > 24000) {
    return extractLargeExam(markdown, language)
  }

  const prompt = PROMPTS.pastExamExtraction({ language, markdown })

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  })

  const responseText =
    message.content[0].type === 'text' ? message.content[0].text : ''

  const parsed = parseJsonResponse(responseText) as ExamExtractionResult

  return parsed
}

async function extractLargeExam(
  markdown: string,
  language: string
): Promise<ExamExtractionResult> {
  // Split by question markers (e.g., "1.", "Question 1", etc.)
  const questionPattern = /^(?:\d+\.|Question\s+\d+|Q\d+)/m
  const sections = markdown.split(questionPattern).filter((s) => s.trim())

  // Process in chunks
  const allQuestions: ExtractedExamQuestion[] = []
  const chunkSize = 3 // Process 3 questions per API call
  let yearDetected = ''

  for (let i = 0; i < sections.length; i += chunkSize) {
    const chunk = sections.slice(i, Math.min(i + chunkSize, sections.length)).join('\n\n')
    const chunkMarkdown = chunk.substring(0, 8000) // Limit to safe size

    try {
      const result = await extractPastExamQuestions(chunkMarkdown, language)
      allQuestions.push(...result.questions)
      if (result.year && !yearDetected) {
        yearDetected = result.year
      }
    } catch (error) {
      console.error(`Error extracting questions from section ${i}:`, error)
    }

    // Small delay between chunks
    if (i + chunkSize < sections.length) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  return {
    year: yearDetected,
    questions: allQuestions,
  }
}
