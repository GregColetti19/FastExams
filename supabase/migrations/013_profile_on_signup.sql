-- Auto-create a profiles row for every new auth user (alpha prep).
--
-- exams.user_id and study_sessions.user_id both reference profiles(id), and
-- profiles(id) references auth.users(id). Signing up creates the auth.users row
-- but nothing ever created the matching profiles row — during single-user dev
-- that row was seeded by hand, so the gap never showed. With real tester signups
-- the first "New exam" insert would fail on a foreign-key violation instead.
--
-- SECURITY DEFINER: the trigger writes to profiles as the function owner, so it
-- works during signup when there is no session and RLS would otherwise block it.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Backfill anyone who signed up before this trigger existed.
INSERT INTO public.profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;
