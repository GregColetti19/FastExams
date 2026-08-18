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

// RLS AND THE BYPASS
//
// Dev now runs live's exact RLS policies (migration 014), so dev and live differ
// ONLY by this flag. But the bypass mints no Supabase JWT, so auth.uid() is NULL
// and every owner-scoped policy evaluates false — a bypassed request would read
// nothing.
//
// So when the bypass is on, the server client uses the SERVICE ROLE key, which
// skips RLS entirely. That is a deliberate, contained trade:
//   - it is the only way to have real policies on dev AND skip sign-in;
//   - it is gated on NODE_ENV !== 'production' (see isDevAuthBypass), so the
//     service-role path cannot exist in a production build;
//   - it means dev does NOT exercise the policies themselves. Policy changes
//     must be tested with the bypass OFF (sign in normally) — parity of the
//     RULES is what migration 014 buys; parity of ENFORCEMENT still needs a
//     real session.
//
// `npm run db:parity` diffs the two projects so drift is caught mechanically.

/**
 * True when the server client should use the service-role key.
 * Only ever true under the same conditions as isDevAuthBypass().
 */
export function useServiceRoleForDev(): boolean {
  return isDevAuthBypass() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
}
