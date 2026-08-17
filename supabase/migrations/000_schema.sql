-- FastExams — complete schema, consolidated from migrations 001–014.
--
-- Run this ONCE on a fresh Supabase project instead of the numbered migrations.
-- It is the whole end state: tables with their final columns and FK rules,
-- indexes, the pgvector RPC, the signup trigger, and RLS enabled with policies.
--
-- Existing projects: keep using the numbered migrations. This file creates, it
-- does not migrate — it will not alter tables that already exist.
--
-- It creates nothing destructively (no DROP TABLE) and is safe to re-run: every
-- statement is IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS first.
--
-- Deliberately NOT included: 003_disable_rls_dev.sql, which turned RLS off for
-- single-user development. Running it against a multi-user deployment lets any
-- signed-in user read and write everyone else's data.

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- TABLES
-- ============================================================

-- Mirrors auth.users. Populated by the on_auth_user_created trigger below.
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Top-level container. Ownership of everything below chains through user_id.
CREATE TABLE IF NOT EXISTS exams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  language    TEXT,
  -- 010: only active exams feed the Review queue.
  active      BOOLEAN NOT NULL DEFAULT true,
  -- 012: inferred per exam at ingestion; NULL means "not inferred yet", and
  -- prompts fall back to neutral framing rather than to medicine.
  subject        TEXT,
  subject_domain TEXT
    CHECK (subject_domain IS NULL OR subject_domain IN
      ('stem', 'humanities', 'social-science', 'professional', 'other')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id           UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  file_name         TEXT NOT NULL,
  file_type         TEXT NOT NULL,
  file_role         TEXT NOT NULL DEFAULT 'theory',
  storage_path      TEXT NOT NULL,
  size_bytes        BIGINT,
  processing_status TEXT DEFAULT 'pending',
  processing_error  TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Topics (level 1)
CREATE TABLE IF NOT EXISTS topics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id       UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Subtopics (level 2)
CREATE TABLE IF NOT EXISTS subtopics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id      UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  mastery_score FLOAT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Processed file sections. Deleting a file cascades here, and on to its
-- questions (008), so re-uploading a file regenerates cleanly.
CREATE TABLE IF NOT EXISTS chunks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id            UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  subtopic_id        UUID REFERENCES subtopics(id),
  content_text       TEXT,
  image_storage_path TEXT,
  has_image          BOOLEAN DEFAULT false,
  page_or_slide      INTEGER,
  -- 006: buildChunks() emits these; the theory pipeline groups on
  -- candidate_subtopic, so without the columns the values were dropped.
  candidate_topic    TEXT,
  candidate_subtopic TEXT,
  language           TEXT,
  -- 005: 1536 dims. 011: provenance, because vectors from different models are
  -- not comparable and mixing them yields garbage similarity rather than errors.
  embedding          vector(1536),
  embedding_model    TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  embedding_dim      INT  NOT NULL DEFAULT 1536,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subtopic_id      UUID NOT NULL REFERENCES subtopics(id) ON DELETE CASCADE,
  chunk_id         UUID REFERENCES chunks(id) ON DELETE CASCADE,
  question_text    TEXT NOT NULL,
  image_storage_path TEXT,
  justification    TEXT NOT NULL,
  language         TEXT,
  question_type    TEXT DEFAULT 'mcq',
  source           TEXT DEFAULT 'ai_generated',
  past_exam_year   TEXT,
  matched_chunk_id UUID REFERENCES chunks(id) ON DELETE SET NULL,
  embedding        vector(1536),
  -- 004: past-exam PDFs carry no answer key, so the correct answer is inferred
  -- and grounded in matched theory. answer_status is one of
  -- 'ai_answered' | 'unanswerable' | 'user_set'.
  ai_confidence    FLOAT,
  answer_status    TEXT DEFAULT 'ai_answered',
  -- SM-2 era columns. Superseded by the FSRS fields below; kept because the
  -- 010 backfill seeds stability from current_interval_days.
  times_seen            INTEGER DEFAULT 0,
  times_correct         INTEGER DEFAULT 0,
  current_interval_days FLOAT DEFAULT 1,
  -- 010: FSRS memory state per item. See lib/fsrs.ts StoredCard.
  stability      FLOAT    NOT NULL DEFAULT 0,
  difficulty     FLOAT    NOT NULL DEFAULT 0,
  reps           INTEGER  NOT NULL DEFAULT 0,
  lapses         INTEGER  NOT NULL DEFAULT 0,
  -- FSRS State enum: 0=New 1=Learning 2=Review 3=Relearning
  fsrs_state     SMALLINT NOT NULL DEFAULT 0,
  learning_steps INTEGER  NOT NULL DEFAULT 0,
  -- 002: question flagging.
  flagged_at     TIMESTAMPTZ,
  flag_reason    TEXT,
  last_seen_at   TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ DEFAULT now(),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS question_options (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id   UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_text   TEXT NOT NULL,
  is_correct    BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL
);

-- subtopic_id is ON DELETE SET NULL (007): sessions outlive their subtopic so
-- history survives a re-upload.
CREATE TABLE IF NOT EXISTS study_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id),
  subtopic_id     UUID REFERENCES subtopics(id) ON DELETE SET NULL,
  session_type    TEXT NOT NULL,
  started_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  total_questions INTEGER DEFAULT 0,
  correct_count   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS question_attempts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  -- 007: CASCADE, so deleting an exam is not blocked by attempt history.
  question_id        UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option_id UUID REFERENCES question_options(id),
  is_correct         BOOLEAN NOT NULL,
  time_spent_seconds INTEGER,
  attempted_at       TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_exams_user_id        ON exams(user_id);
