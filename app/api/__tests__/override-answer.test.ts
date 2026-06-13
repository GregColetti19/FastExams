import { describe, it, expect, beforeEach } from 'vitest'
import { POST } from '@/app/api/override-answer/route'
import { getMockStore, resetMockStore } from '@/lib/supabase/mock/store'

function post(body: any) {
  return POST({ json: async () => body } as any)
}

beforeEach(() => {
  resetMockStore()
  const store = getMockStore()
  store.seed('questions', [
    {
      id: 'q1',
      subtopic_id: 's1',
      question_text: 'Q',
      justification: 'J',
      source: 'past_exam',
      ai_confidence: 0.8,
      answer_status: 'ai_answered',
    },
  ])
  store.seed('question_options', [
    { id: 'o1', question_id: 'q1', option_text: 'A. x', is_correct: true, display_order: 0 },
    { id: 'o2', question_id: 'q1', option_text: 'B. y', is_correct: false, display_order: 1 },
    { id: 'o3', question_id: 'q1', option_text: 'C. z', is_correct: false, display_order: 2 },
  ])
})

describe('POST /api/override-answer (mock DB)', () => {
  it('rejects missing fields with 400', async () => {
    const res = await post({ questionId: 'q1' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_FIELDS')
  })

  it('rejects an option that does not belong to the question', async () => {
    const res = await post({ questionId: 'q1', correctOptionId: 'ghost' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('BAD_OPTION')
  })

  it('moves the correct flag to the chosen option and marks user_set', async () => {
    const res = await post({ questionId: 'q1', correctOptionId: 'o2' })
    expect(res.status).toBe(200)

    const store = getMockStore()
    const opts = store.table('question_options')
    expect(opts.find((o) => o.id === 'o1')!.is_correct).toBe(false)
    expect(opts.find((o) => o.id === 'o2')!.is_correct).toBe(true)
    expect(opts.find((o) => o.id === 'o3')!.is_correct).toBe(false)

    const q = store.table('questions')[0]
    expect(q.answer_status).toBe('user_set')
    expect(q.ai_confidence).toBeNull()
  })
})
