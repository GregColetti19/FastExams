-- Full schema reset — drops all app tables and recreates with correct CASCADE rules.
-- Includes all changes from migrations 001–008.
-- Run in Supabase SQL Editor. AUTH tables (auth.users) are untouched.

-- ============================================================
-- DROP (reverse dependency order)
-- ============================================================
DROP TABLE IF EXISTS question_attempts  CASCADE;
DROP TABLE IF EXISTS study_sessions     CASCADE;
DROP TABLE IF EXISTS question_options   CASCADE;
DROP TABLE IF EXISTS questions          CASCADE;
DROP TABLE IF EXISTS chunks             CASCADE;
DROP TABLE IF EXISTS files              CASCADE;
DROP TABLE IF EXISTS subtopics         CASCADE;
DROP TABLE IF EXISTS topics             CASCADE;
DROP TABLE IF EXISTS exams              CASCADE;
DROP TABLE IF EXISTS profiles           CASCADE;

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE exams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  language    TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id           UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  file_name         TEXT NOT NULL,
  original_filename TEXT,
  file_type         TEXT NOT NULL,
  file_role         TEXT NOT NULL DEFAULT 'theory',
  storage_path      TEXT NOT NULL,
  size_bytes        BIGINT,
  processing_status TEXT DEFAULT 'pending',
  processing_error  TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE topics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id       UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE subtopics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id      UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  mastery_score FLOAT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- chunks reference files (CASCADE) and optionally subtopics (SET NULL)
CREATE TABLE chunks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id             UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  subtopic_id         UUID REFERENCES subtopics(id) ON DELETE SET NULL,
  content_text        TEXT,
  image_storage_path  TEXT,
  has_image           BOOLEAN DEFAULT false,
  page_or_slide       INTEGER,
  candidate_topic     TEXT,
  candidate_subtopic  TEXT,
  language            TEXT,
  embedding           vector(1536),
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- questions: chunk_id CASCADE (Option B — chunk owns question)
--            matched_chunk_id SET NULL (cross-file match, don't cascade)
CREATE TABLE questions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subtopic_id           UUID NOT NULL REFERENCES subtopics(id) ON DELETE CASCADE,
  chunk_id              UUID REFERENCES chunks(id) ON DELETE CASCADE,
  matched_chunk_id      UUID REFERENCES chunks(id) ON DELETE SET NULL,
  question_text         TEXT NOT NULL,
  image_storage_path    TEXT,
  justification         TEXT NOT NULL DEFAULT '',
  language              TEXT,
  question_type         TEXT DEFAULT 'mcq',
  source                TEXT DEFAULT 'ai_generated',
  past_exam_year        TEXT,
  embedding             vector(1536),
  ai_confidence         FLOAT,
  answer_status         TEXT DEFAULT 'ai_answered',
  flagged_at            TIMESTAMPTZ,
  flag_reason           TEXT,
  times_seen            INTEGER DEFAULT 0,
  times_correct         INTEGER DEFAULT 0,
  current_interval_days FLOAT DEFAULT 1,
  last_seen_at          TIMESTAMPTZ,
  next_review_at        TIMESTAMPTZ DEFAULT now(),
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE question_options (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id   UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_text   TEXT NOT NULL,
  is_correct    BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL
);

CREATE TABLE study_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subtopic_id     UUID REFERENCES subtopics(id) ON DELETE SET NULL,
  session_type    TEXT NOT NULL,
  started_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  total_questions INTEGER DEFAULT 0,
  correct_count   INTEGER DEFAULT 0
);

CREATE TABLE question_attempts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  question_id        UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option_id UUID REFERENCES question_options(id) ON DELETE SET NULL,
  is_correct         BOOLEAN NOT NULL,
  time_spent_seconds INTEGER,
  attempted_at       TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_exams_user_id         ON exams(user_id);
CREATE INDEX idx_files_exam_id         ON files(exam_id);
CREATE INDEX idx_files_role            ON files(file_role);
CREATE INDEX idx_topics_exam_id        ON topics(exam_id);
CREATE INDEX idx_subtopics_topic_id    ON subtopics(topic_id);
CREATE INDEX idx_chunks_file_id        ON chunks(file_id);
CREATE INDEX idx_chunks_subtopic_id    ON chunks(subtopic_id);
CREATE INDEX idx_questions_subtopic_id ON questions(subtopic_id);
CREATE INDEX idx_questions_source      ON questions(source);
CREATE INDEX idx_questions_next_review ON questions(next_review_at);
CREATE INDEX idx_attempts_session_id   ON question_attempts(session_id);
CREATE INDEX idx_attempts_question_id  ON question_attempts(question_id);

-- ANN index for embedding similarity (cosine distance, OpenAI 1536-dim)
CREATE INDEX chunks_embedding_idx
  ON chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================
-- AUTH TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ============================================================
-- RLS (disabled for dev — re-enable per-table for production)
-- ============================================================
ALTER TABLE profiles         DISABLE ROW LEVEL SECURITY;
ALTER TABLE exams            DISABLE ROW LEVEL SECURITY;
ALTER TABLE files            DISABLE ROW LEVEL SECURITY;
ALTER TABLE topics           DISABLE ROW LEVEL SECURITY;
ALTER TABLE subtopics        DISABLE ROW LEVEL SECURITY;
ALTER TABLE chunks           DISABLE ROW LEVEL SECURITY;
ALTER TABLE questions        DISABLE ROW LEVEL SECURITY;
ALTER TABLE question_options DISABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions   DISABLE ROW LEVEL SECURITY;
ALTER TABLE question_attempts DISABLE ROW LEVEL SECURITY;
