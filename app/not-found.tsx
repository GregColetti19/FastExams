import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="text-center max-w-md">
        <div className="text-6xl font-bold text-slate-300 mb-4">404</div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Page not found</h2>
        <p className="text-slate-600 mb-6">The page you&apos;re looking for doesn&apos;t exist.</p>

        <Link href="/dashboard" className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
