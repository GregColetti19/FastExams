-- Bring the dev project to full parity with live. (2026-08-18)
--
-- WHY: dev had RLS DISABLED on every table with zero policies (migration 003),
-- while live runs RLS with 11 owner-scoped policies. That gap is how the storage
-- 403 reached production undetected — dev could not reproduce live's
-- authorisation behaviour, so an RLS bug passed locally and failed deployed.
--
-- After this, the ONLY difference between dev and live is the auth bypass flag
-- (DEV_AUTH_BYPASS, see lib/supabase/dev-auth.ts), which is env-gated and cannot
-- be enabled in a production build.
--
-- Policy bodies below are transcribed VERBATIM from the live project
-- (smkuscpfrzmewsijlefb) via pg_policies, not rewritten from memory, so the two
-- databases enforce byte-identical rules.
--
-- Idempotent: safe to re-run, and a no-op on live (which already has all of it).

-- ---------------------------------------------------------------------------
-- Schema drift: a column that exists on dev but not live and that NO migration
-- created (left over from a hand-run dashboard experiment). Unused by any code.
-- ---------------------------------------------------------------------------
ALTER TABLE files DROP COLUMN IF EXISTS original_filename;

-- ---------------------------------------------------------------------------
-- Admin flag + helper (live already has these)
-- ---------------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), false);
$$;

INSERT INTO profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;

UPDATE profiles SET is_admin = true
WHERE id = (SELECT id FROM auth.users WHERE email = 'dev@example.com');

-- ---------------------------------------------------------------------------
-- Enable RLS (reverses migration 003 for these tables)
-- ---------------------------------------------------------------------------
ALTER TABLE exams             ENABLE ROW LEVEL SECURITY;
ALTER TABLE files             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics            ENABLE ROW LEVEL SECURITY;
ALTER TABLE subtopics         ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_options  ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Policies, verbatim from live. Ownership chains through exams.user_id.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users own their exams" ON exams;
CREATE POLICY "Users own their exams" ON exams
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users access files through exam ownership" ON files;
CREATE POLICY "Users access files through exam ownership" ON files
  FOR ALL USING (exam_id IN (SELECT exams.id FROM exams WHERE exams.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users access chunks through file ownership" ON chunks;
CREATE POLICY "Users access chunks through file ownership" ON chunks
  FOR ALL USING (file_id IN (
    SELECT files.id FROM files
    WHERE files.exam_id IN (SELECT exams.id FROM exams WHERE exams.user_id = auth.uid())));

DROP POLICY IF EXISTS "Users access topics through exam ownership" ON topics;
CREATE POLICY "Users access topics through exam ownership" ON topics
  FOR ALL USING (exam_id IN (SELECT exams.id FROM exams WHERE exams.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users access subtopics through topic ownership" ON subtopics;
CREATE POLICY "Users access subtopics through topic ownership" ON subtopics
  FOR ALL USING (topic_id IN (
    SELECT topics.id FROM topics
    WHERE topics.exam_id IN (SELECT exams.id FROM exams WHERE exams.user_id = auth.uid())));

DROP POLICY IF EXISTS "Users access questions through subtopic ownership" ON questions;
CREATE POLICY "Users access questions through subtopic ownership" ON questions
  FOR ALL USING (subtopic_id IN (
    SELECT subtopics.id FROM subtopics
    WHERE subtopics.topic_id IN (
      SELECT topics.id FROM topics
      WHERE topics.exam_id IN (SELECT exams.id FROM exams WHERE exams.user_id = auth.uid()))));

DROP POLICY IF EXISTS "Users access question_options through question ownership" ON question_options;
CREATE POLICY "Users access question_options through question ownership" ON question_options
  FOR ALL USING (question_id IN (
    SELECT questions.id FROM questions
    WHERE questions.subtopic_id IN (
      SELECT subtopics.id FROM subtopics
      WHERE subtopics.topic_id IN (
        SELECT topics.id FROM topics
        WHERE topics.exam_id IN (SELECT exams.id FROM exams WHERE exams.user_id = auth.uid())))));

DROP POLICY IF EXISTS "Users own their study sessions" ON study_sessions;
CREATE POLICY "Users own their study sessions" ON study_sessions
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users access question_attempts through session ownership" ON question_attempts;
CREATE POLICY "Users access question_attempts through session ownership" ON question_attempts
  FOR ALL USING (session_id IN (
    SELECT study_sessions.id FROM study_sessions WHERE study_sessions.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON profiles;
CREATE POLICY "profiles_self_update" ON profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id
    AND is_admin = COALESCE((SELECT p.is_admin FROM profiles p WHERE p.id = auth.uid()), false));

-- ---------------------------------------------------------------------------
-- Storage parity: owner-scoped policies + private buckets (as on live).
-- Dev additionally has an 'images' bucket, which live lacks; it is covered here
-- so dev does not depend on a rule live has never exercised.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow anon upload" ON storage.objects;

DROP POLICY IF EXISTS "own_files_insert" ON storage.objects;
CREATE POLICY "own_files_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('uploads','images')
    AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "own_files_select" ON storage.objects;
CREATE POLICY "own_files_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('uploads','images')
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS "own_files_update" ON storage.objects;
CREATE POLICY "own_files_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id IN ('uploads','images')
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()))
  WITH CHECK (bucket_id IN ('uploads','images')
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS "own_files_delete" ON storage.objects;
CREATE POLICY "own_files_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id IN ('uploads','images')
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

-- Re-key legacy flat objects to `<user_id>/...` so they remain reachable under
-- the path-prefix policies. Dev has 9 such rows; live has none.
UPDATE storage.objects o
SET name = e.user_id::text || '/' || o.name
FROM files f JOIN exams e ON e.id = f.exam_id
WHERE o.bucket_id = 'uploads' AND o.name = f.storage_path
  AND position('/' in o.name) = 0;

UPDATE files f
SET storage_path = e.user_id::text || '/' || f.storage_path
FROM exams e
WHERE e.id = f.exam_id AND position('/' in f.storage_path) = 0;

UPDATE storage.buckets SET public = false WHERE id IN ('uploads','images');
