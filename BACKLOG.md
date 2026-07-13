# FastExams — Backlog & Known Assumptions

Canonical tracker for deferred work, tech debt, hardcoded assumptions, and
untuned parameters. Update this when you defer something or bake in an
assumption — don't let it live only in a commit message or someone's head.

Status: 🔴 blocker · 🟠 important · 🟡 nice-to-have · 🔵 assumption to revisit
Last updated: 2026-07-06

---

## Thresholds & magic numbers (untuned — need an eval set)

These are judgment calls, **not** tuned against data. They were chosen by feel and
left fixed when the real-data run flagged 2/5 questions (we did NOT lower them to
force passes). Validate + tune against a labeled eval set across multiple exams.

| Constant | Value | Where | Notes |
|---|---|---|---|
| `EMBED_MATCH_MIN_SCORE` | 0.25 | app/api/generate-questions/route.ts, app/api/recalibrate/route.ts | min cosine to attempt grounding 🟠 |
| `ANSWER_MIN_CONFIDENCE` | 0.4 | app/api/generate-questions/route.ts, app/api/recalibrate/route.ts | below → flag unanswerable 🟠 |
| chunk target tokens | 500 | process-file route (`splitChunksByTokens`) | RAG default 🟡 |
| `MAX_INPUT_CHARS` | 8000 | lib/ai/embeddings.ts | OpenAI 8191-token cap; principled 🔵 |
| `EMBED_BATCH` | 96 | lib/ai/embeddings.ts | per-request input cap; principled 🔵 |
| `seedK` | 3 | lib/ai/assign-subtopics.ts | chunks used to seed each subtopic center 🟡 |
| `iters` | 2 | lib/ai/assign-subtopics.ts | refinement passes 🟡 |
| `confidentMargin` | 0.03 | lib/ai/assign-subtopics.ts | min best-vs-2nd cosine gap to be "confident" 🟠 |
| `STALL_TIMEOUT_MS` | 600_000 (10 min) | components/exam/UploadZone.tsx | generation stall detection threshold 🟡 |

⚠️ **Tiebreak cost:** on real data ~36% of chunks land unconfident → that many LLM tie-break calls per theory file (cheap each, but 343 chunks → ~125 calls). Tune `confidentMargin` / subtopic-description quality to cut this; or batch the tiebreak (one call for several chunks). 🟠

