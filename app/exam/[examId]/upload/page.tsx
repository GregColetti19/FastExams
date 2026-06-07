import { UploadZone } from '@/components/exam/UploadZone'

export default function UploadPage({ params }: { params: { examId: string } }) {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <UploadZone examId={params.examId} />
    </div>
  )
}
