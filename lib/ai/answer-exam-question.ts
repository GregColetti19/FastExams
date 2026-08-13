import { PROMPTS, parseJsonResponse } from './prompts'
import { getClient, getModelFor } from './client'

export interface ExamAnswerResult {
  /** False when the source material doesn't support a confident answer. */
  answerable: boolean
  /** Option letter the model chose, e.g. "B". Empty when not answerable. */
  choice: string
  /** Text of the chosen option. Empty when not answerable. */
  choiceText: string
  /** 0–1 confidence that the source supports the choice. */
  confidence: number
  /** Explanation grounded in (and quoting) the source. */
  justification: string
  /** The exact sentence from the source that supports the answer. */
  sourceQuote: string
}

const UNANSWERABLE: ExamAnswerResult = {
  answerable: false,
  choice: '',
  choiceText: '',
  confidence: 0,
  justification: '',
  sourceQuote: '',
}

/**
 * Determine the correct answer to a past-exam MCQ using ONLY the matched theory
 * text. Past-exam PDFs carry no answer key, so the answer is AI-inferred and
 * always grounded in (and cited to) the source. Returns answerable=false when
 * the source is insufficient — callers should flag, not guess.
 */
export async function answerExamQuestion(
  questionText: string,
  options: string[],
  theoryText: string,
  language: string = 'en'
): Promise<ExamAnswerResult> {
  // No source to ground against → unanswerable by design (never guess).
  if (!theoryText || theoryText.trim().length === 0) {
    return { ...UNANSWERABLE }
  }

  const prompt = PROMPTS.examAnswerDetermination({
    language,
    question_text: questionText,
    options,
    theory_text: theoryText,
  })

  const message = await getClient(getModelFor('answer-determination')).messages.create({
    task: 'answer-determination',
    model: getModelFor('answer-determination'),
    max_tokens: 1024,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  })

  const responseText =
    message.content[0]?.type === 'text' ? (message.content[0].text ?? '') : ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: Record<string, any>
  try {
    parsed = parseJsonResponse(responseText) as Record<string, any>
  } catch {
    // Claude returned plain text instead of JSON (e.g. when theory context is
    // too weak to ground an answer). Treat as unanswerable — never guess.
    console.warn(
      `answerExamQuestion: non-JSON response for "${questionText.slice(0, 80)}"\n` +
      `  response: ${responseText.slice(0, 200)}`
    )
    return { ...UNANSWERABLE }
  }

  // Normalize + guard: treat missing/invalid fields as unanswerable.
  const confidence =
    typeof parsed.confidence === 'number' ? parsed.confidence : 0
  if (!parsed.answerable || !parsed.choice) {
    return { ...UNANSWERABLE, justification: parsed.justification ?? '' }
  }

  return {
    answerable: true,
    choice: String(parsed.choice).trim(),
    choiceText: parsed.choiceText ?? parsed.choice_text ?? '',
    confidence,
    justification: parsed.justification ?? '',
    sourceQuote: parsed.sourceQuote ?? parsed.source_quote ?? '',
  }
}
