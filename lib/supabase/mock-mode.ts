// Browser-safe: must NOT import node:fs (this is bundled into client code).
// Server uses getFileStore() from ./mock/persist; browser uses
// createBrowserMockClient() from ./mock/browser-client.

/**
 * True when mock mode is on — use the in-memory/file-backed store, no cloud.
 * Checks NEXT_PUBLIC_DB_MODE too because the browser bundle only sees
 * NEXT_PUBLIC_* env vars at runtime (server code can use either).
 */
export function isMockDb(): boolean {
  return process.env.DB_MODE === 'mock' || process.env.NEXT_PUBLIC_DB_MODE === 'mock'
}

// Values shipped in .env.local.example — selecting the real client with these
// still set means "not configured".
const PLACEHOLDERS = ['your-project-url', 'your-anon-key', 'your-service-role-key']

/**
 * Guard the real-Supabase path: throw a clear, actionable error instead of
 * letting a misconfigured client surface as a cryptic "Failed to fetch".
 * Called only when mock mode is OFF.
 */
export function assertRealConfig(url: string | undefined, key: string | undefined): void {
  const bad = (v?: string) => !v || PLACEHOLDERS.some((p) => v.includes(p))
  if (bad(url) || bad(key)) {
    throw new Error(
      '[supabase] Real DB selected but SUPABASE URL/KEY are missing or placeholders. ' +
        'For local dev use the mock DB (DB_MODE=mock — the default in .env.development). ' +
        'For a real DB, set real NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.'
    )
  }
}
