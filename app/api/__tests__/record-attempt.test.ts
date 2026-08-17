import { describe, it, expect, beforeEach } from 'vitest'
import { POST } from '@/app/api/record-attempt/route'
import { getMockStore, resetMockStore } from '@/lib/supabase/mock/store'
import { Rating } from '@/lib/fsrs'

// Drive the route with a minimal stub — it only calls request.json().
function post(body: any) {
  return POST({ json: async () => body } as any)
}

const FSRS_DEFAULTS = { stability: 0, difficulty: 0, reps: 0, lapses: 0, fsrs_state: 0, learning_steps: 0 }

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
      ...FSRS_DEFAULTS,
    },
  ])
  store.seed('study_sessions', [
    { id: 'sess1', user_id: 'u1', subtopic_id: 's1', session_type: 'quiz', total_questions: 0, correct_count: 0 },
  ])
})

describe('POST /api/record-attempt (mock DB, FSRS scheduler)', () => {
  it('rejects missing fields with 400', async () => {
    const res = await post({ sessionId: 'sess1' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('MISSING_FIELDS')
  })

  it('records a correct attempt and advances FSRS state', async () => {
    const res = await post({ sessionId: 'sess1', questionId: 'q1', isCorrect: true, timeSpentSeconds: 5 })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.nextReviewAt).toBeTruthy()
    expect(json.stability).toBeGreaterThan(0) // a Good review always grows stability from 0

    const store = getMockStore()
    // attempt persisted
    expect(store.table('question_attempts')).toHaveLength(1)
    // question schedule advanced
    const q = store.table('questions')[0]
    expect(q.times_seen).toBe(1)
    expect(q.times_correct).toBe(1)
    expect(q.reps).toBe(1)
    expect(q.stability).toBeGreaterThan(0)
    expect(new Date(q.next_review_at).getTime()).toBeGreaterThan(Date.now())
    expect(q.last_seen_at).toBeTruthy()
    // session counters bumped
    const sess = store.table('study_sessions')[0]
    expect(sess.total_questions).toBe(1)
    expect(sess.correct_count).toBe(1)
    // subtopic mastery recalculated from FSRS state — a brand-new card isn't
    // instantly "mastered" off one review, but it's no longer at the floor
    const mastery = store.table('subtopics')[0].mastery_score
    expect(mastery).toBeGreaterThan(0)
    expect(mastery).toBeLessThan(100)
  })

  it('an Again grade records a lapse once the card has graduated to Review', async () => {
    // graduate q1 out of short-term learning steps first
    for (let i = 0; i < 8; i++) {
      await post({ sessionId: 'sess1', questionId: 'q1', isCorrect: true })
      const store = getMockStore()
      if (store.table('questions')[0].fsrs_state === 2) break // Review
    }
    const store = getMockStore()
    const lapsesBefore = store.table('questions')[0].lapses

    const res = await post({ sessionId: 'sess1', questionId: 'q1', isCorrect: false })
    const json = await res.json()
    expect(json.success).toBe(true)

    const after = store.table('questions')[0]
    expect(after.lapses).toBe(lapsesBefore + 1)
    expect(after.times_correct).toBe(after.times_seen - 1) // the one miss
  })

  it('returns 404 when the question does not exist', async () => {
    const res = await post({ sessionId: 'sess1', questionId: 'ghost', isCorrect: true })
    expect(res.status).toBe(404)
  })

  describe('explicit grade (flashcard self-rating, 4-way FSRS scale)', () => {
    it('accepts grade instead of isCorrect and schedules accordingly', async () => {
      const res = await post({ sessionId: 'sess1', questionId: 'q1', grade: Rating.Easy })
      expect(res.status).toBe(200)
      const store = getMockStore()
      const q = store.table('questions')[0]
      expect(q.reps).toBe(1)
      expect(q.stability).toBeGreaterThan(0)
      // Easy grants a longer interval than Good would for the same starting card
      const easyDue = new Date(q.next_review_at).getTime()

      resetMockStore()
      const store2 = getMockStore()
      store2.seed('subtopics', [{ id: 's1', topic_id: 't1', name: 'Heart', mastery_score: 0 }])
      store2.seed('questions', [{ id: 'q1', subtopic_id: 's1', question_text: 'Q', justification: 'J', times_seen: 0, times_correct: 0, current_interval_days: 1, last_seen_at: null, ...FSRS_DEFAULTS }])
      await post({ questionId: 'q1', grade: Rating.Good })
      const goodDue = new Date(store2.table('questions')[0].next_review_at).getTime()
      expect(easyDue).toBeGreaterThanOrEqual(goodDue)
    })

    it('Again grade marks the attempt incorrect even without isCorrect', async () => {
      const res = await post({ sessionId: 'sess1', questionId: 'q1', grade: Rating.Again })
      expect(res.status).toBe(200)
      const store = getMockStore()
      expect(store.table('question_attempts')[0].is_correct).toBe(false)
      expect(store.table('questions')[0].times_correct).toBe(0)
    })

    it('Hard/Good/Easy grades mark the attempt correct', async () => {
      await post({ sessionId: 'sess1', questionId: 'q1', grade: Rating.Hard })
      const store = getMockStore()
      expect(store.table('question_attempts')[0].is_correct).toBe(true)
      expect(store.table('questions')[0].times_correct).toBe(1)
    })

    it('an invalid grade value falls back to binary via isCorrect', async () => {
      const res = await post({ sessionId: 'sess1', questionId: 'q1', grade: 99, isCorrect: true })
      expect(res.status).toBe(200)
      const store = getMockStore()
      expect(store.table('question_attempts')[0].is_correct).toBe(true)
    })
  })

  it('aggregates subtopic mastery across all its questions', async () => {
    const store = getMockStore()
    store.seed('questions', [
      {
        id: 'q2',
        subtopic_id: 's1',
        question_text: 'Q2',
        justification: 'J',
        times_seen: 0,
        times_correct: 0,
        current_interval_days: 1,
        last_seen_at: null,
        ...FSRS_DEFAULTS,
      },
    ])
    // q1 answered (stability > 0), q2 untouched (stays New, mastery 0) →
    // subtopic average should sit strictly between the two, not at either extreme.
    await post({ sessionId: 'sess1', questionId: 'q1', isCorrect: true })
    const q1Mastery = store.table('questions')[0].stability > 0
    expect(q1Mastery).toBe(true)
    const subtopicMastery = store.table('subtopics')[0].mastery_score
    expect(subtopicMastery).toBeGreaterThan(0)
    expect(subtopicMastery).toBeLessThan(50) // dragged down by q2 still being New
  })
})
