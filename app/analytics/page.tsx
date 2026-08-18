import { createServerClient_, getCurrentUser } from '@/lib/supabase/server'
import { AnalyticsView } from '@/components/analytics/AnalyticsView'
import type { Exam, Topic, Subtopic, Question, QuestionAttempt } from '@/types'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
  const supabase = await createServerClient_()

  // See DashboardPage: explicit scoping alongside RLS.
  const user = await getCurrentUser(supabase)

  const [{ data: exams }, { data: topics }, { data: subtopics }, { data: questions }, { data: attempts }] =
    await Promise.all([
      supabase.from('exams').select('*').eq('user_id', user?.id ?? '') as any,
      supabase.from('topics').select('*') as any,
      supabase.from('subtopics').select('*') as any,
      supabase.from('questions').select('*') as any,
      supabase.from('question_attempts').select('*') as any,
    ])

  return (
    <AnalyticsView
      exams={(exams ?? []) as Exam[]}
      topics={(topics ?? []) as Topic[]}
      subtopics={(subtopics ?? []) as Subtopic[]}
      questions={(questions ?? []) as Question[]}
      attempts={(attempts ?? []) as QuestionAttempt[]}
    />
  )
}
