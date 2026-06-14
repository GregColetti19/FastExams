import Link from 'next/link'
import { Exam } from '@/types'
import { ProgressRing } from '@/components/shared/ProgressRing'
import { DeleteExamButton } from '@/components/exam/DeleteExamButton'

export function ExamCard({ exam }: { exam: Exam }) {
  const formattedDate = new Date(exam.created_at).toLocaleDateString()

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-slate-900">{exam.name}</h3>
          {exam.description && (
            <p className="text-sm text-slate-600 mt-1 line-clamp-2">{exam.description}</p>
          )}
          <p className="text-xs text-slate-500 mt-2">Created {formattedDate}</p>
        </div>
        <div className="ml-4 flex items-start gap-1">
          <ProgressRing percent={0} size={80} strokeWidth={3} />
          <DeleteExamButton examId={exam.id} examName={exam.name} />
        </div>
      </div>

      <Link
        href={`/exam/${exam.id}`}
        className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
      >
        Open
      </Link>
    </div>
  )
}
