# FastExams — Backlog & Known Assumptions

Canonical tracker for deferred work, tech debt, hardcoded assumptions, and
untuned parameters. Update this when you defer something or bake in an
assumption — don't let it live only in a commit message or someone's head.

Status: 🔴 blocker · 🟠 important · 🟡 nice-to-have · 🔵 assumption to revisit
Last updated: 2026-06-13

---

## Thresholds & magic numbers (untuned — need an eval set)

These are judgment calls, **not** tuned against data. They were chosen by feel and
left fixed when the real-data run flagged 2/5 questions (we did NOT lower them to
force passes). Validate + tune against a labeled eval set across multiple exams.

| Constant | Value | Where | Notes |
|---|---|---|---|
| `EMBED_MATCH_MIN_SCORE` | 0.25 | app/api/generate-questions/route.ts | min cosine to attempt grounding 🟠 |
| `ANSWER_MIN_CONFIDENCE` | 0.4 | app/api/generate-questions/route.ts | below → flag unanswerable 🟠 |
| chunk target tokens | 500 | process-file route (`splitChunksByTokens`) | RAG default 🟡 |
| `MAX_INPUT_CHARS` | 8000 | lib/ai/embeddings.ts | OpenAI 8191-token cap; principled 🔵 |
| `EMBED_BATCH` | 96 | lib/ai/embeddings.ts | per-request input cap; principled 🔵 |

- [ ] 🟠 Pull these into a named config module / env vars so they're visible + tunable in one place.
- [ ] 🟠 Build an **eval harness**: hand-label correct answers for ≥2 full exams, measure answer accuracy + flag rate, tune thresholds against it (don't tune on a single exam).

## Hardcoded assumptions to revisit

- [ ] 🔵 **Medical domain baked into prompts.** `"expert medical educator"`, `subject='medicine'` default (lib/ai/prompts.ts, extract-topics.ts). Pre-existing app design. If non-medical exams are ever supported, parametrize `subject` end-to-end (extract-topics already has the param; others don't).
- [ ] 🔵 **MCQ format = lettered options A–E.** `optionLetter()` in generate-questions route + `is_correct` matching assume "A. ...", "B) ...". Non-lettered / numbered / open formats not handled for auto-answer.
- [ ] 🔵 **Embedding provider = OpenAI text-embedding-3-small (1536d).** Local multilingual embeddings via the Python converter remain a zero-cost/private swap option (would change vector dim → migration).

## Known broken / limited on real data

- [ ] 🟠 **Theory → subtopic mapping fails on real chunks.** `processTheoryFile` assigns chunks to subtopics by string-match `candidate_subtopic === subtopicName`. Real converter output gives nearly every chunk the same heading ("PED"), so all chunks collapse to one/zero subtopics. Fix: assign each chunk to its nearest extracted subtopic **by embedding** (same retrieval used for past-exam grounding). Found in the real integration run (2026-06-13).
- [ ] 🟡 **Brute-force cosine retrieval in app code.** Fine at one exam's scale; switch to pgvector RPC (index already created in migration 005) when corpora grow.
- [ ] 🟡 **`process-file` async work is fire-and-forget** (`setImmediate` → fetch generate-questions). Not a real queue; failures only surface via DB status. MVP limitation.
- [ ] 🟡 **`extractLargeExam` splits on a question-number regex** (`^\d+\.` etc.); brittle for exams numbered differently.

## Deferred features

- [ ] 🟠 **Answer-determination UI.** Surface "AI-suggested · unverified · confidence X" badge + source citation + an override button in the quiz (override-answer route already exists).
- [ ] 🟠 **Study logic wiring (item 3).** Wire spaced-repetition into the real quiz flow: requeue wrong answers, track progress. Now unblocked (trusted answers exist).
- [ ] 🟡 **Front-end on mock DB (item 4).** Run existing pages against the in-memory DB, fix breaks.
- [ ] 🟡 **Visual / image questions.** On hold. Needs image↔text matching — reuses the embedding retrieval layer.
- [ ] 🟡 **Cost optimization.** Haiku tiering for cheap text steps + prompt caching on stable system prompts / theory.
- [ ] 🟡 **Spaced repetition algorithm.** Simple interval×2.5 in lib/scheduling; replaceable with FSRS later.

## Migrations not yet applied to a real Supabase

004 (answer_status, ai_confidence), 005 (chunks.embedding + ivfflat), 006
(chunk candidate columns). Dev runs on the mock DB; apply these before any real
Supabase deploy.
