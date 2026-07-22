-- Embedding provenance (PR 2 — embedding provider/model abstraction).
--
-- Vectors from different models/dimensions are NOT comparable; mixing them in
-- one table silently produces garbage similarity rather than errors. Record
-- which model + dimension produced each stored vector so a future model swap
-- leaves old and new vectors distinguishable.
--
-- Existing rows are backfilled to today's model/dim (text-embedding-3-small/1536).

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS embedding_model text NOT NULL DEFAULT 'text-embedding-3-small',
  ADD COLUMN IF NOT EXISTS embedding_dim   int  NOT NULL DEFAULT 1536;

-- MIGRATION PATH for an actual model/dimension change (NOT done here):
--   1. chunks.embedding is vector(1536) with an ivfflat cosine index (mig 005).
--      A different dimension requires: ALTER COLUMN ... TYPE vector(N),
--      DROP + reCREATE the ivfflat index, and a FULL re-embed of every row.
--   2. questions.embedding (also vector(1536)) must be migrated the same way.
--   3. MRL/Matryoshka-capable models (OpenAI 3-*, Qwen3-Embedding) can emit 1536
--      dims via the `dimensions` param, letting a swap keep vector(1536) and skip
--      the schema change entirely — only a re-embed is then needed.
-- Until such a migration runs, keep EMBED_DIMENSIONS unset / at 1536.
