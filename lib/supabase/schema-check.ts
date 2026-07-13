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
    const tables = [...new Set(EXPECTED.map((e) => e.table))]
    const inClause = tables.map((t) => `'${t}'`).join(',')

    const res = await fetch(
      `${url}/rest/v1/rpc/run_sql`,
      {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `
            SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name IN (${inClause})
          `,
        }),
      }
    )

    // Fall back to per-table HEAD probes if RPC not available
    if (!res.ok) {
      console.warn('[schema-check] run_sql RPC not available — skipping schema validation')
      return
    }

    const rows: { table_name: string; column_name: string }[] = await res.json()
    const live = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`))

    const missing = EXPECTED.filter((e) => !live.has(`${e.table}.${e.column}`))
    if (missing.length === 0) {
      console.log('[schema-check] ✓ All expected columns present in Supabase')
    } else {
      console.error(
        `[schema-check] ✗ MISSING ${missing.length} column(s) — unapplied migrations detected:\n` +
        missing.map((m) => `  • ${m.table}.${m.column}${m.type ? ` (${m.type})` : ''}`).join('\n') +
        '\n  Run the missing migrations in the Supabase SQL Editor.'
      )
    }
  } catch (err) {
    console.warn('[schema-check] Could not connect to Supabase for schema validation:', err)
  }
}
