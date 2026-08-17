import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient_ } from '@/lib/supabase/server'
import { Button } from '@/components/cadence/Button'

export const dynamic = 'force-dynamic'

// Public landing page — the one route outside the middleware auth gate. Signed-in
// visitors skip straight to their dashboard.
export default async function Home() {
  const supabase = await createServerClient_()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect('/dashboard')

  return (
    <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
      <h1 className="font-display text-[28px] tracking-[-0.01em] text-ink">FastExams</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
        Turn your course material into a study system. Upload your theory PDFs and past
        exams, and get quiz questions and flashcards generated from them — scheduled so
        you review each item right before you&apos;d forget it.
      </p>

      <div className="mt-8 flex items-center gap-3">
        <Link href="/login">
          <Button variant="primary">Sign in</Button>
        </Link>
        <Link href="/signup">
          <Button variant="ghost">Create account</Button>
        </Link>
      </div>

      <div className="mt-12 border-t border-border-hair pt-8">
        <h2 className="font-display text-[15px] text-ink">How it works</h2>
        <ol className="mt-3 space-y-2 text-sm text-ink-secondary">
          <li>1. Create an exam and upload your course PDFs.</li>
          <li>2. Questions and flashcards are generated from your own material.</li>
          <li>3. Study — right answers push the item further out, wrong ones bring it back sooner.</li>
        </ol>
      </div>

      {/* Alpha limits stated before anyone uploads, not after they hit them. */}
      <div className="mt-8 rounded-card border border-border-hair bg-surface-inset p-5">
        <h2 className="font-display text-[15px] text-ink">This is an alpha</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-muted">
          <li>
            Questions are multiple-choice. Open-answer questions in a past exam are
            reported as skipped rather than turned into cards.
          </li>
          <li>
            Prose subjects work best. Heavy mathematical notation degrades when PDFs are
            converted to text.
          </li>
          <li>PDF and PPTX only, up to 300MB per file.</li>
          <li>Generated questions can be wrong — flag them and it helps.</li>
        </ul>
      </div>
    </div>
  )
}
