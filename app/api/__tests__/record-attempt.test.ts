import { describe, it, expect, beforeEach } from 'vitest'
import { POST } from '@/app/api/record-attempt/route'
import { getMockStore, resetMockStore } from '@/lib/supabase/mock/store'

// Drive the route with a minimal stub — it only calls request.json().
function post(body: any) {
  return POST({ json: async () => body } as any)
}

beforeEach(() => {
  resetMockStore()
  const store = getMockStore()
  store.seed('subtopics', [{ id: 's1', topic_id: 't1', name: 'Heart', mastery_score: 0 }])
  store.seed('questions', [
    {
      id: 'q1',
      subtopic_id: 's1',
      question_text: 'Q',
      justification: 'J',
      times_seen: 0,
      times_correct: 0,
      current_interval_days: 1,
      last_seen_at: null,
    },
  ])
  store.seed('study_sessions', [
    { id: 'sess1', user_id: 'u1', subtopic_id: 's1', session_type: 'quiz', total_questions: 0, correct_count: 0 },
  ])
})

describe('POST /api/record-attempt (mock DB)', () => {
  it('rejects missing fields with 400', async () => {
    const res = await post({ sessionId: 'sess1' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('MISSING_FIELDS')
  })

  it('records a correct attempt and updates schedule, session, mastery', async () => {
    const res = await post({ sessionId: 'sess1', questionId: 'q1', isCorrect: true, timeSpentSeconds: 5 })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.intervalDays).toBe(2.5) // 1 * 2.5
    expect(json.masteryScore).toBe(100)

    const store = getMockStore()
    // attempt persisted
    expect(store.table('question_attempts')).toHaveLength(1)
    // question schedule advanced
    const q = store.table('questions')[0]
    expect(q.times_seen).toBe(1)
    expect(q.times_correct).toBe(1)
    expect(q.current_interval_days).toBe(2.5)
    expect(q.last_seen_at).toBeTruthy()
    // session counters bumped
    const sess = store.table('study_sessions')[0]
    expect(sess.total_questions).toBe(1)
    expect(sess.correct_count).toBe(1)
    // subtopic mastery recalculated
    expect(store.table('subtopics')[0].mastery_score).toBe(100)
  })

  it('incorrect attempt resets interval and lowers mastery', async () => {
    await post({ sessionId: 'sess1', questionId: 'q1', isCorrect: true })
    const res = await post({ sessionId: 'sess1', questionId: 'q1', isCorrect: false })
    const json = await res.json()
    expect(json.intervalDays).toBe(1) // reset on incorrect

    const store = getMockStore()
    const q = store.table('questions')[0]
    expect(q.times_seen).toBe(2)
    expect(q.times_correct).toBe(1)
    // 2 attempts, 1 correct → 50
    expect(store.table('subtopics')[0].mastery_score).toBe(50)
  })

  it('returns 404 when the question does not exist', async () => {
    const res = await post({ sessionId: 'sess1', questionId: 'ghost', isCorrect: true })
    expect(res.status).toBe(404)
  })
})