- [ ] 🟠 Pull these into a named config module / env vars so they're visible + tunable in one place.
- [ ] 🟠 Build an **eval harness**: hand-label correct answers for ≥2 full exams, measure answer accuracy + flag rate, tune thresholds against it (don't tune on a single exam).

## Hardcoded assumptions to revisit

- [ ] 🔵 **Medical domain baked into prompts.** `"expert medical educator"`, `subject='medicine'` default (lib/ai/prompts.ts, extract-topics.ts). Pre-existing app design. If non-medical exams are ever supported, parametrize `subject` end-to-end (extract-topics already has the param; others don't).
- [ ] 🔵 **MCQ format = lettered options A–E.** `optionLetter()` in generate-questions route + `is_correct` matching assume "A. ...", "B) ...". Non-lettered / numbered / open formats not handled for auto-answer.
- [ ] 🔵 **Embedding provider = OpenAI text-embedding-3-small (1536d).** Local multilingual embeddings via the Python converter remain a zero-cost/private swap option (would change vector dim → migration).
- [ ] 🔵 **Mock user ID hardcoded in two places.** `MOCK_USER_ID = '6a7223fc-...'` duplicated in QuizEngine.tsx and FlashcardEngine.tsx (and upload route). Extract to a shared dev constant.

## Known broken / limited on real data

- [x] ✅ **Theory → subtopic mapping** (was: string-match collapsed all chunks to one bin). Replaced 2026-06-13 with seeded embedding refinement.
- [x] ✅ **Embedding speed.** 2026-07-06: (a) `embedTexts` batches now run in parallel via `Promise.all` (lib/ai/embeddings.ts); (b) past-exam grounding uses pgvector ANN search via `match_chunks` RPC (migration 009, lib/ai/match-to-theory.ts `matchChunkForQuestion`) instead of fetching all chunks + brute-force JS cosine. Mock path unchanged (brute-force fallback when `isEmbedMockEnabled()`). **Migration 009 must be applied to real Supabase to activate pgvector path.**
- [ ] 🟡 **`process-file` async work is fire-and-forget** (`setImmediate` → fetch generate-questions). Not a real queue; failures only surface via DB status. MVP limitation.
- [ ] 🟡 **`extractLargeExam` splits on a question-number regex** (`^\d+\.` etc.); brittle for exams numbered differently.

## New-exam workflow (spec reconciliation 2026-06-15)

- [x] ✅ **Two-phase ingestion: upload-all THEN generate.**
- [x] ✅ **Conditional question generation (exam-level).**
- [x] ✅ **Redirect after generation.**
- [x] ✅ **"Stuck on Generate" fix (past-exam exam).**
- [x] ✅ **Mock-DB status clobber in generate-exam.**
- [x] ✅ **Orphaned `generating_questions` stall recovery.** 2026-07-06: 10-min
  client-side timeout in UploadZone detects stalled files and surfaces amber
  "Retry Generation" button. `generate-exam` accepts `retry: true` → resets
  `generating_questions → ready` before re-queuing. (components/exam/UploadZone.tsx,
  app/api/generate-exam/route.ts)
- [x] ✅ **Add theory + recalibrate unanswered questions.** 2026-07-06: UploadZone
  detects existing exam (topics present) and switches to "Add Theory + Recalibrate
  Questions" mode. `generate-exam` accepts `recalibrate: true` → after processing
  new theory files, calls `/api/recalibrate` which re-grounds all `unanswerable` /
  low-confidence past-exam questions against the expanded chunk pool. Covers the
  "Create Questions" button use-case for adding new material post-generation.
  (app/api/recalibrate/route.ts, components/exam/UploadZone.tsx)
- [ ] 🟠 **Question-origin icon.** Every question must visibly indicate origin:
  past-exam vs AI-generated (icon/badge). The `source` field (`'past_exam' |
  'ai_generated'`) exists on `questions` — surface it in QuizCard/FlashCard.
- [ ] 🟡 **Async checkpoint UX (spec step 5).** Distinct user-visible checkpoints
  A (upload ok) / B (concepts extracted) / C (questions compiled) via
  toasts/checkmarks. Currently only a generic per-file status string.
- [ ] 🔵 **Target Date dropped (for now).** No schema column added; revisit if
  study-scheduling / countdown features land.
- [ ] 🔵 **Input formats: PDF + PPTX only (for now).** DOCX/TXT/URL deferred.

## Bugs fixed (2026-07-06)

- [x] ✅ **`record-attempt` 400 → 0% score.** `sessionId` was always `''` because
  `study_sessions` insert lacked `user_id` (NOT NULL FK → fails silently).
  `record-attempt` required `sessionId` → every attempt 400 → `setAnswers` never
  ran → session summary showed 0%. Fixes: (1) added `user_id: MOCK_USER_ID` to
  session insert in QuizEngine + FlashcardEngine; (2) `record-attempt` now only
  requires `questionId` + `isCorrect` — session operations conditional on
  `sessionId`; (3) QuizEngine updates `answers` state immediately (local-first),
  API is fire-and-forget.
- [x] ✅ **Flashcard engine crash on load.** Session creation threw on failure
  (unlike QuizEngine which made it best-effort) → always showed error state,
  never showed cards. Fixed: session best-effort, `user_id` added, card advance
  is now synchronous (no API blocking). Progress bar fixed (started at 1/N, now 0).
  Completed screen now links back to correct exam page. (components/flashcards/)
- [x] ✅ **`generateQuestionsFromText` truncated JSON.** `max_tokens: 2048` too
  low for Portuguese medical MCQs (≈1900 tokens for 5 questions). Increased to
  4096. (lib/ai/generate-questions.ts)
- [x] ✅ **Storage 413 swallowed as 500.** Supabase storage limit exceeded returned
  generic 500. Now detects `statusCode === '413'` and returns HTTP 413 with
  "File exceeds the storage size limit" message. (app/api/upload/route.ts)

## Deferred features

- [ ] 🟠 **Answer-determination UI.** Surface "AI-suggested · unverified · confidence X" badge + source citation + override button in the quiz. Override route already exists.
- [x] ✅ **Study logic wiring (item 3).** Done 2026-06-14.
- [x] ✅ **Front-end on mock DB (item 4).** Done 2026-06-14.
- [ ] 🟡 **Visual / image questions.** On hold. Needs image↔text matching — reuses the embedding retrieval layer.
- [ ] 🟡 **Cost optimization.** Haiku tiering for cheap text steps + prompt caching on stable system prompts / theory.
- [ ] 🟡 **Spaced repetition algorithm.** Simple interval×2.5 in lib/scheduling; replaceable with FSRS later.

## Migrations not yet applied to a real Supabase

004 (answer_status, ai_confidence), 005 (chunks.embedding + ivfflat), 006
(chunk candidate columns), **009 (match_chunks RPC — required for pgvector
retrieval path)**. Dev runs on the mock DB; apply all before any real Supabase
deploy.
