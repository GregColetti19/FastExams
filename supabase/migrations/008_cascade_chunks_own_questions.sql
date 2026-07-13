-- Option B: chunks own questions.
-- Deleting a file cascades to chunks, which cascades to questions.
-- Re-upload a file → regenerate questions cleanly.

ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_chunk_id_fkey;
ALTER TABLE questions
  ADD CONSTRAINT questions_chunk_id_fkey
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE;

ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_matched_chunk_id_fkey;
ALTER TABLE questions
  ADD CONSTRAINT questions_matched_chunk_id_fkey
  FOREIGN KEY (matched_chunk_id) REFERENCES chunks(id) ON DELETE SET NULL;
