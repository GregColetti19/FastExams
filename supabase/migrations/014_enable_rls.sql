-- Re-enable Row Level Security on all tables (alpha prep).
--
-- Reverses 003_disable_rls_dev.sql, which turned RLS off so single-user dev
-- could run without an auth session. With real tester accounts that setting
-- means every signed-in user can read and write every other user's data.
--
-- The policies themselves already exist from 001_initial_schema.sql (all
-- auth.uid()-based, ownership chained through exams.user_id) and are not
-- redefined here — this migration only flips enforcement back on.
--
-- Note: match_chunks (009) is `language sql stable` without SECURITY DEFINER,
-- so it executes as the caller and these policies apply inside it too.

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE subtopics ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_attempts ENABLE ROW LEVEL SECURITY;

-- profiles: 001 only granted SELECT on your own row. Signup needs the row to
-- exist (handled by the 013 trigger), but the app also reads it back and may
-- update the email — without these, both silently return nothing.
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);
