-- Exam subject inference (2026-08-13)
--
-- Every AI prompt used to hardcode a medical framing ("expert medical exam
-- question writer", "for university medical students", "clinical reasoning"),
-- and extractTopics/extractTopicHierarchy defaulted to subject='medicine' with
-- no caller ever passing a real value. On a numerical-analysis or philosophy
-- upload the model was told it was writing a medicine exam.
--
-- The subject is now inferred once per exam at ingestion (lib/ai/infer-subject.ts)
-- and threaded into question, flashcard and topic prompts.
--
-- Free text, not an enum: the app accepts any university course, and an enum
-- would need a migration for every new field. NULL means "not inferred yet" —
-- prompts fall back to neutral framing, never to medicine.

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS subject_domain TEXT
    CHECK (subject_domain IS NULL OR subject_domain IN
      ('stem', 'humanities', 'social-science', 'professional', 'other'));

COMMENT ON COLUMN exams.subject IS
  'Inferred course subject label, e.g. "Numerical Analysis". NULL until inferred.';
COMMENT ON COLUMN exams.subject_domain IS
  'Discipline family driving question-style selection (see questionStylesFor).';