CREATE INDEX IF NOT EXISTS idx_topics_exam_id       ON topics(exam_id);
CREATE INDEX IF NOT EXISTS idx_subtopics_topic_id   ON subtopics(topic_id);
CREATE INDEX IF NOT EXISTS idx_questions_subtopic_id ON questions(subtopic_id);
CREATE INDEX IF NOT EXISTS idx_questions_next_review ON questions(next_review_at);
CREATE INDEX IF NOT EXISTS idx_attempts_session_id  ON question_attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_attempts_question_id ON question_attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_files_exam_id        ON files(exam_id);
CREATE INDEX IF NOT EXISTS idx_chunks_file_id       ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_questions_source     ON questions(source);
CREATE INDEX IF NOT EXISTS idx_files_role           ON files(file_role);

-- ANN index for cosine distance (005). Dev/mock does brute-force cosine in app
-- code; this is for real Supabase.
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================
-- RPC — pgvector retrieval (009)
-- ============================================================
-- `stable` without SECURITY DEFINER on purpose: it runs as the caller, so the
-- RLS policies below apply inside it and p_exam_id cannot be used to read
-- another user's chunks.
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1536),
  p_exam_id       uuid,
  match_count     int default 5
)
RETURNS TABLE(
  id           uuid,
  content_text text,
  subtopic_id  uuid,
  similarity   float
)
LANGUAGE sql STABLE AS $$
  select
    c.id,
    c.content_text,
    c.subtopic_id,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join files f on f.id = c.file_id
  where f.exam_id = p_exam_id
    and f.file_role = 'theory'
    and c.subtopic_id is not null
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- SIGNUP TRIGGER (013)
-- ============================================================
-- exams.user_id references profiles(id), which references auth.users(id).
-- Signup creates the auth.users row only, so without this the first exam insert
-- fails on a foreign key.
--
-- SECURITY DEFINER: runs as the owner, so it works during signup when there is
-- no session and RLS would otherwise block the insert.
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

-- Covers anyone who signed up before the trigger existed.
INSERT INTO public.profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Every table is owner-scoped; access chains up to exams.user_id = auth.uid().
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams             ENABLE ROW LEVEL SECURITY;
ALTER TABLE files             ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics            ENABLE ROW LEVEL SECURITY;
ALTER TABLE subtopics         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_options  ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users own their exams" ON exams;
CREATE POLICY "Users own their exams" ON exams
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users access files through exam ownership" ON files;
CREATE POLICY "Users access files through exam ownership" ON files
  FOR ALL USING (exam_id IN (SELECT id FROM exams WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users access topics through exam ownership" ON topics;
CREATE POLICY "Users access topics through exam ownership" ON topics
  FOR ALL USING (exam_id IN (SELECT id FROM exams WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users access subtopics through topic ownership" ON subtopics;
CREATE POLICY "Users access subtopics through topic ownership" ON subtopics
  FOR ALL USING (
    topic_id IN (
      SELECT id FROM topics WHERE exam_id IN (SELECT id FROM exams WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users access chunks through file ownership" ON chunks;
CREATE POLICY "Users access chunks through file ownership" ON chunks
  FOR ALL USING (
    file_id IN (
      SELECT id FROM files WHERE exam_id IN (SELECT id FROM exams WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users access questions through subtopic ownership" ON questions;
CREATE POLICY "Users access questions through subtopic ownership" ON questions
  FOR ALL USING (
    subtopic_id IN (
      SELECT id FROM subtopics WHERE topic_id IN (
        SELECT id FROM topics WHERE exam_id IN (SELECT id FROM exams WHERE user_id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users access question_options through question ownership" ON question_options;
CREATE POLICY "Users access question_options through question ownership" ON question_options
  FOR ALL USING (
    question_id IN (
      SELECT id FROM questions WHERE subtopic_id IN (
        SELECT id FROM subtopics WHERE topic_id IN (
          SELECT id FROM topics WHERE exam_id IN (SELECT id FROM exams WHERE user_id = auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS "Users own their study sessions" ON study_sessions;
CREATE POLICY "Users own their study sessions" ON study_sessions
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users access question_attempts through session ownership" ON question_attempts;
CREATE POLICY "Users access question_attempts through session ownership" ON question_attempts
  FOR ALL USING (
    session_id IN (SELECT id FROM study_sessions WHERE user_id = auth.uid())
  );
