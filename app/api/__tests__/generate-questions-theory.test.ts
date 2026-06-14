import { describe, it, expect, beforeEach } from 'vitest'
import { POST } from '@/app/api/generate-questions/route'
import { getMockStore, resetMockStore } from '@/lib/supabase/mock/store'

function post(body: any) {
  return POST({ json: async () => body } as any)
}

// Theory path on mock DB: content-grounded tree (mock) + seeded embedding
// assignment (mock embedder) should sort heart chunks vs lung chunks into the
// right subtopics, then generate questions per subtopic.
beforeEach(() => {
  resetMockStore()
  const store = getMockStore()
  store.seed('exams', [{ id: 'e1', user_id: 'u1', name: 'Exam', language: 'en' }])
  store.seed('files', [
    { id: 'tf1', exam_id: 'e1', file_role: 'theory', processing_status: 'generating_questions' },
  ])
  store.seed('chunks', [
    { id: 'h0', file_id: 'tf1', subtopic_id: null, content_text: 'the mitral valve separates the left atrium and ventricle blood flow' },
    { id: 'h1', file_id: 'tf1', subtopic_id: null, content_text: 'aortic valve stenosis affects ventricle blood flow and the heart' },
    { id: 'l0', file_id: 'tf1', subtopic_id: null, content_text: 'alveoli enable oxygen gas exchange in the lung during ventilation' },
    { id: 'l1', file_id: 'tf1', subtopic_id: null, content_text: 'lung compliance and airway resistance affect breathing ventilation' },
  ])
})

describe('POST /api/generate-questions (theory, mock)', () => {
  it('builds the tree, assigns chunks by meaning, generates questions', async () => {
    const res = await post({ fileId: 'tf1', fileRole: 'theory' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.subtopicsCreated).toBeGreaterThan(0)
    expect(json.questionsCreated).toBeGreaterThan(0)

    const store = getMockStore()
    const subId = (name: string) => store.table('subtopics').find((s) => s.name === name)?.id
    const heartId = subId('Heart Valves')
    const lungId = subId('Lung Mechanics')
    expect(heartId).toBeTruthy()
    expect(lungId).toBeTruthy()

    const chunkSub = (id: string) => store.table('chunks').find((c) => c.id === id)?.subtopic_id
    // Heart chunks land together, lung chunks land together, and apart.
    expect(chunkSub('h0')).toBe(heartId)
    expect(chunkSub('h1')).toBe(heartId)
    expect(chunkSub('l0')).toBe(lungId)
    expect(chunkSub('l1')).toBe(lungId)

    // Questions were generated and tied to subtopics.
    const qs = store.table('questions').filter((q) => q.source === 'ai_generated')
    expect(qs.length).toBeGreaterThan(0)
  })
})
