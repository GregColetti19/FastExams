'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/cadence/Button'

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className="w-full rounded-control border border-border-hair bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-border-strong"
    {...props}
  />
)

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        setError(authError.message)
        return
      }

      router.push('/dashboard')
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-card border border-border-hair bg-surface p-6">
      <div>
        <label className="mb-2 block text-sm text-ink-secondary">Email</label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          disabled={loading}
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-ink-secondary">Password</label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          disabled={loading}
        />
      </div>

      {error && <div className="rounded-control bg-coral/10 p-3 text-sm text-coral-soft">{error}</div>}

      <Button type="submit" variant="primary" disabled={loading} className="w-full">
        {loading ? 'Signing in…' : 'Sign in'}
      </Button>

      <p className="text-center text-sm text-ink-muted">
        Don&apos;t have an account?{' '}
        <a href="/signup" className="text-ink-secondary underline hover:text-ink">
          Sign up
        </a>
      </p>
    </form>
  )
}
