import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient_ } from '@/lib/supabase/server'
import { TopicGrid } from '@/components/exam/TopicGrid'

export default async function ExamPage({ params }: { params: { examId: string } }) {
  const supabase = await createServerClient_()

  // Dev mode: skip auth
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: exam } = (await supabase
    .from('exams')
    .select('*')
    .eq('id', params.examId)
    .single()) as any

  if (!exam) {
    redirect('/dashboard')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: topics } = (await supabase
    .from('topics')
    .select(`
      *,
      subtopics (*)
    `)
    .eq('exam_id', params.examId)
    .order('display_order')) as any

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{exam.name}</h1>
          {exam.description && (
            <p className="text-slate-600 mt-2">{exam.description}</p>
          )}
        </div>
        <Link
          href={`/exam/${exam.id}/upload`}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Upload Files
        </Link>
      </div>

      {topics && topics.length > 0 ? (
        <TopicGrid topics={topics} examId={params.examId} />
      ) : (
        <div className="text-center py-12 bg-slate-50 rounded-lg">
          <p className="text-slate-600 mb-4">No topics yet. Upload files to get started!</p>
          <Link
            href={`/exam/${exam.id}/upload`}
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Upload Files
          </Link>
        </div>
      )}
    </div>
  )
}
