import { redirect } from 'next/navigation'
import { createServerClient_ } from '@/lib/supabase/server'

export default async function ReviewPage() {
  const supabase = await createServerClient_()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-3xl font-bold text-slate-900 mb-4">Review Queue</h1>
      <p className="text-slate-600">Questions due for review will appear here</p>
    </div>
  )
}
