import { PROMPTS, parseJsonResponse } from './prompts'
import { getClient, getModelFor } from './client'
import { questionStylesFor, type SubjectInference } from './infer-subject'

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

/**
 * Shuffle a question's options in place of the model's ordering.
 *
 * Every generator tested puts the correct answer first: measured 2026-08-12 over
 * 792 generated questions, gpt-5.6-luna produced the correct option at position
 * A in 237/237 cases (100%), gemini-3.5-flash-lite in 90%, qwen3.7-flash in 69%.
 * Uniform would be 25%. Options are persisted with `display_order: i` and
 * rendered in that order, so without this a student learns "pick A" instead of
 * the material — and any accuracy metric computed against the key is inflated
 * by position bias.
 *
 * Fisher-Yates. `is_correct` travels with its option, so the key stays correct
 * wherever the option lands.
 */
export function shuffleOptions<T>(options: T[]): T[] {
  const out = [...options]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * How much longer the correct option may be than the mean wrong option before
 * it counts as a length tell. 1.25 = 25% longer; below that the difference is
 * not reliably visible to someone scanning four options.
 */
const LENGTH_BIAS_RATIO = 1.25

/** True when the correct option is both the longest and materially longer. */
export function hasLengthBias(options: QuestionOption[]): boolean {
  const correct = options.find((o) => o.is_correct)
  const wrong = options.filter((o) => !o.is_correct)
  if (!correct || wrong.length === 0) return false
  const correctLen = correct.text.length
  if (correctLen < Math.max(...wrong.map((o) => o.text.length))) return false
  const meanWrong = wrong.reduce((s, o) => s + o.text.length, 0) / wrong.length
  return meanWrong > 0 && correctLen / meanWrong >= LENGTH_BIAS_RATIO
}

/**
 * Rewrite options so the correct one isn't identifiable by length alone.
 *
 * Measured 2026-08-12/13: across every generator tested the correct option was
 * the longest in 44-56% of questions (25% = unbiased), and adding an explicit
 * prompt rule ("keep options similar in length, the correct option must NOT be
 * the longest") moved glm-4.7-flash from 50.0% to 51.1% — i.e. not at all.
 * Models write more detail into the true statement because it is true, so this
 * has to be corrected after generation rather than asked for during it.
 *
 * One extra call per affected question, and only for questions that actually
 * violate the ratio. On failure the originals are returned unchanged — a
 * length-biased question is much better than a lost one.
 */
export async function equalizeOptionLengths(
  question: GeneratedQuestion,
  language: string = 'en'
): Promise<QuestionOption[]> {
  if (!hasLengthBias(question.options)) return question.options

  const correct = question.options.find((o) => o.is_correct)!
  const wrong = question.options.filter((o) => !o.is_correct)
  // Target the mean wrong-option length: pulling the correct one down beats
  // padding three distractors, which tends to make them waffly and implausible.
  const target = Math.round(wrong.reduce((s, o) => s + o.text.length, 0) / wrong.length)

  try {
    const model = getModelFor('question-gen')
    const message = await getClient(model).messages.create({
      task: 'question-gen',
      model,
      max_tokens: 1024,
      system:
        'You rewrite multiple-choice options so that length does not reveal the answer. ' +
        'Always respond with valid JSON only. No preamble, no markdown fences.',
      user: `In this question the correct option is noticeably longer than the wrong ones, which lets students pick it without knowing the material.

Question: ${question.question_text}

Correct option (${correct.text.length} chars): ${correct.text}
Wrong options: ${wrong.map((o) => `(${o.text.length} chars) ${o.text}`).join(' | ')}

Rewrite ALL FOUR options so they are close to ${target} characters each.

Rules:
- Keep the meaning of every option exactly as it is. The correct option must stay correct and the wrong ones must stay wrong.
- Do not make any option vague or ambiguous to shorten it — cut redundancy, not content.
- Keep the same order: the first option is the correct one.
- Write in ${language}.

Respond with: {"correct": "...", "wrong": ["...", "...", "..."]}`,
    })

    const text = message.content[0]?.type === 'text' ? (message.content[0].text ?? '') : ''
    const parsed = parseJsonResponse(text) as { correct?: unknown; wrong?: unknown }
    const newCorrect = typeof parsed?.correct === 'string' ? parsed.correct.trim() : ''
    const newWrong = Array.isArray(parsed?.wrong)
      ? parsed.wrong.filter((w): w is string => typeof w === 'string').map((w) => w.trim())
      : []

    if (!newCorrect || newWrong.length !== wrong.length || newWrong.some((w) => !w)) {
      return question.options
    }

    const rewritten: QuestionOption[] = [
      { text: newCorrect, is_correct: true },
      ...newWrong.map((text) => ({ text, is_correct: false })),
    ]
    // Only accept the rewrite if it actually fixed the bias; otherwise the
    // original at least came from the source material.
    return hasLengthBias(rewritten) ? question.options : rewritten
  } catch (error) {
    console.error('equalizeOptionLengths failed (keeping original options):', error)
    return question.options
  }
}

export async function generateQuestionsFromText(
  text: string,
  topic: string,
  subtopic: string,
  language: string = 'en',
  numQuestions: number = 5,
  /** Inferred course subject + domain; omit to fall back to neutral framing. */
  subjectInfo?: { subject: string; domain: SubjectInference['domain'] }
): Promise<GeneratedQuestion[]> {
  const prompt = PROMPTS.questionGenerationText({
    n: numQuestions,
    language,
    topic,
    subtopic,
    text,
    subject: subjectInfo?.subject,
    questionStyles: subjectInfo ? questionStylesFor(subjectInfo.domain) : undefined,
  })

  const message = await getClient(getModelFor('question-gen')).messages.create({
    task: 'question-gen',
    model: getModelFor('question-gen'),
    max_tokens: 4096,
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

  const message = await getClient(getModelFor('question-gen')).messages.create({
    task: 'question-gen',
    model: getModelFor('question-gen'),
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
  language: string = 'en',
  subjectInfo?: { subject: string; domain: SubjectInference['domain'] }
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
        Math.min(5, batch.length),
        subjectInfo
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
