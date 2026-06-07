-- Enable pgvector extension for future semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Users profile extension
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Exams (top-level container)
CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  language TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Source files uploaded for an exam
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_role TEXT NOT NULL DEFAULT 'theory',
  storage_path TEXT NOT NULL,
  size_bytes BIGINT,
  processing_status TEXT DEFAULT 'pending',
  processing_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Topics (Level 1)
CREATE TABLE topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Subtopics (Level 2)
CREATE TABLE subtopics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  mastery_score FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Content chunks (processed file sections)
CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  subtopic_id UUID REFERENCES subtopics(id),
  content_text TEXT,
  image_storage_path TEXT,
  has_image BOOLEAN DEFAULT false,
  page_or_slide INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Questions
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subtopic_id UUID NOT NULL REFERENCES subtopics(id) ON DELETE CASCADE,
  chunk_id UUID REFERENCES chunks(id),
  question_text TEXT NOT NULL,
  image_storage_path TEXT,
  justification TEXT NOT NULL,
  language TEXT,
  question_type TEXT DEFAULT 'mcq',
  source TEXT DEFAULT 'ai_generated',
  past_exam_year TEXT,
  matched_chunk_id UUID REFERENCES chunks(id),
  embedding vector(1536),
  times_seen INTEGER DEFAULT 0,
  times_correct INTEGER DEFAULT 0,
  current_interval_days FLOAT DEFAULT 1,
  last_seen_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Answer options for MCQ questions
CREATE TABLE question_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL
);

-- Study sessions
CREATE TABLE study_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  subtopic_id UUID REFERENCES subtopics(id),
  session_type TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_questions INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0
);

-- Individual question attempts
CREATE TABLE question_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id),
  selected_option_id UUID REFERENCES question_options(id),
  is_correct BOOLEAN NOT NULL,
  time_spent_seconds INTEGER,
  attempted_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_exams_user_id ON exams(user_id);
CREATE INDEX idx_topics_exam_id ON topics(exam_id);
CREATE INDEX idx_subtopics_topic_id ON subtopics(topic_id);
CREATE INDEX idx_questions_subtopic_id ON questions(subtopic_id);
CREATE INDEX idx_questions_next_review ON questions(next_review_at);
CREATE INDEX idx_attempts_session_id ON question_attempts(session_id);
CREATE INDEX idx_attempts_question_id ON question_attempts(question_id);
CREATE INDEX idx_files_exam_id ON files(exam_id);
CREATE INDEX idx_chunks_file_id ON chunks(file_id);
CREATE INDEX idx_questions_source ON questions(source);
CREATE INDEX idx_files_role ON files(file_role);

-- Profiles trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- RLS Policies
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

-- Profiles: users can read their own
CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT USING (auth.uid() = id);

-- Exams: users own their exams
CREATE POLICY "Users own their exams" ON exams FOR ALL USING (auth.uid() = user_id);

-- Files: access through exam ownership
CREATE POLICY "Users access files through exam ownership" ON files FOR ALL USING (
  exam_id IN (SELECT id FROM exams WHERE user_id = auth.uid())
);

-- Topics: access through exam ownership
CREATE POLICY "Users access topics through exam ownership" ON topics FOR ALL USING (
  exam_id IN (SELECT id FROM exams WHERE user_id = auth.uid())
);

-- Subtopics: access through topic ownership
CREATE POLICY "Users access subtopics through topic ownership" ON subtopics FOR ALL USING (
  topic_id IN (SELECT id FROM topics WHERE exam_id IN (SELECT id FROM exams WHERE user_id = auth.uid()))
);

-- Chunks: access through file ownership
CREATE POLICY "Users access chunks through file ownership" ON chunks FOR ALL USING (
  file_id IN (SELECT id FROM files WHERE exam_id IN (SELECT id FROM exams WHERE user_id = auth.uid()))
);

-- Questions: access through subtopic ownership
CREATE POLICY "Users access questions through subtopic ownership" ON questions FOR ALL USING (
  subtopic_id IN (
    SELECT id FROM subtopics WHERE topic_id IN (
      SELECT id FROM topics WHERE exam_id IN (SELECT id FROM exams WHERE user_id = auth.uid())
    )
  )
);

-- Question options: access through question ownership
CREATE POLICY "Users access question_options through question ownership" ON question_options FOR ALL USING (
  question_id IN (
    SELECT id FROM questions WHERE subtopic_id IN (
      SELECT id FROM subtopics WHERE topic_id IN (
        SELECT id FROM topics WHERE exam_id IN (SELECT id FROM exams WHERE user_id = auth.uid())
      )
    )
  )
);

-- Study sessions: users own their sessions
CREATE POLICY "Users own their study sessions" ON study_sessions FOR ALL USING (auth.uid() = user_id);

-- Question attempts: access through session ownership
CREATE POLICY "Users access question_attempts through session ownership" ON question_attempts FOR ALL USING (
  session_id IN (SELECT id FROM study_sessions WHERE user_id = auth.uid())
);
