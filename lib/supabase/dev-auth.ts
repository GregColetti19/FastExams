// Dev-auth bypass: skip sign-in when running locally against the dev database.
//
// WHY: DB_MODE=mock already runs auth-free (the mock client returns a canned
// user), but the middle case — local dev against the REAL dev Supabase project
// — still forced a login for a single-developer project. This closes that gap
// without touching the live authorisation path.
//
// SAFETY: this must be impossible to enable in production by accident, so it
// requires ALL of:
//   1. DEV_AUTH_BYPASS=true          — explicit opt-in, never set in deploy env
//   2. NODE_ENV !== 'production'     — dead code in a production build
//   3. DEV_USER_ID set to a real uuid — the identity to act as
// Any one missing → bypass off → normal auth. A production build cannot enable
// it even if the env var leaks into the deploy, because of (2).
//
// Live (Railway) sets none of these, so it keeps full auth + the admin layer.

/** True when the dev-auth bypass is active. False in any production build. */
export function isDevAuthBypass(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEV_AUTH_BYPASS === 'true' &&
    Boolean(process.env.DEV_USER_ID)
  )
}

/**
 * The user to act as when the bypass is on. Returns a shape compatible with
 * the `user` object callers read (`user.id`, `user.email`).
 *
 * The id MUST be a real auth.users row in the dev project: it is written to
 * exams.user_id and used as the storage path prefix, so a fabricated uuid would
 * create rows that the real auth path can never see.
 */
export function devUser(): { id: string; email: string } | null {
  if (!isDevAuthBypass()) return null
  return {
    id: process.env.DEV_USER_ID!,
    email: process.env.DEV_USER_EMAIL || 'dev@local',
  }
}

// LIMITATION — the bypass supplies an application-level identity only. It does
// NOT mint a Supabase JWT, so `auth.uid()` is NULL in the database and every
// RLS policy evaluates false. This works today only because the dev project has
// RLS DISABLED on its tables (migration 003) and the anon key is used directly.
//
// If dev is ever brought in line with live (RLS on, owner-scoped policies), this
// bypass stops working and the options are: sign in normally, or have
// createServerClient_() use the SERVICE ROLE key when the bypass is on (service
// role skips RLS entirely — acceptable locally, catastrophic if it ever shipped).
// Deliberately not doing that now: it would put a service-role code path in the
// request handler, which is exactly the kind of thing that leaks to production.
