import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient_ } from '@/lib/supabase/server'

export default async function ReviewPage() {
  const supabase = await createServerClient_()

  // Dev mode: skip auth

  // Fetch due questions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dueQuestions } = await (supabase
    .from('questions')
    .select(
      `
    *,
    subtopic:subtopics(
      name,
      topic:topics(name)
    )
  `
    )
    .lte('next_review_at', new Date().toISOString())) as any

  if (!dueQuestions || dueQuestions.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <p className="text-slate-600 mb-4">No questions due for review right now.</p>
        <Link href="/dashboard" className="text-blue-600 hover:underline">
          Back to Dashboard
        </Link>
      </div>
    )
  }

  // Group by subtopic
  const groupedBySubtopic: Record<string, any[]> = {}
  dueQuestions.forEach((q: any) => {
    const subtopicId = q.subtopic_id
    if (!groupedBySubtopic[subtopicId]) {
      groupedBySubtopic[subtopicId] = []
    }
    groupedBySubtopic[subtopicId].push(q)
  })

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Review Queue</h1>
      <p className="text-slate-600 mb-6">{dueQuestions.length} questions due for review</p>

      <div className="space-y-4">
        {Object.entries(groupedBySubtopic).map(([subtopicId, questions]: [string, any[]]) => {
          const subtopic = questions[0].subtopic
          return (
            <div key={subtopicId} className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="text-sm text-slate-500">{subtopic.topic.name}</p>
                  <h3 className="text-lg font-semibold text-slate-900">{subtopic.name}</h3>
                </div>
                <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 text-sm rounded">
                  {questions.length}
                </span>
              </div>

              <Link
                href={`/quiz/${subtopicId}`}
                className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
              >
                Start Review
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
