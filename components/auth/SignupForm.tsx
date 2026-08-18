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

export function SignupForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (authError) {
        // Supabase's raw auth messages describe its own internals, not what the
        // person should do next. Translate the two that testers actually hit.
        const raw = authError.message.toLowerCase()
        if (raw.includes('rate limit')) {
          setError('Too many sign-up attempts. Please wait a few minutes and try again.')
        } else if (raw.includes('invalid') && raw.includes('email')) {
          setError('That email address was rejected. Please use a different one.')
        } else {
          setError(authError.message)
        }
        return
      }

      // Branch on what came back rather than on a dashboard setting we cannot
      // see: Supabase returns a session when email confirmation is off, and
      // none when it is on. Showing "check your email" to an already-signed-in
      // user strands them on a screen waiting for mail that never arrives.
      if (data.session) {
        router.push('/dashboard')
        router.refresh()
        return
      }

      setSuccess(true)
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="rounded-card border border-teal-700/30 bg-teal-800/10 p-6 text-center">
        <p className="text-teal-100">Check your email</p>
        <p className="mt-2 text-sm text-ink-secondary">
          We&apos;ve sent you a confirmation link. Please check your inbox to verify your account.
        </p>
      </div>
    )
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

      <div>
        <label className="mb-2 block text-sm text-ink-secondary">Confirm password</label>
        <Input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="••••••••"
          required
          disabled={loading}
        />
      </div>

      {error && <div className="rounded-control bg-coral/10 p-3 text-sm text-coral-soft">{error}</div>}

      <Button type="submit" variant="primary" disabled={loading} className="w-full">
        {loading ? 'Creating account…' : 'Create account'}
      </Button>

      <p className="text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <a href="/login" className="text-ink-secondary underline hover:text-ink">
          Sign in
        </a>
      </p>
    </form>
  )
}
