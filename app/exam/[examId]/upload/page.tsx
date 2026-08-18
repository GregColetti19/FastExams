import { redirect } from 'next/navigation'
import { createServerClient_ } from '@/lib/supabase/server'
import { UploadZone } from '@/components/exam/UploadZone'
import { BackButton } from '@/components/shared/BackButton'
import { DeleteExamButton } from '@/components/exam/DeleteExamButton'

export const dynamic = 'force-dynamic'

export default async function UploadPage({ params }: { params: { examId: string } }) {
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between">
        <BackButton href={`/exam/${params.examId}`} label="Exam" />
        <DeleteExamButton examId={params.examId} examName={exam.name} redirectTo="/dashboard" />
      </div>
      <UploadZone examId={params.examId} />
    </div>
  )
}
