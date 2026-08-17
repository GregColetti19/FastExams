import { createServerClient_ } from '@/lib/supabase/server'
import { ExamCard } from '@/components/exam/ExamCard'
import { NewExamDialog } from '@/components/exam/NewExamDialog'
import type { Exam, Topic, Subtopic, Question } from '@/types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createServerClient_()

  // Middleware guarantees a session here; the filter is belt-and-braces next to
  // RLS so this stays scoped even if enforcement is toggled off for debugging.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: exams, error: examsError }, { data: topics }, { data: subtopics }, { data: questions }] =
    await Promise.all([
      supabase
        .from('exams')
        .select('*')
        .eq('user_id', user?.id ?? '')
        .order('created_at', { ascending: false }) as any,
      supabase.from('topics').select('*') as any,
      supabase.from('subtopics').select('*') as any,
      supabase.from('questions').select('*') as any,
    ])

  if (examsError) console.error('Dashboard exams fetch error:', examsError)

  const E = (exams ?? []) as Exam[]
  const T = (topics ?? []) as Topic[]
  const S = (subtopics ?? []) as Subtopic[]
  const Q = (questions ?? []) as Question[]
  const now = new Date()

  // Per-exam mastery (avg of its subtopics) and due-today count, computed here
  // so ExamCard stays a pure presentational component.
  const examStats = new Map(
    E.map((exam) => {
      const examTopicIds = new Set(T.filter((t) => t.exam_id === exam.id).map((t) => t.id))
      const examSubs = S.filter((s) => examTopicIds.has(s.topic_id))
      const mastery = examSubs.length
        ? Math.round(examSubs.reduce((sum, s) => sum + s.mastery_score, 0) / examSubs.length)
        : 0
      const subIds = new Set(examSubs.map((s) => s.id))
      const dueCount = Q.filter(
        (q) =>
          subIds.has(q.subtopic_id) &&
          q.question_type !== 'flashcard' &&
          q.answer_status !== 'unanswerable' &&
          new Date(q.next_review_at) <= now
      ).length
      return [exam.id, { mastery, dueCount }]
    })
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] tracking-[-0.01em] text-ink">Exams</h1>
          <p className="mt-1 text-sm text-ink-muted">Manage your study materials and track progress</p>
        </div>
        <NewExamDialog />
      </div>

      {E.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))' }}>
          {E.map((exam) => (
            <ExamCard
              key={exam.id}
              exam={exam}
              mastery={examStats.get(exam.id)?.mastery ?? 0}
              dueCount={examStats.get(exam.id)?.dueCount ?? 0}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-card border border-border-hair bg-surface-inset py-12 text-center">
          <p className="text-ink-muted">No exams yet. Create one to get started!</p>
        </div>
      )}
    </div>
  )
}
