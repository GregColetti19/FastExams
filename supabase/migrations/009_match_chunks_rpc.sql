-- pgvector ANN retrieval for past-exam grounding (replaces brute-force JS cosine).
-- Called by the generate-questions route to find the best theory chunk for each
-- past-exam question. Filters to subtopic-assigned chunks with stored embeddings.
-- Requires migration 005 (chunks.embedding + ivfflat index).

create or replace function match_chunks(
  query_embedding vector(1536),
  p_exam_id       uuid,
  match_count     int default 5
)
returns table(
  id          uuid,
  content_text text,
  subtopic_id  uuid,
  similarity   float
)
language sql stable as $$
  select
    c.id,
    c.content_text,
    c.subtopic_id,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join files f on f.id = c.file_id
  where f.exam_id = p_exam_id
    and f.file_role = 'theory'
    and c.subtopic_id is not null
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
