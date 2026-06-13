-- Embedding-based retrieval (item 2).
-- Theory chunks get an embedding so past-exam questions can be matched to the
-- most semantically similar theory (replacing naive TF-IDF keyword overlap).
-- 1536 dims = OpenAI text-embedding-3-small, matching questions.embedding.

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Approximate-nearest-neighbour index for cosine distance (production search).
-- Dev/mock does brute-force cosine in app code; this is for real Supabase.
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
