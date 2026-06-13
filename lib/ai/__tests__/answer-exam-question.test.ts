import { describe, it, expect } from 'vitest'
import { answerExamQuestion } from '../answer-exam-question'

describe('answerExamQuestion', () => {
  it('returns a grounded answer when source supports it', async () => {
    const result = await answerExamQuestion(
      'Which structure separates the left atrium and ventricle?',
      ['A. Tricuspid valve', 'B. Mitral valve', 'C. Aortic valve', 'D. Pulmonary valve'],
      'The mitral valve lies between the left atrium and left ventricle.',
      'en'
    )
    expect(result.answerable).toBe(true)
    expect(result.choice).toBe('B')
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.justification.length).toBeGreaterThan(0)
    expect(result.sourceQuote.length).toBeGreaterThan(0)
  })

  it('flags unanswerable without calling the model when there is no source', async () => {
    const result = await answerExamQuestion(
      'Some question?',
      ['A. x', 'B. y'],
      '   ',
      'en'
    )
    expect(result.answerable).toBe(false)
    expect(result.choice).toBe('')
    expect(result.confidence).toBe(0)
  })
})
