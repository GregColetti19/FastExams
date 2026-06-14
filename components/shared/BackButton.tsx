'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

/**
 * "Go Back" control with an intuitive left arrow. Pass `href` to go to a
 * specific page, or omit it to go back in history.
 */
export function BackButton({ href, label = 'Go Back' }: { href?: string; label?: string }) {
  const router = useRouter()
  const className =
    'inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors mb-4'

  if (href) {
    return (
      <Link href={href} className={className}>
        <ArrowLeft size={16} />
        {label}
      </Link>
    )
  }

  return (
    <button onClick={() => router.back()} className={className}>
      <ArrowLeft size={16} />
      {label}
    </button>
  )
}
