-- Chunk ingestion fix.
-- buildChunks() produces candidate topic/subtopic headings and a language that
-- the theory pipeline reads (generate-questions groups chunks by
-- candidate_subtopic), but the columns were missing from the chunks table, so
-- those values were dropped on insert. Add them.

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS candidate_topic TEXT,
  ADD COLUMN IF NOT EXISTS candidate_subtopic TEXT,
  ADD COLUMN IF NOT EXISTS language TEXT;
