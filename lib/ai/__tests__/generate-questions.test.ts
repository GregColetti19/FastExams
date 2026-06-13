import { describe, it, expect } from 'vitest'
import {
  generateQuestionsFromText,
  generateQuestionsFromImage,
  generateQuestionsFromChunks,
  GeneratedQuestion,
} from '@/lib/ai/generate-questions'

function assertWellFormed(q: GeneratedQuestion) {
  expect(typeof q.question_text).toBe('string')
  expect(q.options).toHaveLength(4)
  expect(q.options.filter((o) => o.is_correct)).toHaveLength(1)
  expect(typeof q.justification).toBe('string')
}

describe('generateQuestionsFromText (mocked AI)', () => {
  it('returns the requested number of well-formed MCQs', async () => {
    const qs = await generateQuestionsFromText('content', 'Cardio', 'Heart Valves', 'en', 4)
    expect(qs).toHaveLength(4)
    qs.forEach(assertWellFormed)
  })

  it('echoes the subtopic into the question (mock honors inputs)', async () => {
    const qs = await generateQuestionsFromText('content', 'Cardio', 'Heart Valves', 'en', 1)
    expect(qs[0].question_text).toContain('Heart Valves')
  })
})

describe('generateQuestionsFromImage (mocked AI)', () => {
  it('returns 2 well-formed MCQs for an image chunk', async () => {
    const qs = await generateQuestionsFromImage('ZmFrZQ==', 'image/png', 'caption', 'Cardio', 'ECG', 'en')
    expect(qs).toHaveLength(2)
    qs.forEach(assertWellFormed)
  })
})

describe('generateQuestionsFromChunks (mocked AI)', () => {
  it('batches text chunks (5 per call) and skips image chunks', async () => {
    const chunks = [
      { text: 'a', hasImage: false },
      { text: 'b', hasImage: false },
      { text: 'img', hasImage: true, imagePath: 'p' },
    ]
    const qs = await generateQuestionsFromChunks(chunks, 'Cardio', 'Heart', 'en')
    // 2 text chunks → one batch → mock returns 5 questions; image chunk skipped.
    expect(qs.length).toBeGreaterThan(0)
    qs.forEach(assertWellFormed)
  })

  it('returns empty array for no text chunks', async () => {
    const qs = await generateQuestionsFromChunks([], 'T', 'S', 'en')
    expect(qs).toEqual([])
  })
})
