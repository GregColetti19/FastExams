-- Add flagging columns to questions table
ALTER TABLE questions ADD COLUMN flagged_at TIMESTAMPTZ;
ALTER TABLE questions ADD COLUMN flag_reason TEXT;
