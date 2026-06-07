import { redirect } from 'next/navigation'
import { createServerClient_ } from '@/lib/supabase/server'
import { QuizEngine } from '@/components/quiz/QuizEngine'

export default async function QuizPage({ params }: { params: { subtopicId: string } }) {
  const supabase = await createServerClient_()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch subtopic with topic/exam info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subtopic } = await (supabase
    .from('subtopics')
    .select(
      `
    *,
    topic:topics(
      *,
      exam:exams(*)
    )
  `
    )
    .eq('id', params.subtopicId)
    .single()) as any

  if (!subtopic) {
    redirect('/dashboard')
  }

  // Fetch questions for this subtopic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: questions } = await (supabase
    .from('questions')
    .select('*')
    .eq('subtopic_id', params.subtopicId)) as any

  if (!questions || questions.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <p className="text-slate-600">No questions available for this subtopic.</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">{subtopic.name}</h1>
      <QuizEngine
        subtopicId={params.subtopicId}
        questionIds={questions.map((q: any) => q.id)}
        topicName={subtopic.topic.name}
      />
    </div>
  )
}
