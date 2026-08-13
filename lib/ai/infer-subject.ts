import { getClient, getModelFor } from './client'
import { parseJsonResponse } from './prompts'

/**
 * Academic subject of an uploaded document, inferred once at ingestion.
 *
 * Every prompt used to hardcode "medical exam question writer" / "medical
 * students", and `extractTopics(subject = 'medicine')` was never passed a real
 * value — so a numerical-analysis or philosophy upload was told it was a
 * medicine course. That skews question framing ("clinical reasoning"),
 * vocabulary, and topic naming on any non-medical material.
 *
 * The subject is a short free-text label ("Numerical Analysis", "Philosophy of
 * Science", "Medicine"), not an enum: the app takes any university course, and
 * an enum would need editing for every new field.
 */

const FALLBACK_SUBJECT = 'general university studies'

export interface SubjectInference {
  /** Short course-subject label, e.g. "Organic Chemistry". */
  subject: string
  /** Discipline family, used to pick question styles. */
  domain: 'stem' | 'humanities' | 'social-science' | 'professional' | 'other'
  /** False when inference failed and the caller got the neutral fallback. */
  inferred: boolean
}

/** Neutral default — never medicine. Used when inference fails or text is thin. */
export const DEFAULT_SUBJECT: SubjectInference = {
  subject: FALLBACK_SUBJECT,
  domain: 'other',
  inferred: false,
}

/**
 * Infer subject + domain from a sample of document text.
 *
 * Cheap and best-effort: one short call on a text sample, and any failure
 * returns DEFAULT_SUBJECT rather than throwing — ingestion must not fail
 * because a labelling nicety did.
 */
export async function inferSubject(
  markdown: string,
  language: string = 'en'
): Promise<SubjectInference> {
  const sample = (markdown || '').trim()
  if (sample.length < 200) return { ...DEFAULT_SUBJECT }

  // Head + middle: title pages are often boilerplate, so mid-document text is
  // usually the better signal for what the course actually covers.
  const head = sample.slice(0, 2000)
  const mid = sample.slice(Math.floor(sample.length / 2), Math.floor(sample.length / 2) + 2000)

  try {
    const model = getModelFor('topic-extraction')
    const message = await getClient(model).messages.create({
      task: 'topic-extraction',
      model,
      max_tokens: 200,
      system:
        'You identify the academic subject of university course material. ' +
        'Always respond with valid JSON only. No preamble, no markdown fences.',
      user: `Identify the academic subject of this university course material.
Document language: ${language}

Rules:
- "subject" is a short course-subject label in English, 1–4 words (e.g. "Organic Chemistry", "Numerical Analysis", "Philosophy of Science", "Medicine"). Name the specific field, not the document type.
- "domain" is one of: stem, humanities, social-science, professional, other.

Excerpt A:
${head}

Excerpt B:
${mid}

Respond with: {"subject": "...", "domain": "stem"}`,
    })

    const text = message.content[0]?.type === 'text' ? (message.content[0].text ?? '') : ''
    const parsed = parseJsonResponse(text) as { subject?: unknown; domain?: unknown }

    const subject = typeof parsed?.subject === 'string' ? parsed.subject.trim() : ''
    const domain = String(parsed?.domain ?? '').trim().toLowerCase()
    const allowed = ['stem', 'humanities', 'social-science', 'professional', 'other']

    if (!subject || subject.length > 60) return { ...DEFAULT_SUBJECT }

    return {
      subject,
      domain: (allowed.includes(domain) ? domain : 'other') as SubjectInference['domain'],
      inferred: true,
    }
  } catch (error) {
    console.error('inferSubject failed (using neutral default):', error)
    return { ...DEFAULT_SUBJECT }
  }
}

/**
 * Question styles appropriate to a discipline.
 *
 * Replaces the hardcoded "factual, applied, and clinical reasoning" mix, which
 * asked for clinical reasoning about partial differential equations. Kept as
 * guidance in the prompt rather than a hard rule so the model can still follow
 * what the material supports.
 */
export function questionStylesFor(domain: SubjectInference['domain']): string {
  switch (domain) {
    case 'stem':
      return 'definitions and precise statements, derivations and proof steps, applying a method to a case, comparing approaches and their conditions of validity'
    case 'humanities':
      return 'positions and who holds them, arguments and their premises, objections and replies, comparing competing interpretations'
    case 'social-science':
      return 'concepts and definitions, theories and their predictions, study design and interpretation of findings, comparing explanatory frameworks'
    case 'professional':
      return 'definitions and classifications, procedures and their indications, applied case reasoning, comparing options and trade-offs'
    default:
      return 'definitions, core mechanisms or arguments, application to a concrete case, comparison between related ideas'
  }
}
