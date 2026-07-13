-- Fix missing CASCADE on two FK constraints that block exam deletion when
-- study session data exists.

-- question_attempts.question_id: drop + re-add with ON DELETE CASCADE so
-- deleting a question (via exam→topic→subtopic→question cascade) doesn't
-- leave orphaned attempts.
ALTER TABLE question_attempts
  DROP CONSTRAINT IF EXISTS question_attempts_question_id_fkey;
ALTER TABLE question_attempts
  ADD CONSTRAINT question_attempts_question_id_fkey
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE;

-- study_sessions.subtopic_id: drop + re-add with ON DELETE SET NULL
-- (column is nullable — sessions outlive their subtopic for history purposes).
ALTER TABLE study_sessions
  DROP CONSTRAINT IF EXISTS study_sessions_subtopic_id_fkey;
ALTER TABLE study_sessions
  ADD CONSTRAINT study_sessions_subtopic_id_fkey
  FOREIGN KEY (subtopic_id) REFERENCES subtopics(id) ON DELETE SET NULL;
