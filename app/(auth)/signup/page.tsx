import { redirect } from 'next/navigation'
import { createServerClient_ } from '@/lib/supabase/server'
import { SignupForm } from '@/components/auth/SignupForm'

export default async function SignupPage() {
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
        <p className="text-sm text-slate-600 mt-2">Create your account</p>
      </div>
      <SignupForm />
    </div>
  )
}
