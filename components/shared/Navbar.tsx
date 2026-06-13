'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export function Navbar() {
  const [user, setUser] = useState<{ email?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [dueCount, setDueCount] = useState(0)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

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
    <nav className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="text-lg font-bold text-slate-900">
              FastExams
            </Link>
            <div className="hidden md:flex gap-1 items-center">
              <NavLink href="/dashboard" label="Dashboard" pathname={pathname} />
              <div className="relative">
                <NavLink href="/review" label="Review" pathname={pathname} />
                {dueCount > 0 && (
                  <span className="absolute -top-2 -right-2 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-red-600 rounded-full">
                    {dueCount}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">{user?.email || 'dev@example.com'}</span>
            {user && (
              <button
                onClick={handleSignOut}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
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
      className={`px-3 py-2 rounded-md text-sm font-medium ${
        isActive
          ? 'bg-blue-50 text-blue-600'
          : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </Link>
  )
}
