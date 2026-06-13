import { describe, it, expect } from 'vitest'
import { extractPastExamQuestions } from '@/lib/ai/extract-past-exam-questions'

describe('extractPastExamQuestions (mocked AI)', () => {
  it('extracts year + questions from a short exam', async () => {
    const result = await extractPastExamQuestions('## Exam 2023\n1. A question?', 'pt')
    expect(result.year).toBe('2023')
    expect(result.questions.length).toBeGreaterThan(0)
    const mcq = result.questions.find((q) => q.type === 'mcq')
    expect(mcq).toBeDefined()
    expect(mcq!.options!.length).toBeGreaterThan(0)
    expect(mcq!.correct_answer).toBeTruthy()
  })

  it('handles open questions (no options)', async () => {
    const result = await extractPastExamQuestions('short', 'pt')
    const open = result.questions.find((q) => q.type === 'open')
    expect(open).toBeDefined()
  })

  it('takes the large-exam split path for long markdown', async () => {
    // >24000 chars triggers extractLargeExam, which splits on question markers
    // and aggregates sub-call results — all via the mock, zero tokens.
    // Few markers keep the real 500ms inter-chunk rate-limit sleeps bounded.
    const big = '1. Q one?\n2. Q two?\n3. Q three?\n' + 'x'.repeat(25000)
    const result = await extractPastExamQuestions(big, 'pt')
    expect(result.questions.length).toBeGreaterThan(0)
  }, 10000)
})
