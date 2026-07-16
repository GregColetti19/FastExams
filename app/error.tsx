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
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="max-w-md text-center">
        <h2 className="mb-4 font-display text-[22px] text-coral">Something went wrong</h2>
        <p className="mb-2 text-sm text-ink-secondary">{error.message || 'An unexpected error occurred.'}</p>
        {error.digest && (
          <p className="mb-6 font-mono text-xs text-ink-muted">Ref: {error.digest}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => reset()}
            className="flex-1 rounded-control bg-coral px-4 py-2 font-display text-white transition-colors duration-tempo hover:bg-coral-deep"
          >
            Try again
          </button>
          <Link
            href="/review"
            className="flex-1 rounded-control border border-border-hair px-4 py-2 text-center text-ink-secondary transition-colors duration-150 hover:border-border-strong"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  )
}
