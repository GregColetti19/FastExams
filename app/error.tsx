'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="text-center max-w-md">
        <h2 className="text-3xl font-bold text-red-600 mb-4">Something went wrong</h2>
        <p className="text-slate-600 mb-2">{error.message || 'An unexpected error occurred.'}</p>
        {error.digest && (
          <p className="text-xs text-slate-400 font-mono mb-6">
            Ref: {error.digest}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => reset()}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Try again
          </button>
          <Link href="/dashboard" className="flex-1 px-4 py-2 bg-slate-200 text-slate-900 rounded-lg hover:bg-slate-300 text-center">
            Home
          </Link>
        </div>
      </div>
    </div>
  )
}
