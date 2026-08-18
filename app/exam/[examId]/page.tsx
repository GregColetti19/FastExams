import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient_ } from '@/lib/supabase/server'
import { TopicGrid } from '@/components/exam/TopicGrid'
import { BackButton } from '@/components/shared/BackButton'
import { ActiveToggle } from '@/components/exam/ActiveToggle'
import { DeleteExamButton } from '@/components/exam/DeleteExamButton'
import { IconChip, button } from '@/components/cadence'
import { seedAccent } from '@/lib/icons/registry'
import type { Question } from '@/types'

export const dynamic = 'force-dynamic'

export default async function ExamPage({ params }: { params: { examId: string } }) {
  const supabase = await createServerClient_()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: exam } = (await supabase
    .from('exams')
    .select('*')
    .eq('id', params.examId)
    .single()) as any

  if (!exam) {
    redirect('/dashboard')
  }

  // Fetch topics, then their subtopics separately and attach (the mock DB has
  // no FK-join engine; this shape also works against real Supabase).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawTopics } = (await supabase
    .from('topics')
    .select('*')
    .eq('exam_id', params.examId)
    .order('display_order')) as any

  const topicIds = (rawTopics || []).map((t: any) => t.id)
  let subtopics: any[] = []
  if (topicIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = (await supabase.from('subtopics').select('*').in('topic_id', topicIds)) as any
    subtopics = data || []
  }
  const topics = (rawTopics || []).map((t: any) => ({
    ...t,
    subtopics: subtopics.filter((s) => s.topic_id === t.id),
  }))

  // Next-due-in-days per subtopic, from its soonest-due quizzable question.
  const dueInDays: Record<string, number | null> = {}
  const subIds = subtopics.map((s) => s.id)
  if (subIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rawQuestions } = (await supabase.from('questions').select('*').in('subtopic_id', subIds)) as any
    const Q = (rawQuestions || []) as Question[]
    const now = new Date()
    for (const s of subtopics) {
      const dues = Q.filter(
        (q) => q.subtopic_id === s.id && q.question_type !== 'flashcard' && q.answer_status !== 'unanswerable'
      ).map((q) => new Date(q.next_review_at))
      if (dues.length === 0) {
        dueInDays[s.id] = null
      } else {
        const soonest = new Date(Math.min(...dues.map((d) => d.getTime())))
        dueInDays[s.id] = Math.round((soonest.getTime() - now.getTime()) / 86_400_000)
      }
    }
  }

  const mastery = subtopics.length
    ? Math.round(subtopics.reduce((sum, s) => sum + s.mastery_score, 0) / subtopics.length)
    : 0

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <BackButton href="/dashboard" label="Dashboard" />
      <div className="mb-8 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <IconChip name={null} accent={seedAccent(exam.id)} size={44} />
          <div>
            <h1 className="font-display text-[22px] tracking-[-0.01em] text-ink">{exam.name}</h1>
            <p className="mt-1 text-sm text-ink-muted tabular-nums">
              {mastery}% mastery · {topics.length} topic{topics.length === 1 ? '' : 's'}
            </p>
            {exam.description && <p className="mt-2 text-sm text-ink-secondary">{exam.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ActiveToggle examId={exam.id} active={exam.active !== false} />
          <Link href={`/exam/${exam.id}/upload`} className={button({ variant: 'primary' })}>
            + Upload files
          </Link>
          <DeleteExamButton examId={exam.id} examName={exam.name} redirectTo="/dashboard" />
        </div>
      </div>

      {topics && topics.length > 0 ? (
        <TopicGrid topics={topics} examId={params.examId} dueInDays={dueInDays} />
      ) : (
        <div className="rounded-card border border-border-hair bg-surface-inset py-12 text-center">
          <p className="mb-4 text-ink-muted">No topics yet. Upload files to get started!</p>
          <Link href={`/exam/${exam.id}/upload`} className={button({ variant: 'primary' })}>
            Upload files
          </Link>
        </div>
      )}
    </div>
  )
}
