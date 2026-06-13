import { describe, it, expect, beforeEach } from 'vitest'
import { POST } from '@/app/api/generate-questions/route'
import { getMockStore, resetMockStore } from '@/lib/supabase/mock/store'

function post(body: any) {
  return POST({ json: async () => body } as any)
}

// Exercises the past-exam path end-to-end on the mock DB:
// extract (mock) -> embed theory chunks + question (mock) -> cosine match ->
// AI answer (mock) -> persist grounded answer. Validates the retrieval wiring.
beforeEach(() => {
  resetMockStore()
  const store = getMockStore()
  store.seed('exams', [{ id: 'e1', user_id: 'u1', name: 'Exam', language: 'en' }])
  store.seed('files', [
    { id: 'tf1', exam_id: 'e1', file_role: 'theory', processing_status: 'done' },
    { id: 'pf1', exam_id: 'e1', file_role: 'past_exam', processing_status: 'generating_questions' },
  ])
  store.seed('subtopics', [{ id: 's1', topic_id: 't1', name: 'Heart Valves', mastery_score: 0 }])
  store.seed('chunks', [
    // Theory chunk: shares tokens with the mock MCQ so cosine match wins.
    {
      id: 'tc1',
      file_id: 'tf1',
      subtopic_id: 's1',
      content_text:
        'The mitral valve separates the left atrium and left ventricle structure.',
    },
    // Past-exam chunk (its text feeds extractPastExamQuestions, which is mocked).
    { id: 'pc1', file_id: 'pf1', subtopic_id: null, content_text: 'exam questions here' },
  ])
})

describe('POST /api/generate-questions (past_exam, mock)', () => {
  it('grounds the MCQ in theory and persists an AI answer', async () => {
    const res = await post({ fileId: 'pf1', fileRole: 'past_exam' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.questionsCreated).toBeGreaterThanOrEqual(1)

    const store = getMockStore()
    const q = store.table('questions').find((x) => x.source === 'past_exam')
    expect(q).toBeTruthy()
    expect(q!.subtopic_id).toBe('s1') // matched to the theory subtopic
    expect(q!.answer_status).toBe('ai_answered')
    expect(q!.ai_confidence).toBeCloseTo(0.85, 2)
    expect(q!.matched_chunk_id).toBe('tc1')

    // The AI-chosen option (B) is marked correct.
    const opts = store.table('question_options').filter((o) => o.question_id === q!.id)
    const correct = opts.filter((o) => o.is_correct)
    expect(correct).toHaveLength(1)
    expect(correct[0].option_text).toContain('B.')
  })
})
