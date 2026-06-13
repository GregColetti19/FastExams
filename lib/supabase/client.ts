import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types'
import { isMockDb } from './mock-mode'
import { createBrowserMockClient } from './mock/browser-client'

export function createClient() {
  if (isMockDb()) return createBrowserMockClient() as any
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
