import { UploadZone } from '@/components/exam/UploadZone'
import { BackButton } from '@/components/shared/BackButton'

export default function UploadPage({ params }: { params: { examId: string } }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <BackButton href={`/exam/${params.examId}`} label="Exam" />
      <UploadZone examId={params.examId} />
    </div>
  )
}
