-- Cadence: FSRS scheduling columns + per-exam Active flag.
--
-- The app moves from an SM-2-style scheduler (times_seen/times_correct/
-- current_interval_days) to FSRS (ts-fsrs). FSRS needs per-item memory state.
-- Existing SM-2 columns are left in place for backfill/rollback; FSRS is the
-- source of truth going forward (see lib/fsrs.ts).

-- Per-exam Active flag. Only active exams feed the Review queue / landing.
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- FSRS memory state per question. See lib/fsrs.ts StoredCard.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS stability      FLOAT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS difficulty     FLOAT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reps           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lapses         INTEGER NOT NULL DEFAULT 0,
  -- FSRS State enum: 0=New 1=Learning 2=Review 3=Relearning
  ADD COLUMN IF NOT EXISTS fsrs_state     SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS learning_steps INTEGER NOT NULL DEFAULT 0;

-- Backfill: questions already seen become Review-state cards. stability is
-- seeded from the SM-2 interval (a coarse but monotonic proxy — a longer prior
-- interval means better retention); difficulty seeded to the FSRS mid default.
-- Untouched questions (times_seen = 0) stay New (all defaults above).
UPDATE questions
SET fsrs_state = 2,
    reps       = times_seen,
    lapses     = GREATEST(times_seen - times_correct, 0),
    stability  = GREATEST(current_interval_days, 1),
    difficulty = 5
WHERE times_seen > 0
  AND fsrs_state = 0;
