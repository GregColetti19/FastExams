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
    expect(p.system).toContain('medical educator')
    expect(p.user).toContain('A, C')
    expect(p.user).toContain('theory')
  })
})
