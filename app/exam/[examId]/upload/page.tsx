import { UploadZone } from '@/components/exam/UploadZone'
import { BackButton } from '@/components/shared/BackButton'

export default function UploadPage({ params }: { params: { examId: string } }) {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <BackButton href={`/exam/${params.examId}`} label="Exam" />
      <UploadZone examId={params.examId} />
    </div>
  )
}
