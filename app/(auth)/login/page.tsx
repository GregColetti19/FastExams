import { redirect } from 'next/navigation'
import { createServerClient_ } from '@/lib/supabase/server'
import { LoginForm } from '@/components/auth/LoginForm'

export default async function LoginPage() {
  const supabase = await createServerClient_()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="font-display text-[22px] tracking-[-0.01em] text-ink">FastExams</h1>
        <p className="mt-2 text-sm text-ink-muted">Sign in to your account</p>
      </div>
      <LoginForm />
    </div>
  )
}
