import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'
import { runGenerateQuestions } from '@/lib/ai/generate-questions-run'
import { runRecalibrate } from '@/lib/ai/recalibrate-run'

// Exam-level question generation. Triggered by the user once ALL files are
// uploaded + converted ('ready'). Runs THEORY files first, then PAST_EXAM files,
// so past-exam answers can be grounded against the now-assigned theory subtopics.
// The presence/absence of past exams (decided over the full set) drives whether
// the theory pipeline AI-generates questions — see processTheoryFile's
// `hasPastExams` gate in /api/generate-questions.
export async function POST(request: NextRequest) {
  try {
    const { examId, retry = false, recalibrate = false } = await request.json()
    if (!examId) {
      return NextResponse.json({ error: 'examId required', code: 'MISSING_EXAM_ID' }, { status: 400 })
    }

    const supabase = await createServerClient_()

    // On retry: reset any orphaned generating_questions files back to ready so
    // they're included in the re-queued set. Safe to run even if nothing is stuck.
    if (retry) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('files') as any)
        .update({ processing_status: 'ready', processing_error: null })
        .eq('exam_id', examId)
        .eq('processing_status', 'generating_questions')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: files } = await supabase
      .from('files')
      .select('*')
      .eq('exam_id', examId) as any

    const ready = (files || []).filter(
      (f: any) => f.processing_status === 'ready'
    )
    if (ready.length === 0) {
      return NextResponse.json(
        { error: 'No converted files to generate from', code: 'NO_READY_FILES' },
        { status: 400 }
      )
    }

    // Theory first (builds the subtopic tree + chunk assignments), then past
    // exams (grounded against that theory).
    const ordered = [
      ...ready.filter((f: any) => f.file_role === 'theory'),
      ...ready.filter((f: any) => f.file_role === 'past_exam'),
    ]


    // Mark every selected file 'generating_questions' ONCE, up front, while this
    // route is the only writer. After this point generate-exam performs NO
    // further DB writes in the happy path — each generate-questions sub-request
    // is the sole writer for its own file's final status.
    //
    // Why this matters: under the mock DB, Next dev gives each route module its
    // OWN store singleton (see lib/supabase/mock/persist.ts). If generate-exam
    // wrote a file status mid-loop, it would save its stale in-memory table
    // snapshot and clobber a 'done' that a generate-questions sub-request had
    // already written to disk — leaving the file stuck at generating_questions.
    for (const f of ordered) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('files') as any)
        .update({ processing_status: 'generating_questions' })
        .eq('id', f.id)
    }

    // Fire-and-forget so the request returns immediately; the client polls file
    // statuses. The loop is sequential (awaited) to preserve theory→past order
    // (past-exam answers ground against the already-assigned theory subtopics).
    setImmediate(async () => {
      for (const f of ordered) {
        try {
          // In-process, not a self-fetch: fetching our own /api endpoint 404s
          // (the call resolves in the page-render context, not the route one).
          const res = await runGenerateQuestions(
            new Request('http://internal/api/generate-questions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileId: f.id, fileRole: f.file_role }),
            })
          )
          if (!res.ok) throw new Error(`generate-questions returned ${res.status}`)
        } catch (error) {
          console.error(`generate-exam: failed for file ${f.id}:`, error)
          try {
            // Fresh client reloads tables from disk first, so this error write
            // doesn't clobber statuses other sub-requests have since written.
            const fresh = await createServerClient_()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (fresh.from('files') as any)
              .update({
                processing_status: 'error',
                processing_error: `Generation failed: ${error instanceof Error ? error.message : String(error)}`,
              })
              .eq('id', f.id)
          } catch (dbError) {
            console.error(`generate-exam: failed to write error for ${f.id}:`, dbError)
          }
        }
      }

      // After new theory files are processed, re-ground any past-exam questions
      // that were previously unanswerable against the expanded chunk pool.
      if (recalibrate) {
        try {
          const res = await runRecalibrate(
            new Request('http://internal/api/recalibrate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ examId }),
            })
          )
          const result = await res.json().catch(() => ({}))
          console.log(`generate-exam: recalibrate done`, result)
        } catch (e) {
          console.error('generate-exam: recalibrate failed:', e)
        }
      }
    })

    return NextResponse.json({ success: true, queued: ordered.length }, { status: 202 })
  } catch (error) {
    console.error('generate-exam endpoint error:', error)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
