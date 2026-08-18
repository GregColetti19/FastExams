-- Storage RLS: owner-scoped access to the 'uploads' bucket. (2026-08-18)
--
-- BUG THIS FIXES: every upload failed with
--   "new row violates row-level security policy" (403)
-- storage.objects has RLS ENABLED but ZERO policies, so no insert could ever be
-- authorised. The bucket was created in the dashboard; its policies never were.
--
-- The public tables already carry owner-scoped policies (ownership chained
-- through exams.user_id). Storage was the one layer left open/closed-by-default.
--
-- Ownership is expressed in the object key: `<user_id>/<timestamp>-<name>`.
-- storage.foldername(name) splits on '/', so [1] is the owner segment. This
-- requires app/api/upload/route.ts to write that prefix — the two must agree.

-- Admin flag: admins can read/delete any user's files for support + moderation.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- SECURITY DEFINER so policies can read profiles without recursing through its
-- own RLS. search_path is pinned: a mutable search_path on a SECURITY DEFINER
-- function is a privilege-escalation vector.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), false);
$$;

DROP POLICY IF EXISTS "own_files_insert" ON storage.objects;
CREATE POLICY "own_files_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "own_files_select" ON storage.objects;
CREATE POLICY "own_files_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'uploads'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  );

-- upload(..., { upsert: true }) issues an UPDATE on an existing key.
DROP POLICY IF EXISTS "own_files_update" ON storage.objects;
CREATE POLICY "own_files_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'uploads'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  )
  WITH CHECK (
    bucket_id = 'uploads'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  );

-- Needed by the exam-delete cascade; without it deleted exams leak their objects.
DROP POLICY IF EXISTS "own_files_delete" ON storage.objects;
CREATE POLICY "own_files_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'uploads'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  );

-- is_admin must not be self-grantable. The existing profiles UPDATE policy
-- allows a user to edit their own row, which would now include this new column;
-- re-create it so the stored flag is preserved on self-update.
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON profiles;
CREATE POLICY "profiles_self_update" ON profiles
  FOR UPDATE TO public
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin = COALESCE((SELECT p.is_admin FROM profiles p WHERE p.id = auth.uid()), false)
  );

-- Grant admin to the project owner. Matched by email rather than a hardcoded
-- UUID so this still resolves if the account is ever recreated; the subquery
-- yields no row (and grants nothing) if the address is absent.
UPDATE profiles SET is_admin = true
WHERE id = (SELECT id FROM auth.users WHERE email = 'dev1@gmail.com');

-- No data migration needed: this project has 0 exams / 0 files and the bucket is
-- empty, so there are no legacy flat keys to re-key (unlike the dev project).
