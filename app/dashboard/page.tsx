import { redirect } from 'next/navigation'
import { createServerClient_ } from '@/lib/supabase/server'
import { ExamCard } from '@/components/exam/ExamCard'
import { NewExamDialog } from '@/components/exam/NewExamDialog'

export default async function DashboardPage() {
  const supabase = await createServerClient_()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: exams, error: examsError } = (await supabase
    .from('exams')
    .select('id, name, description, created_at, updated_at, user_id, language')
    .order('created_at', { ascending: false })) as any

  if (examsError) console.error('Dashboard exams fetch error:', examsError)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Exams</h1>
          <p className="text-slate-600 mt-1">Manage your study materials and track progress</p>
        </div>
        <NewExamDialog />
      </div>

      {exams && exams.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {exams.map((exam: any) => (
            <ExamCard key={exam.id} exam={exam} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-slate-50 rounded-lg">
          <p className="text-slate-600">No exams yet. Create one to get started!</p>
        </div>
      )}
    </div>
  )
}
