import { redirect } from 'next/navigation'
import { createServerClient_ } from '@/lib/supabase/server'
import { FlashcardEngine } from '@/components/flashcards/FlashcardEngine'

export default async function FlashcardsPage({ params }: { params: { subtopicId: string } }) {
  const supabase = await createServerClient_()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch subtopic info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subtopic } = await (supabase
    .from('subtopics')
    .select('*')
    .eq('id', params.subtopicId)
    .single()) as any

  if (!subtopic) {
    redirect('/dashboard')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Flashcards: {subtopic.name}</h1>
      <FlashcardEngine subtopicId={params.subtopicId} />
    </div>
  )
}
