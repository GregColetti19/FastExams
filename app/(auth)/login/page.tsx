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
        <h1 className="text-3xl font-bold text-slate-900">FastExams</h1>
        <p className="text-sm text-slate-600 mt-2">Sign in to your account</p>
      </div>
      <LoginForm />
    </div>
  )
}
