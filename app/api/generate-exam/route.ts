import { NextRequest, NextResponse } from 'next/server'
import { createServerClient_ } from '@/lib/supabase/server'

// Exam-level question generation. Triggered by the user once ALL files are
// uploaded + converted ('ready'). Runs THEORY files first, then PAST_EXAM files,
// so past-exam answers can be grounded against the now-assigned theory subtopics.
// The presence/absence of past exams (decided over the full set) drives whether
// the theory pipeline AI-generates questions — see processTheoryFile's
// `hasPastExams` gate in /api/generate-questions.
export async function POST(request: NextRequest) {
  try {
    const { examId } = await request.json()
    if (!examId) {
      return NextResponse.json({ error: 'examId required', code: 'MISSING_EXAM_ID' }, { status: 400 })
    }

    const supabase = await createServerClient_()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: files } = await supabase
      .from('files')
      .select('*')
      .eq('exam_id', examId) as any

    const ready = (files || []).filter(
      (f: any) => f.processing_status === 'ready' || f.processing_status === 'generating_questions'
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

    const base = request.nextUrl.origin

    // Fire-and-forget so the request returns immediately; the client polls file
    // statuses. The loop is sequential (awaited) to preserve theory→past order.
    setImmediate(async () => {
      for (const f of ordered) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from('files') as any)
            .update({ processing_status: 'generating_questions' })
            .eq('id', f.id)

          await fetch(`${base}/api/generate-questions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: f.id, fileRole: f.file_role }),
          })
        } catch (error) {
          console.error(`generate-exam: failed for file ${f.id}:`, error)
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('files') as any)
              .update({
                processing_status: 'error',
                processing_error: `Generation trigger failed: ${error instanceof Error ? error.message : String(error)}`,
              })
              .eq('id', f.id)
          } catch (dbError) {
            console.error(`generate-exam: failed to write error for ${f.id}:`, dbError)
          }
        }
      }
    })

    return NextResponse.json({ success: true, queued: ordered.length }, { status: 202 })
  } catch (error) {
    console.error('generate-exam endpoint error:', error)
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
