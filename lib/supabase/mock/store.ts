// In-memory data store backing the mock Supabase client.
//
// Holds one array of rows per table plus a flat storage map. A single shared
// instance (getMockStore) lets API routes and tests see the same data, so the
// upload → process → generate → record pipeline runs fully offline, no cloud.

import { bytesToB64, b64ToBytes } from './base64'

export type Row = Record<string, any>

export const DEV_USER = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'dev@local',
}

// Column defaults applied on insert when the caller omits them, mirroring the
// DB schema's DEFAULT clauses (see supabase/migrations/001_initial_schema.sql).
const DEFAULTS: Record<string, () => Row> = {
  files: () => ({ processing_status: 'pending', processing_error: null, file_role: 'theory' }),
  subtopics: () => ({ mastery_score: 0, display_order: 0 }),
  topics: () => ({ display_order: 0 }),
  questions: () => ({
    times_seen: 0,
    times_correct: 0,
    current_interval_days: 1,
    last_seen_at: null,
    next_review_at: new Date().toISOString(),
    source: 'ai_generated',
    question_type: 'mcq',
    ai_confidence: null,
    answer_status: 'ai_answered',
  }),
  study_sessions: () => ({ total_questions: 0, correct_count: 0, completed_at: null }),
}

export class MockStore {
  tables = new Map<string, Row[]>()
  storage = new Map<string, Uint8Array>()
  devUser = DEV_USER

  /** Called after every mutation. Used by the file-backed store to persist. */
  onMutate?: () => void

  /** Replace all table data from a plain object (file load). */
  loadTables(data: Record<string, Row[]>): void {
    this.tables.clear()
    for (const [name, rows] of Object.entries(data)) this.tables.set(name, rows)
  }

  /** Serialize table data to a plain object (file save). */
  dumpTables(): Record<string, Row[]> {
    return Object.fromEntries(this.tables)
  }

  /** Serialize uploaded bytes as base64 so they persist across requests. */
  dumpStorage(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of this.storage) out[k] = bytesToB64(v)
    return out
  }

  /** Restore uploaded bytes from a base64 map (file load). */
  loadStorage(data: Record<string, string>): void {
    this.storage.clear()
    for (const [k, v] of Object.entries(data)) this.storage.set(k, b64ToBytes(v))
  }

  table(name: string): Row[] {
    if (!this.tables.has(name)) this.tables.set(name, [])
    return this.tables.get(name)!
  }

  /** Apply id + created_at + schema defaults to a row being inserted. */
  withDefaults(name: string, row: Row): Row {
    const base = DEFAULTS[name]?.() ?? {}
    return {
      id: row.id ?? crypto.randomUUID(),
      created_at: row.created_at ?? new Date().toISOString(),
      ...base,
      ...row,
    }
  }

  /** Seed rows for a table (test helper). Returns the inserted rows. */
  seed(name: string, rows: Row[]): Row[] {
    const prepared = rows.map((r) => this.withDefaults(name, r))
    this.table(name).push(...prepared)
    return prepared
  }

  reset(): void {
    this.tables.clear()
    this.storage.clear()
  }
}

let singleton: MockStore | null = null

export function getMockStore(): MockStore {
  if (!singleton) singleton = new MockStore()
  return singleton
}

export function resetMockStore(): void {
  getMockStore().reset()
}
