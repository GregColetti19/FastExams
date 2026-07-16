'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Sun, Moon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useTheme, useThemeToggle } from '@/components/cadence'

export function Navbar() {
  const [user, setUser] = useState<{ email?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [dueCount, setDueCount] = useState(0)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const theme = useTheme()
  const toggleTheme = useThemeToggle()

  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setUser(user)

      if (user) {
        // Fetch due question count
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: dueQuestions } = await (supabase
          .from('questions')
          .select('id')
          .lte('next_review_at', new Date().toISOString())) as any

        setDueCount(dueQuestions?.length || 0)
      }

      setLoading(false)
    }

    checkUser()
  }, [supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Hide navbar on auth pages
  if (pathname.startsWith('/(auth)') || pathname.startsWith('/login') || pathname.startsWith('/signup')) {
    return null
  }

  // In dev, skip auth check
  if (loading) {
    return null
  }

  return (
    <nav className="border-b border-border-hair bg-surface">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/review" className="font-display text-[16px] text-ink">
              FastExams
            </Link>
            <div className="hidden items-center gap-1 md:flex">
              <NavLink href="/dashboard" label="Dashboard" pathname={pathname} />
              <div className="relative">
                <NavLink href="/review" label="Review" pathname={pathname} />
                {dueCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-coral px-1 text-[10px] text-white tabular-nums">
                    {dueCount}
                  </span>
                )}
              </div>
              <NavLink href="/analytics" label="Analytics" pathname={pathname} />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="rounded-control p-2 text-ink-muted transition-colors hover:bg-surface-inset hover:text-ink-secondary"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <span className="text-sm text-ink-muted">{user?.email || 'dev@example.com'}</span>
            {user && (
              <button onClick={handleSignOut} className="text-sm text-ink-muted hover:text-ink-secondary">
                Sign out
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}

function NavLink({
  href,
  label,
  pathname,
}: {
  href: string
  label: string
  pathname: string
}) {
  const isActive = pathname === href
  return (
    <Link
      href={href}
      className={`rounded-control px-3 py-2 text-sm transition-colors duration-150 ${
        isActive ? 'bg-surface-inset text-ink' : 'text-ink-muted hover:bg-surface-inset'
      }`}
    >
      {label}
    </Link>
  )
}
