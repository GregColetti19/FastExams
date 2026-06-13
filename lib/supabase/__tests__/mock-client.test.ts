import { describe, it, expect, beforeEach } from 'vitest'
import { createMockClient } from '@/lib/supabase/mock/client'
import { getMockStore, resetMockStore, DEV_USER } from '@/lib/supabase/mock/store'

const db = () => createMockClient(getMockStore())

beforeEach(() => resetMockStore())

describe('mock client: insert + select', () => {
  it('insert().select() returns rows with generated id + created_at', async () => {
    const { data, error } = await db().from('exams').insert({ name: 'Anatomy' }).select()
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBeTruthy()
    expect(data[0].created_at).toBeTruthy()
    expect(data[0].name).toBe('Anatomy')
  })

  it('insert without select returns null data but persists', async () => {
    const res = await db().from('topics').insert([{ exam_id: 'e1', name: 'T' }])
    expect(res.data).toBeNull()
    const { data } = await db().from('topics').select('*')
    expect(data).toHaveLength(1)
  })

  it('applies schema defaults on insert (questions spaced-rep fields)', async () => {
    const { data } = await db()
      .from('questions')
      .insert({ subtopic_id: 's1', question_text: 'Q', justification: 'J' })
      .select()
      .single()
    expect(data.times_seen).toBe(0)
    expect(data.current_interval_days).toBe(1)
    expect(data.source).toBe('ai_generated')
    expect(data.next_review_at).toBeTruthy()
  })
})

describe('mock client: filters', () => {
  beforeEach(() => {
    getMockStore().seed('files', [
      { id: 'f1', exam_id: 'e1', processing_status: 'done' },
      { id: 'f2', exam_id: 'e1', processing_status: 'pending' },
      { id: 'f3', exam_id: 'e2', processing_status: 'pending' },
    ])
  })

  it('eq filters', async () => {
    const { data } = await db().from('files').select('*').eq('exam_id', 'e1')
    expect(data).toHaveLength(2)
  })

  it('single() returns one row', async () => {
    const { data, error } = await db().from('files').select('*').eq('id', 'f1').single()
    expect(error).toBeNull()
    expect(data.id).toBe('f1')
  })

  it('single() errors (PGRST116) when not exactly one row', async () => {
    const { data, error } = await db().from('files').select('*').eq('exam_id', 'e1').single()
    expect(data).toBeNull()
    expect(error?.code).toBe('PGRST116')
  })

  it('in() filters by set', async () => {
    const { data } = await db().from('files').select('*').in('id', ['f1', 'f3'])
    expect(data.map((r: any) => r.id).sort()).toEqual(['f1', 'f3'])
  })
})

describe('mock client: update + delete', () => {
  beforeEach(() => {
    getMockStore().seed('files', [{ id: 'f1', processing_status: 'pending' }])
  })

  it('update().eq() mutates matching rows', async () => {
    await db().from('files').update({ processing_status: 'done' }).eq('id', 'f1')
    const { data } = await db().from('files').select('*').eq('id', 'f1').single()
    expect(data.processing_status).toBe('done')
  })

  it('delete().eq() removes rows', async () => {
    await db().from('files').delete().eq('id', 'f1')
    const { data } = await db().from('files').select('*')
    expect(data).toHaveLength(0)
  })
})

describe('mock client: order + limit + lte', () => {
  beforeEach(() => {
    getMockStore().seed('questions', [
      { id: 'q1', next_review_at: '2024-01-03', subtopic_id: 's1', question_text: '', justification: '' },
      { id: 'q2', next_review_at: '2024-01-01', subtopic_id: 's1', question_text: '', justification: '' },
      { id: 'q3', next_review_at: '2099-01-01', subtopic_id: 's1', question_text: '', justification: '' },
    ])
  })

  it('lte + order ascending surfaces due-first (review queue pattern)', async () => {
    const { data } = await db()
      .from('questions')
      .select('*')
      .lte('next_review_at', '2024-12-31')
      .order('next_review_at')
    expect(data.map((r: any) => r.id)).toEqual(['q2', 'q1'])
  })

  it('limit caps results', async () => {
    const { data } = await db().from('questions').select('*').limit(1)
    expect(data).toHaveLength(1)
  })
})

describe('mock storage + auth', () => {
  it('upload then download round-trips bytes', async () => {
    const sb = db()
    const buf = new TextEncoder().encode('pdf-bytes')
    const up = await sb.storage.from('uploads').upload('e1/file.pdf', buf)
    expect(up.error).toBeNull()
    const down = await sb.storage.from('uploads').download('e1/file.pdf')
    expect(down.error).toBeNull()
    const text = await (down.data as Blob).text()
    expect(text).toBe('pdf-bytes')
  })

  it('download missing object errors', async () => {
    const down = await db().storage.from('uploads').download('nope')
    expect(down.data).toBeNull()
    expect(down.error).toBeTruthy()
  })

  it('auth.getUser returns the dev user', async () => {
    const { data } = await db().auth.getUser()
    expect(data.user.id).toBe(DEV_USER.id)
  })
})
