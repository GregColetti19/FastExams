import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types'
import { isMockDb, assertRealConfig } from './mock-mode'
import { createFileMockClient } from './mock/persist'
import { devUser, useServiceRoleForDev } from './dev-auth'

export async function createServerClient_() {
  if (isMockDb()) return createFileMockClient() as any
  assertRealConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const cookieStore = await cookies()

  // Dev-auth bypass: no JWT is minted, so auth.uid() is NULL and dev's RLS
  // policies (now identical to live's, migration 014) would deny everything.
  // The service-role key skips RLS. useServiceRoleForDev() is false in any
  // production build, so this key is never selected in a deployed environment.
  const key = useServiceRoleForDev()
    ? process.env.SUPABASE_SERVICE_ROLE_KEY!
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ignore in static generation
          }
        },
      },
    }
  )
}

/**
 * Resolve the current user, honouring the dev-auth bypass.
 *
 * Every auth check should go through this rather than calling
 * `supabase.auth.getUser()` directly, so the bypass has exactly one
 * implementation instead of being re-derived per call site.
 *
 * In production `devUser()` is always null, so this is a plain getUser().
 */
export async function getCurrentUser(
  supabase: { auth: { getUser: () => Promise<{ data: { user: unknown } }> } }
): Promise<{ id: string; email?: string } | null> {
  const dev = devUser()
  if (dev) return dev
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return (user as { id: string; email?: string } | null) ?? null
}
