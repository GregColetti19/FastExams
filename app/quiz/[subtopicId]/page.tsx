import { redirect } from 'next/navigation'
import { createServerClient_ } from '@/lib/supabase/server'
import { QuizEngine } from '@/components/quiz/QuizEngine'
import { BackButton } from '@/components/shared/BackButton'

export default async function QuizPage({
  params,
  searchParams,
}: {
  params: { subtopicId: string }
  searchParams?: { due?: string }
}) {
  const supabase = await createServerClient_()
  const dueOnly = searchParams?.due === '1'

  // Dev mode: skip auth

  // Fetch subtopic, then its topic separately (the mock DB doesn't resolve
  // nested relational selects).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subtopic } = await (supabase
    .from('subtopics')
    .select('*')
    .eq('id', params.subtopicId)
    .single()) as any

  if (!subtopic) {
    redirect('/dashboard')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: topic } = await (supabase
    .from('topics')
    .select('*')
    .eq('id', subtopic.topic_id)
    .single()) as any
  const topicName = topic?.name ?? ''

  // Fetch questions for this subtopic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawQuestions } = await (supabase
    .from('questions')
    .select('*')
    .eq('subtopic_id', params.subtopicId)) as any

  // Quiz only answerable MCQs: drop flashcards and AI-unanswerable past-exam
  // questions (they have no correct option). With ?due=1, scope to questions
  // due for spaced-repetition review.
  const now = new Date().toISOString()
  const questions = (rawQuestions || []).filter((q: any) => {
    if (q.question_type === 'flashcard') return false
    if (q.answer_status === 'unanswerable') return false
    if (dueOnly && q.next_review_at && q.next_review_at > now) return false
    return true
  })

  if (questions.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <p className="text-slate-600">
          {dueOnly ? 'Nothing due for review in this subtopic.' : 'No questions available for this subtopic.'}
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <BackButton label="Back" />
      <h1 className="text-2xl font-bold text-slate-900 mb-6">{subtopic.name}</h1>
      <QuizEngine
        subtopicId={params.subtopicId}
        questionIds={questions.map((q: any) => q.id)}
        topicName={topicName}
      />
    </div>
  )
}
