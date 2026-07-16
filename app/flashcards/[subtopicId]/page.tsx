import { redirect } from 'next/navigation'
import { createServerClient_ } from '@/lib/supabase/server'
import { FlashcardEngine } from '@/components/flashcards/FlashcardEngine'
import { BackButton } from '@/components/shared/BackButton'

export default async function FlashcardsPage({ params }: { params: { subtopicId: string } }) {
  const supabase = await createServerClient_()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subtopic } = await (supabase
    .from('subtopics')
    .select('*')
    .eq('id', params.subtopicId)
    .single()) as any

  if (!subtopic) redirect('/dashboard')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: topic } = await (supabase
    .from('topics')
    .select('exam_id')
    .eq('id', subtopic.topic_id)
    .single()) as any

  const examId = (topic as any)?.exam_id ?? ''

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <BackButton label="Exam" href={examId ? `/exam/${examId}` : '/dashboard'} />
      <h1 className="mb-6 font-display text-[22px] tracking-[-0.01em] text-ink">
        Flashcards: {subtopic.name}
      </h1>
      <FlashcardEngine subtopicId={params.subtopicId} examId={examId} />
    </div>
  )
}
