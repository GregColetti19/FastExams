import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="max-w-md text-center">
        <div className="mb-4 font-display text-[48px] text-ink-muted">404</div>
        <h2 className="mb-2 font-display text-[22px] text-ink">Page not found</h2>
        <p className="mb-6 text-sm text-ink-muted">The page you&apos;re looking for doesn&apos;t exist.</p>

        <Link
          href="/review"
          className="inline-block rounded-control bg-coral px-4 py-2 font-display text-white transition-colors duration-tempo hover:bg-coral-deep"
        >
          Back to Review
        </Link>
      </div>
    </div>
  )
}
