import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types'
import { isMockDb, assertRealConfig } from './mock-mode'
import { createBrowserMockClient } from './mock/browser-client'

export function createClient() {
  if (isMockDb()) return createBrowserMockClient() as any
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  assertRealConfig(url, key)
  return createBrowserClient<Database>(url!, key!)
}
