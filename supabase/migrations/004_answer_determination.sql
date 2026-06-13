-- Past-exam answer determination.
-- Past-exam PDFs carry no answer key, so the correct answer is AI-inferred and
-- grounded in matched theory (cited via matched_chunk_id). These columns record
-- how confident that inference is and let users override it.

ALTER TABLE questions
  -- 0–1 confidence of the AI-inferred answer; NULL for non-past-exam questions.
  ADD COLUMN IF NOT EXISTS ai_confidence FLOAT,
  -- 'ai_answered'  : AI picked an answer, grounded in source
  -- 'unanswerable' : source insufficient; flagged, no correct option set
  -- 'user_set'     : a user overrode the correct answer
  ADD COLUMN IF NOT EXISTS answer_status TEXT DEFAULT 'ai_answered';
