import { describe, it, expect } from 'vitest'
import { PROMPTS, parseJsonResponse } from '@/lib/ai/prompts'

describe('parseJsonResponse', () => {
  it('parses plain JSON', () => {
    expect(parseJsonResponse('{"a":1}')).toEqual({ a: 1 })
  })

  it('strips ```json fences', () => {
    expect(parseJsonResponse('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('strips bare ``` fences', () => {
    expect(parseJsonResponse('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('throws on invalid JSON', () => {
    expect(() => parseJsonResponse('not json')).toThrow()
  })
})

describe('PROMPTS templates', () => {
  it('topicExtraction injects subject, language, outline', () => {
    const p = PROMPTS.topicExtraction({ subject: 'medicine', language: 'pt', outline: 'Heart\nLungs' })
    expect(p.system).toContain('curriculum analyzer')
    expect(p.user).toContain('medicine')
    expect(p.user).toContain('pt')
    expect(p.user).toContain('Heart')
  })

  it('questionGenerationText injects count and content', () => {
    const p = PROMPTS.questionGenerationText({ n: 7, language: 'en', topic: 'T', subtopic: 'S', text: 'body' })
    expect(p.system).toContain('exam question writer')
    expect(p.user).toContain('Generate 7 multiple choice')
    expect(p.user).toContain('Topic: T')
    expect(p.user).toContain('Subtopic: S')
    expect(p.user).toContain('body')
  })

  it('flashcardGeneration uses the flashcard system prompt', () => {
    const p = PROMPTS.flashcardGeneration({ n: 3, language: 'en', topic: 'T', subtopic: 'S', text: 'c' })
    expect(p.system).toContain('study flashcards')
    expect(p.user).toContain('Create 3 flashcards')
  })

  it('pastExamExtraction embeds markdown', () => {
    const p = PROMPTS.pastExamExtraction({ language: 'pt', markdown: '## Exam 2023' })
    expect(p.system).toContain('extracting structured question-and-answer')
    expect(p.user).toContain('## Exam 2023')
  })

  it('justificationGeneration lists wrong options', () => {
    const p = PROMPTS.justificationGeneration({
      language: 'en',
      question_text: 'Q?',
      correct_answer: 'B',
      wrong_options: ['A', 'C'],
      matched_chunk_text: 'theory',
    })
    // Subject-neutral: the app takes any university course, so no prompt may
    // assume a discipline. See lib/ai/infer-subject.ts.
    expect(p.system).toContain('university educator')
    expect(p.system).not.toMatch(/medical|clinical/i)
    expect(p.user).toContain('A, C')
    expect(p.user).toContain('theory')
  })

  it('no prompt assumes a discipline', () => {
    // The app takes any university course. Prompts previously hardcoded
    // "medical exam question writer" / "university medical students" /
    // "clinical reasoning", which skewed questions on maths, philosophy or
    // engineering material. Subject now comes from inference at ingestion.
    const base = { language: 'en', topic: 'T', subtopic: 'S', text: 'content', n: 2 }
    const rendered = [
      PROMPTS.topicExtraction({ subject: 'Numerical Analysis', language: 'en', outline: 'o' }),
      PROMPTS.questionGenerationText(base),
      PROMPTS.questionGenerationImage(base),
      PROMPTS.flashcardGeneration(base),
      PROMPTS.pastExamExtraction({ language: 'en', markdown: 'm' }),
      PROMPTS.justificationGeneration({
        language: 'en', question_text: 'q', correct_answer: 'B',
        wrong_options: ['A'], matched_chunk_text: 't',
      }),
      PROMPTS.examAnswerDetermination({
        language: 'en', question_text: 'q', options: ['A. x'], theory_text: 't',
      }),
    ]
    for (const p of rendered) {
      expect(`${p.system}\n${p.user}`).not.toMatch(/\bmedical\b|\bclinical\b|\bpatient\b/i)
    }
  })

  it('question generation carries the inferred subject and its question styles', () => {
    const p = PROMPTS.questionGenerationText({
      n: 2, language: 'en', topic: 'T', subtopic: 'S', text: 'content',
      subject: 'Philosophy of Science',
      questionStyles: 'positions and who holds them, arguments and their premises',
    })
    expect(p.system).toContain('Philosophy of Science')
    expect(p.user).toContain('Course subject: Philosophy of Science')
    expect(p.user).toContain('positions and who holds them')
  })

  it('question generation constrains option length', () => {
    // Measured 2026-08-12: the correct option was the longest in 44-56% of
    // generated questions (25% = unbiased). Shuffling does not fix this —
    // a student can pick the wordiest option and beat chance.
    const p = PROMPTS.questionGenerationText({
      n: 2, language: 'en', topic: 'T', subtopic: 'S', text: 'content',
    })
    expect(p.user).toMatch(/similar in length/i)
    expect(p.user).toMatch(/must NOT be the longest/i)
  })
})
