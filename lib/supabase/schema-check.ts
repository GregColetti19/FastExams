/**
 * Schema validator: compares expected columns against live Supabase schema.
 * Run at startup (called from instrumentation.ts) to catch unapplied migrations early.
 * No-ops in mock-DB mode.
 */
import { isMockDb } from './mock-mode'

interface ColumnSpec {
  table: string
  column: string
  type?: string // informational only, not enforced
}

const EXPECTED: ColumnSpec[] = [
  // chunks
  { table: 'chunks', column: 'id' },
  { table: 'chunks', column: 'file_id' },
  { table: 'chunks', column: 'subtopic_id' },
  { table: 'chunks', column: 'content_text' },
  { table: 'chunks', column: 'has_image' },
  { table: 'chunks', column: 'image_storage_path' },
  { table: 'chunks', column: 'page_or_slide' },
  { table: 'chunks', column: 'embedding', type: 'vector(1536)' },          // 005
  { table: 'chunks', column: 'candidate_topic' },                           // 006
  { table: 'chunks', column: 'candidate_subtopic' },                        // 006
  { table: 'chunks', column: 'language' },                                  // 006
  // questions
  { table: 'questions', column: 'id' },
  { table: 'questions', column: 'subtopic_id' },
  { table: 'questions', column: 'chunk_id' },
  { table: 'questions', column: 'matched_chunk_id' },
  { table: 'questions', column: 'question_text' },
  { table: 'questions', column: 'justification' },
  { table: 'questions', column: 'language' },
  { table: 'questions', column: 'question_type' },
  { table: 'questions', column: 'source' },
  { table: 'questions', column: 'past_exam_year' },
  { table: 'questions', column: 'embedding' },
  { table: 'questions', column: 'ai_confidence' },                          // 004
  { table: 'questions', column: 'answer_status' },                          // 004
  { table: 'questions', column: 'flagged_at' },                             // 002
  { table: 'questions', column: 'flag_reason' },                            // 002
  { table: 'questions', column: 'times_seen' },
  { table: 'questions', column: 'times_correct' },
  { table: 'questions', column: 'next_review_at' },
  // files
  { table: 'files', column: 'file_role' },
  { table: 'files', column: 'processing_status' },
  { table: 'files', column: 'processing_error' },
  // exams / topics / subtopics / sessions / attempts
  { table: 'exams', column: 'language' },
  { table: 'subtopics', column: 'mastery_score' },
  { table: 'study_sessions', column: 'subtopic_id' },
  { table: 'question_options', column: 'display_order' },
]

export async function checkSchema(): Promise<void> {
  if (isMockDb()) return

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return

  try {
    // PostgREST's OpenAPI document lists the real columns of every exposed
    // table, generated from the live catalog. The previous implementation
    // called a `run_sql` RPC that has NEVER existed in this project — every
    // boot 404'd and skipped, so this check silently validated nothing while
    // migrations 010-012 sat unapplied. Anything here must use an endpoint
    // that actually exists.
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })

    if (!res.ok) {
      console.warn(`[schema-check] schema fetch failed (HTTP ${res.status}) — skipping validation`)
      return
    }

    const spec = (await res.json()) as {
      definitions?: Record<string, { properties?: Record<string, unknown> }>
    }
    const defs = spec.definitions
    if (!defs) {
      console.warn('[schema-check] no table definitions in schema document — skipping validation')
      return
    }

    const missing = EXPECTED.filter(
      (e) => !defs[e.table]?.properties || !(e.column in (defs[e.table]!.properties as object))
    )

    if (missing.length === 0) {
      console.log(`[schema-check] ✓ all ${EXPECTED.length} expected columns present`)
    } else {
      console.error(
        `[schema-check] ✗ MISSING ${missing.length} column(s) — unapplied migrations detected:\n` +
          missing.map((m) => `  • ${m.table}.${m.column}${m.type ? ` (${m.type})` : ''}`).join('\n') +
          '\n  Apply the pending migrations (see supabase/migrations/).'
      )
    }
  } catch (err) {
    console.warn('[schema-check] Could not connect to Supabase for schema validation:', err)
  }
}
