# FastExams — Backlog & Known Assumptions

Canonical tracker for deferred work, tech debt, hardcoded assumptions, and
untuned parameters. Update this when you defer something or bake in an
assumption — don't let it live only in a commit message or someone's head.

Status: 🔴 blocker · 🟠 important · 🟡 nice-to-have · 🔵 assumption to revisit
Last updated: 2026-06-15

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
| `seedK` | 3 | lib/ai/assign-subtopics.ts | chunks used to seed each subtopic center 🟡 |
| `iters` | 2 | lib/ai/assign-subtopics.ts | refinement passes 🟡 |
| `confidentMargin` | 0.03 | lib/ai/assign-subtopics.ts | min best-vs-2nd cosine gap to be "confident" 🟠 |

⚠️ **Tiebreak cost:** on real data ~36% of chunks land unconfident → that many LLM tie-break calls per theory file (cheap each, but 343 chunks → ~125 calls). Tune `confidentMargin` / subtopic-description quality to cut this; or batch the tiebreak (one call for several chunks). 🟠

- [ ] 🟠 Pull these into a named config module / env vars so they're visible + tunable in one place.
- [ ] 🟠 Build an **eval harness**: hand-label correct answers for ≥2 full exams, measure answer accuracy + flag rate, tune thresholds against it (don't tune on a single exam).

## Hardcoded assumptions to revisit

- [ ] 🔵 **Medical domain baked into prompts.** `"expert medical educator"`, `subject='medicine'` default (lib/ai/prompts.ts, extract-topics.ts). Pre-existing app design. If non-medical exams are ever supported, parametrize `subject` end-to-end (extract-topics already has the param; others don't).
- [ ] 🔵 **MCQ format = lettered options A–E.** `optionLetter()` in generate-questions route + `is_correct` matching assume "A. ...", "B) ...". Non-lettered / numbered / open formats not handled for auto-answer.
- [ ] 🔵 **Embedding provider = OpenAI text-embedding-3-small (1536d).** Local multilingual embeddings via the Python converter remain a zero-cost/private swap option (would change vector dim → migration).

## Known broken / limited on real data

- [x] ✅ **Theory → subtopic mapping** (was: string-match `candidate_subtopic` collapsed all chunks to one bin). Replaced 2026-06-13 with seeded embedding refinement: content-grounded tree (`extractTopicHierarchy`, subtopics carry descriptions) → seed each subtopic from nearest chunks → assign + recompute centers (lib/ai/assign-subtopics.ts) → LLM tie-break for the unconfident minority (`tiebreakSubtopic`). Real run: 343 chunks spread across 12 subtopics (was 1). See thresholds above for tuning.
- [ ] 🟡 **Brute-force cosine retrieval in app code.** Fine at one exam's scale; switch to pgvector RPC (index already created in migration 005) when corpora grow.
- [ ] 🟡 **`process-file` async work is fire-and-forget** (`setImmediate` → fetch generate-questions). Not a real queue; failures only surface via DB status. MVP limitation.
- [ ] 🟡 **`extractLargeExam` splits on a question-number regex** (`^\d+\.` etc.); brittle for exams numbered differently.

## New-exam workflow (spec reconciliation 2026-06-15)

Reconciled the built ingestion flow against the target UX spec. Decisions made:

- [x] ✅ **Two-phase ingestion: upload-all THEN generate.** Generation no longer
  fires per-file as each upload lands (that raced — a past exam could finish
  before the theory tree existed, and the past-exam gate saw the wrong set).
  New flow: `process-file` converts/chunks/embeds and marks the file `ready`
  (new status) — it does NOT trigger generation. The user uploads every file,
  then clicks **Generate Quiz** in `UploadZone`, which POSTs `/api/generate-exam`.
  That orchestrator runs **theory files first, then past-exam files** (sequential,
  so past-exam answers ground against the already-assigned theory subtopics).
- [x] ✅ **Conditional question generation (exam-level).** With all files present
  before generation, the `hasPastExams` gate in `processTheoryFile` reliably
  sees the full set: if any `past_exam` file exists, the theory pipeline skips
  AI question/flashcard generation (real past-exam questions are authoritative)
  but still builds the topic/subtopic tree (needed to ground past-exam answers +
  structure study). No past exams → AI-generate from theory.
- [x] ✅ **Redirect after generation.** Once generation completes (all files
  `done`/`error`, ≥1 `done`), `UploadZone` routes to `/exam/[examId]` (populated
  dashboard). `ready` is a settle point that stops polling and shows the
  Generate button without redirecting.
- [ ] 🟠 **"Create Questions" button (on-demand AI generation).** User can add
  new material to an already-created exam folder and explicitly trigger AI
  question generation via a button. Needed because auto-gen is now skipped when
  past exams exist — this is how the user opts into AI questions later. Requires
  a generate-on-demand route (reuse `generateQuestionsFromChunks`) + UI on the
  exam page.
- [ ] 🟠 **Question-origin icon.** Every question must visibly indicate origin:
  original/past-exam vs AI-generated (icon/badge). The `source` field
  (`'past_exam' | 'ai_generated'`) already exists on `questions` — surface it in
  QuizCard/FlashCard.
- [ ] 🟡 **Async checkpoint UX (spec step 5 — "to be done").** Distinct,
  user-visible checkpoints A (upload ok) / B (concepts extracted) / C (questions
  compiled) via toasts/checkmarks. Currently only a generic per-file status
  string (`pending→processing→generating_questions→done`). No separate
  "concepts extracted" stage surfaced.
- [ ] 🔵 **Target Date dropped (for now).** Spec proposed an optional exam Target
  Date at creation. Deliberately **not** built — revisit if study-scheduling /
  countdown features land. No schema column added.
- [ ] 🔵 **Input formats: PDF + PPTX only (for now).** Spec listed PDF/DOCX/TXT/URL.
  Keeping PDF + PPTX only; DOCX/TXT/URL ingestion deferred (each needs a new
  converter path in the Python service + `UploadZone` accept list).

## Deferred features

- [ ] 🟠 **Answer-determination UI.** Surface "AI-suggested · unverified · confidence X" badge + source citation + an override button in the quiz (override-answer route already exists).
- [x] ✅ **Study logic wiring (item 3).** Done 2026-06-14. In-session repropose of wrong answers (lib/scheduling/session-queue.ts, `MAX_REQUEUE=1`) wired into QuizEngine; quiz filters to answerable MCQs (excludes flashcards + `unanswerable`); review "Start Review" scopes to due (`?due=1`); subtopic mastery now aggregates across all subtopic questions (was: overwritten from one question). `MAX_REQUEUE` is a tuning knob.
- [x] ✅ **Front-end on mock DB (item 4) — done 2026-06-14.** Mock is the reliable dev default via committed `.env.development` (`DB_MODE`+`NEXT_PUBLIC_DB_MODE=mock`, dev-only so prod unaffected); `assertRealConfig()` throws a clear error when the real DB is selected but unconfigured (no more cryptic "Failed to fetch"); mock QueryBuilder throws loudly on nested relational selects (no FK-join engine); mock auth stubbed (`signOut`/`signInWithPassword`/`signUp`) so Navbar sign-out doesn't crash. All pages verified 200 on mock DB (dashboard/exam/exam-upload/review/quiz/quiz?due=1/flashcards); fixed nested selects in quiz, review, and exam pages (flat fetch + attach). Optional later: real FK-join support in lib/supabase/mock/query.ts so pages can use idiomatic nested selects; real auth flow (login/signup forms aren't reachable in mock — always dev user).
- [ ] 🟡 **Visual / image questions.** On hold. Needs image↔text matching — reuses the embedding retrieval layer.
- [ ] 🟡 **Cost optimization.** Haiku tiering for cheap text steps + prompt caching on stable system prompts / theory.
- [ ] 🟡 **Spaced repetition algorithm.** Simple interval×2.5 in lib/scheduling; replaceable with FSRS later.

## Migrations not yet applied to a real Supabase

004 (answer_status, ai_confidence), 005 (chunks.embedding + ivfflat), 006
(chunk candidate columns). Dev runs on the mock DB; apply these before any real
Supabase deploy.
