# FastExams — Backlog & Known Assumptions

Canonical tracker for deferred work, tech debt, hardcoded assumptions, and
untuned parameters. Update this when you defer something or bake in an
assumption — don't let it live only in a commit message or someone's head.

Status: 🔴 blocker · 🟠 important · 🟡 nice-to-have · 🔵 assumption to revisit
Last updated: 2026-08-13

> **Start here:** [Open items, ranked](#open-items-ranked-2026-08-13) — every open
> item in priority order, verified against the code on 2026-08-13. The sections
> below it are the detail/history each ranked line points into.

---

## Thresholds & magic numbers (untuned — need an eval set)

These are judgment calls, **not** tuned against data. They were chosen by feel and
left fixed when the real-data run flagged 2/5 questions (we did NOT lower them to
force passes). Validate + tune against a labeled eval set across multiple exams.

| Constant | Value | Where | Notes |
|---|---|---|---|
| `matchMinScore` | 0.25 | lib/ai/retrieval-config.ts (was route const) | min cosine to attempt grounding. **2026-07-23: now config-driven** (`RETRIEVAL_MATCH_MIN_SCORE`), still default-valued/untuned 🟠 |
| `ANSWER_MIN_CONFIDENCE` | 0.4 | app/api/generate-questions/route.ts, app/api/recalibrate/route.ts | below → flag unanswerable. Still a route const — NOT in retrieval-config (gates the answer step, not retrieval) 🟠 |
| chunk target tokens | 500 | process-file route (`splitChunksByTokens`) | RAG default 🟡 |
| `MAX_INPUT_CHARS` | 8000 | lib/ai/embeddings.ts (`EMBED_MAX_INPUT_CHARS`) | model-dependent; env-driven since 2026-07-23. **Must be revisited on any embed-model swap** (limits vary 512..128K tokens) 🔵 |
| `EMBED_BATCH` | 96 | lib/ai/embeddings.ts (`EMBED_BATCH`) | model-dependent; env-driven since 2026-07-23 🔵 |
| `seedK` | 3 | lib/ai/retrieval-config.ts (was assign-subtopics DEFAULTS) | chunks seeding each subtopic center. **2026-07-23: config-driven** (`RETRIEVAL_SEED_K`) 🟡 |
| `iters` | 2 | lib/ai/retrieval-config.ts | refinement passes. **2026-07-23: config-driven** (`RETRIEVAL_ITERS`) 🟡 |
| `confidentMargin` | 0.03 | lib/ai/retrieval-config.ts | min best-vs-2nd cosine gap to be "confident". **2026-07-23: config-driven** (`RETRIEVAL_CONFIDENT_MARGIN`) 🟠 |
| `annCandidates` | 5 | lib/ai/retrieval-config.ts | pgvector match_count. **2026-07-23: config-driven** (`RETRIEVAL_ANN_CANDIDATES`) 🟡 |
| `STALL_TIMEOUT_MS` | 600_000 (10 min) | components/exam/UploadZone.tsx | generation stall detection threshold 🟡 |

**2026-07-23:** item "pull these into a named config module" (below) is now DONE for the five retrieval knobs — see `lib/ai/retrieval-config.ts`. Values are surfaced + env-overridable in one place but still hold today's untuned defaults; the eval-harness item remains open. Per-exam distribution logs (`[retrieval] ...` median/p10/p90 + below-threshold counts) now emit on every generation — that's the raw data an eval harness / per-subject tuning would consume.

⚠️ **Tiebreak cost:** on real data ~36% of chunks land unconfident → that many LLM tie-break calls per theory file (cheap each, but 343 chunks → ~125 calls). Tune `confidentMargin` / subtopic-description quality to cut this; or batch the tiebreak (one call for several chunks). 🟠

- [x] ✅ 🟠 Pull these into a named config module / env vars so they're visible + tunable in one place. **2026-07-23:** `lib/ai/retrieval-config.ts` (`getRetrievalConfig`). `ANSWER_MIN_CONFIDENCE` deliberately excluded (answer-step gate, not retrieval).
- [~] 🟠 **Eval harness — built 2026-08-13, label-free half only** (`scripts/model-grid/`).
  Unblocked and settled **model tiering** and the **embed-model swap** (see
  "AI models — decided 2026-08-13"). Still blocking **relative gates** and
  **per-subject retrieval profiles**, because those need what the harness cannot
  measure: hand-labelled correct answers. It measures grounding, discrimination,
  consensus, abstention, retrieval hit-rate, language, cost, latency — none of
  which is accuracy. `results/divergences.json` is the cheap route to the rest.

## Hardcoded assumptions to revisit

- [x] ✅ **Medical domain baked into prompts — fixed 2026-08-13.** Was worse than
  "prompt wording": `extractTopics`/`extractTopicHierarchy` defaulted to
  `subject='medicine'` and **no caller ever passed a value**, so every upload was
  framed as a medicine course. Subject is now inferred once at ingestion
  (`lib/ai/infer-subject.ts`, migration 012 → `exams.subject`/`subject_domain`) and
  threaded into question/flashcard/topic prompts; `questionStylesFor(domain)`
  replaces the hardcoded "clinical reasoning" style. A regression test asserts no
  prompt contains medical/clinical/patient wording.
- [ ] 🔵 **MCQ format = lettered options A–E.** `optionLetter()` + `is_correct`
  matching assume "A. ...", "B) ...". **2026-08-13 recheck: now duplicated in TWO
  routes**, not one as previously recorded — `app/api/generate-questions/route.ts:19`
  (used line 597) and `app/api/recalibrate/route.ts:10` (used line 158). Same
  function, copy-pasted; any format change has to touch both.
  Current intentional design — not a defect, just an assumption to keep in mind if
  non-lettered formats are ever needed. Non-lettered / numbered / open formats not
  handled for auto-answer.
- [x] ✅ **Embedding provider — decided 2026-08-13: `qwen/qwen3-embedding-8b` @1536.**
  MRL truncation from native 4096 verified live, so this stayed a pure env swap:
  `chunks.embedding`/`questions.embedding` remain `vector(1536)` + ivfflat, no
  migration, no re-embed. Provenance columns (`embedding_model`, `embedding_dim`)
  record which model produced each vector. **A non-1536 model (e.g. bge-m3 at 1024)
  would still need migration + full re-embed** — path documented in migration 011.
  See "AI models — decided 2026-08-13" for the measurements and fallbacks.
- [ ] 🔵 **Mock user ID hardcoded in two places.** `MOCK_USER_ID = '6a7223fc-...'`
  duplicated in `components/quiz/QuizEngine.tsx:45` and
  `components/flashcards/FlashcardEngine.tsx:17`. 2026-07-18 check: upload route
  does NOT have it (backlog previously said 3 places — corrected to 2). Extract
  to a shared dev constant.

## Known broken / limited on real data

- [x] ✅ **Theory → subtopic mapping** (was: string-match collapsed all chunks to one bin). Replaced 2026-06-13 with seeded embedding refinement.
- [x] ✅ **Embedding speed.** 2026-07-06: (a) `embedTexts` batches now run in parallel via `Promise.all` (lib/ai/embeddings.ts); (b) past-exam grounding uses pgvector ANN search via `match_chunks` RPC (migration 009, lib/ai/match-to-theory.ts `matchChunkForQuestion`) instead of fetching all chunks + brute-force JS cosine. Mock path unchanged (brute-force fallback when `isEmbedMockEnabled()`). **Migration 009 must be applied to real Supabase to activate pgvector path.**
- [ ] 🟡 **Async work is fire-and-forget — partially fixed, TWO sites remain.**
  2026-07-18: `app/api/process-file/route.ts` no longer uses `setImmediate`
  (pipeline awaited synchronously in the handler). **2026-08-13 recheck: the
  backlog undercounted — `setImmediate` is still live in `app/api/generate-exam/route.ts:74`
  (question generation) AND `app/api/upload/route.ts:127`**, which the previous
  entry missed entirely. Not a real queue; failures only surface via DB status.
- [ ] 🟡 **`extractLargeExam` splits on a question-number regex** (`^\d+\.` etc.); brittle for exams numbered differently.
- [x] ✅ **Open-answer questions are now REPORTED, not silently dropped — 2026-08-13.**
  **Scope decision (2026-08-13): MCQ-only is the intended product, not a gap.** If a
  user uploads an exam with no closed questions there is little the app can do — an
  open/proof-based answer has no discrete `correct_answer` to grade against. What was
  a real defect is that the drop was *silent*: `generate-questions/route.ts` filtered
  `type === 'mcq'` and discarded the rest, so a NAPDE-style upload processed green,
  finished `done`, and produced zero questions with no explanation.

  Fixed: the past-exam path now counts skipped opens (`skippedOpen`), returns it in
  the response, and writes a plain-language notice into `files.processing_error`
  ("Skipped N open-ended question(s) — only multiple-choice questions can be turned
  into study material."). `UploadZone` renders a notice on `done` files — previously
  `f.error` was only shown when `status === 'error'`, so a notice on a successful
  file would have been invisible. Failure text and skip notices compose in that one
  field rather than overwriting each other. Test:
  `app/api/__tests__/generate-questions-pastexam.test.ts` (mock exam = 1 mcq + 1 open
  → asserts `skippedOpen === 1`, one question persisted, status still `done`).

  Still deliberately NOT built (revisit only if open-answer study is ever wanted as a
  product): sub-part-aware extraction (`PROMPTS.pastExamExtraction` has no
  representation for stems with parts (a)–(d) — a 4-part question flattens into one
  blob or splits into 4 orphans), an open variant of `answerExamQuestion` (MCQ-shaped
  throughout: `options: string[]` in, `choice: "B"` out), and a grading story for
  non-discrete answers (rubric? self-grade? model-graded with citation?).
  Note this still **blocks** using NAPDE-style material as eval data for
  answer-determination — see `TestData/NAPDE/NAPDE_Exams/`.
- [ ] 🟠 **Math/formula fidelity through PDF→markdown is poor.** Found 2026-08-12 converting
  NAPDE exams via markitdown: subscripts detach (`Ω ∩Ω = ∅` for `Ω₁ ∩ Ω₂`), norms split across
  lines (`∥β∥ L∞(K)`), `(cid:40)` artifacts for unmapped glyphs, matrices/cases flattened.
  Affects any STEM material: retrieval quality drops, and verbatim `source_quote` grounding
  checks get unreliable when the source text itself is mangled. Docling (already a converter
  dependency) may handle formulas better than markitdown — worth A/B-ing the converter itself.

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
- [x] 🟠 **Question-origin icon.** Every question must visibly indicate origin:
  past-exam vs AI-generated (icon/badge). The `source` field (`'past_exam' |
  'ai_generated'`) exists on `questions` — surface it in QuizCard/FlashCard.
- [x] ✅ **Async checkpoint UX (spec step 5) — stale checkbox, already done.**
  2026-07-18 check: `components/exam/UploadZone.tsx` renders `StepTrack`/`StageLabel`
  (`components/cadence/StepTrack`) driven by a `toStage()` mapper (line 22)
  with distinct processing → ready → generating checkpoints. Not a generic
  status string.
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

- [x] ✅ **Answer-determination UI.** 2026-07-14: origin badge (past-exam vs
  AI-generated), amber confidence badge, and inline override picker added to
  QuizCard. Source citation (matched_chunk_id → theory quote) still not
  surfaced — only confidence % + justification shown. (components/quiz/QuizCard.tsx)
- [x] ✅ **Study logic wiring (item 3).** Done 2026-06-14.
- [x] ✅ **Front-end on mock DB (item 4).** Done 2026-06-14.
- [ ] 🟡 **Visual / image questions.** On hold. Needs image↔text matching — reuses the embedding retrieval layer.
- [ ] 🟡 **Cost optimization.** Haiku tiering for cheap text steps + prompt caching on stable system prompts / theory.
- [x] ✅ **Spaced repetition algorithm — done, backlog was stale.** FSRS shipped in
  commit `6401075`; `lib/fsrs.ts` wraps `ts-fsrs` and is wired into the write path
  (`app/api/record-attempt/route.ts`), FlashcardEngine, FlashCard, RatingControl.
  **2026-08-13:** the old interval×2.5 `lib/scheduling/spaced-repetition.ts` had
  zero non-test importers — deleted it and its test. `lib/scheduling/session-queue.ts`
  stays (live, used by QuizEngine).

## Migrations applied to real Supabase (2026-07-14)

All 9 migrations (001-009) confirmed applied to the real Supabase project
(`zwyhbjkqxwpqecpabhbs`). 001-008 were already live (applied manually,
outside CLI tracking); 009 (`match_chunks` RPC — pgvector retrieval path) was
the actual gap and has now been applied + verified. CLI migration history
repaired so `supabase migration list` reflects reality.

- [x] ✅ **010, 011, 012 — found unapplied and APPLIED 2026-08-13.** Caught during a
  backlog audit: all three existed on disk, backed already-shipped code, and none of
  their columns existed on `zwyhbjkqxwpqecpabhbs`. **The app was silently broken
  against real Supabase while green on the mock DB** — `record-attempt` writes FSRS
  state on every attempt, `infer-subject` writes `exams.subject` at ingestion, and
  the embedding writer sets provenance columns; all three targeted missing columns.

  Applied via `supabase db push --include-all`. Ledger now shows `remote` set for
  001–012. Post-apply verification:

  | check | result |
  |---|---|
  | questions backfilled (`fsrs_state=2`) | 50 — exactly the pre-count of `times_seen > 0` |
  | questions left New (`fsrs_state=0`) | 669 of 719 |
  | `reps`/`lapses`/`stability`/`difficulty` mismatches | 0 on all four |
  | seen-but-still-New / unseen-but-Review | 0 / 0 |
  | chunks stamped `text-embedding-3-small`@1536 | 560 |
  | exams `active=true` | 1 |

  **Connection gotcha, for next time:** `supabase migration list` (and any CLI
  command using the default host) times out from here — `db.<ref>.supabase.co`
  resolves **IPv6-only**. The pooler is IPv4 and works:
  `postgresql://postgres.<ref>:$SUPABASE_DB_PASSWORD@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`
  passed as `--db-url`. Also: the service-role key returns `42501 permission denied`
  on plain REST table reads, so row queries can't confirm schema — the OpenAPI doc
  at `/rest/v1/` can (it lists real columns), and `supabase db query --db-url` works
  for arbitrary SQL. Pre-migration backup of the 50 at-risk SM-2 rows was taken;
  010 only reads those columns and writes new ones, so it was a true rollback source.

⚠️ **RLS is disabled on all tables** on this real project (migration 003 —
matches mock-DB dev behavior). Fine for solo dev/testing; revisit before any
multi-user or public deploy.

- [x] ✅ **Storage RLS blocked ALL uploads on the LIVE project — fixed 2026-08-18**
  (`013_storage_owner_policies.sql`, applied to `smkuscpfrzmewsijlefb`).
  Symptom: every upload 403'd with `new row violates row-level security policy`.
  Cause: `storage.objects` had RLS **enabled with ZERO policies**, so no insert
  could ever be authorised. The bucket was created in the dashboard; its policies
  never were. No upload had ever succeeded (bucket was empty).
  Fix: owner-scoped policies keyed on `(storage.foldername(name))[1] = auth.uid()`,
  with an `is_admin()` override; `upload/route.ts` now writes `<user_id>/<ts>-<name>`.
  Verified live: 4 policies present, predicate accepts own path / rejects foreign.

  ⚠️ **TWO PROJECTS — do not confuse them.** `.env.local` →
  `zwyhbjkqxwpqecpabhbs` (dev). `.env.alphaTest` → `smkuscpfrzmewsijlefb` (LIVE,
  what Railway runs). They are in different states: dev has RLS **off** on tables
  (migration 003) with public buckets; live has RLS **on** with 11 owner-scoped
  table policies and a private bucket. Migrations 010-012 are applied to BOTH;
  013 is applied to LIVE ONLY (dev's storage layout differs — it has an extra
  `images` bucket, public=true, and legacy flat keys that would need re-keying).
  The Supabase CLI is linked to **dev**, so `supabase db push` targets the wrong
  project. Live has no DB password in env — reach it via the Management API:
  `POST https://api.supabase.com/v1/projects/smkuscpfrzmewsijlefb/database/query`
  with `SUPABASE_ACCESS_TOKEN`.

- [ ] 🟠 **Dev project still has the old storage posture.** `zwyhbjkqxwpqecpabhbs`
  keeps RLS **disabled** on exams/files/chunks (migration 003), both buckets
  `public=true`, and one anon-only INSERT policy. Fine for solo dev, but it means
  dev does NOT reproduce live's authorisation behaviour — an upload bug caused by
  RLS will pass locally and fail in production. Port 013 (plus a path re-key for
  the 9 legacy flat keys) if dev should mirror live.

- [ ] 🟡 **Orphaned storage objects on dev.** 28 objects vs 9 `files` rows: the
  exam-delete cascade selected `storage_path` but never called `storage.remove()`,
  so every deleted exam leaked its uploads. The delete route now removes them
  (best-effort, so a storage failure can't strand the DB cascade), but the 19
  pre-existing orphans are still there. Cleanup is destructive — do it deliberately.

## UX / frontend (added 2026-07-14)

- [x] 🟠 **Research + design an "activating" frontend.** Current UI is
  functional/utilitarian (plain Tailwind cards). Needs a design pass — pick a
  visual direction (motion, color, typography) that makes studying feel
  engaging rather than clinical. Scope: research phase first (references,
  direction options), then apply across quiz/flashcard/dashboard.
- [x] 🟠 **Top-to-bottom UX review of the full app.** Walk every screen as a
  real user (upload → generate → dashboard → quiz → flashcards → review),
  note friction points, dead ends, unclear states. Not code review — actual
  usage audit.
- [x] 🟠 **Study-flow analytics/performance metrics are not visible or useful.**
  Cadence UI pass (2026-07-16) added Review's due-count/horizon and an
  Analytics page (mastery by deck, cards in rotation, reviews this week).
- [ ] 🔵 **Analytics "mastery over time" has no real trend data.** No
  `mastery_snapshots`-style history table exists, so the spec's §8.6 line
  chart can't be honestly built yet — a snapshot would have to be fabricated
  or flatlined. Left out of the Analytics page rather than faked; add a daily
  mastery-snapshot table (or derive from `question_attempts` history) when
  this is prioritized.

## DataBase cancel handling and fail when uplaoding (17-07-2026)

- [x] **2026-07-18: turned out not to be a DB gap.** `DELETE /api/exam/[examId]`
  already cascades files/chunks/topics/subtopics/questions/attempts regardless
  of processing status, and `DeleteExamButton` was already unconditional on
  the dashboard `ExamCard` — nothing was actually stuck in the DB. Real gap
  was discoverability: a failed exam only had a delete affordance on the
  dashboard, not on `/exam/[examId]` or `/exam/[examId]/upload` where the
  user actually lands after a failed generation. Added `DeleteExamButton`
  (now takes optional `redirectTo`) to both pages, redirecting to `/dashboard`
  on success. (app/exam/[examId]/page.tsx, app/exam/[examId]/upload/page.tsx,
  components/exam/DeleteExamButton.tsx)

## UX updates (18-07-2026)
- [ ] 🟡 include an optional timer. 
- [ ] 🟠 implement a customizable target of question by day. Right the "Review pile" for one day and just one exam is 524 cards. It looks heavy, off course we shall point at learning everything for the exam, but with being realistic. Let the user set a daily target in parallel to bigger picture. 
- [ ] 🔵 is a "shuffle" mode option worth it?
- [ ] 🟠 remember that this will need to be deployed on app as well
  
## AI models — decided 2026-08-13 ✅

Chosen by measurement: a 45-cell grid (3 embed × 3 gen × 5 answer, ~7.1k answers)
plus a 20-cell generation study (5 models × 4 corpora × 100 questions, incl. one
Italian corpus). Eval spend ~$10.50. Harness: `scripts/model-grid/`.

**Production config** (env only — no code change to swap):

```bash
EMBED_MODEL_ID=qwen/qwen3-embedding-8b
EMBED_DIMENSIONS=1536
EMBED_QUERY_INSTRUCTION="Instruct: Given an exam question, retrieve the course material passage that answers it\nQuery: "
AI_MODEL_DEFAULT=qwen/qwen3.7-flash
AI_MODEL_ANSWER_DETERMINATION=qwen/qwen3.7-plus
```

**~$0.30/exam, down from ~$8.71 (sonnet-4.6 everywhere) — 29x.**

| role | model | $/M in | $/M out | why it won |
|---|---|---|---|---|
| embed | `qwen/qwen3-embedding-8b` | 0.010 | — | +11.6pp retrieval vs 3-small, half price, MRL→1536 (no migration) |
| generation | `qwen/qwen3.7-flash` | 0.030 | 0.130 | best language fidelity (93.8%) + best on Italian, 2.3x cheaper & 2.1x faster than #2 |
| answer-determination | `qwen/qwen3.7-plus` | 0.320 | 1.280 | best grounding (90.8%), 8.7x cheaper than sonnet-5 |

### Fallbacks, if we ever want to move

Ranked runners-up per axis. All measured, all drop-in via env.

**Generation** (discrim = correct-with-source − correct-without; higher is better)

| # | model | discrim | $/100q | note |
|---|---|---|---|---|
| 1 | `qwen/qwen3.7-flash` | 12.6 | 0.0074 | chosen |
| 2 | `deepseek/deepseek-v4-flash` | **13.0** | 0.0168 | best raw discrim + yield (99.8%); 2.3x cost, 2.1x slower, weaker on Italian (9.7 vs 13.3) |
| 3 | `moonshotai/kimi-k2.6` | 11.6 | 0.0829 | best on napde/philosophy; 11x cost |
| — | `z-ai/glm-4.7-flash` | 10.1 | 0.0133 | **least guessable questions** (trivial 63.6% vs 78-84%, tooEasy 67.8% vs 87-91%, keyPos 50/20/22/8). Take this one if question *difficulty* matters more than discrim. Yield only 89.3%. |
| — | `google/gemini-3.5-flash-lite` | 8.6 | 0.0683 | best quote fidelity (81.1%) but worst discrim; needs `AI_REASONING_MANDATORY` |

**Answer-determination** (grounded = source quote verifiably in retrieved context)

| # | model | grounded | $/q | note |
|---|---|---|---|---|
| 1 | `qwen/qwen3.7-plus` | 90.8% | 0.00066 | chosen |
| 2 | `z-ai/glm-4.7` | 86.4% | 0.00079 | closest non-Qwen; 2.3x slower |
| 3 | `anthropic/claude-sonnet-5` | 85.1% | 0.00573 | best consensus (98.9%) but 8.7x cost for worse grounding |
| — | `deepseek/deepseek-v3.2` | 82.4% | 0.00053 | cheapest |
| — | `moonshotai/kimi-k2.6` | 80.7% | 0.00118 | **answered 95.2% vs 91.9% field median with the worst grounding — guessing signature.** Avoid for the never-guess path. |

**Embedding** (retrieval hit-rate)

| # | model | hit | $/M | note |
|---|---|---|---|---|
| 1 | `qwen/qwen3-embedding-8b` | 94.0% | 0.010 | chosen; asymmetric, needs `EMBED_QUERY_INSTRUCTION` |
| 2 | `google/gemini-embedding-2` | 87.2% | 0.200 | 20x cost, MRL→1536 |
| 3 | `openai/text-embedding-3-small` | 82.4% | 0.020 | previous default |
| — | `baai/bge-m3` | untested | 0.010 | 1024-dim → **schema migration + full re-embed** |

⚠️ **Single-vendor risk:** all three axes are Qwen. `deepseek-v4-flash` (gen) and
`glm-4.7` (answer) are the natural second sources if that becomes a concern.

### Question de-biasing (shipped)

Both defects were live and student-visible before this.

- **Position** — generators put the answer at A up to **100%** of the time (luna
  237/237; gemini 90%; qwen 69%; baseline 25%). `shuffleOptions` fixes it.
- **Length** — correct option longest ~50% of the time. A prompt rule moved it
  50.0→51.1% (i.e. nothing); `equalizeOptionLengths` moved it **22.1→5.3%** at
  ~$0.004/100q, firing on ~17% of questions.

### Model quirks worth remembering

- `google/gemini-3.5-flash-lite` **400s on `reasoning:{effort:'none'}`**
  ("Reasoning is mandatory"). Handled via `AI_REASONING_MANDATORY`; its reasoning
  tokens bill as output, so effective cost is above list.
- `openai/gpt-5.6-luna` returns **unparseable JSON intermittently** even under a
  strict schema (5–9 of 10 calls failed on one cell; identical retries succeeded,
  `finish=stop`). Also 100% position bias. Not recommended unattended.
- OpenRouter **does** serve embeddings (33 models) — only discoverable via
  `?output_modalities=embeddings`; the ids don't contain "embed".

### Still open

- [ ] 🟠 **No accuracy measurement.** The harness is label-free: it measures
  grounding, discrimination, consensus, abstention, retrieval, language, cost.
  It cannot tell you which model is *right* more often. `results/divergences.json`
  (52 questions where models disagreed, 7 with no majority) is the cheap path —
  ~1h of hand-labelling converts the ranking from agreement to accuracy.
- [ ] 🟡 **Prompt caching + tiebreak batching** — deferred deliberately. Theory
  text is resent per question (~1.18M input tokens/exam); caching should cut input
  cost ~90%. Tiebreak is 125 calls returning one word each; batching → ~7.
  Bigger levers than any remaining model swap.
- [ ] 🟡 **Truncation warns but isn't handled.** `logAiUsage` warns on
  `finish_reason=length`; no auto-retry with higher max_tokens or smaller batch.
- [ ] 🟡 **Per-subject retrieval profiles.** `getRetrievalConfig({subject, language})`
  accepts both and ignores them. `exams.subject` now exists (migration 012), so the
  prerequisite is met — needs `[retrieval]` distribution logs across enough exams.
- [ ] 🟠 **Absolute vs relative grounding gate.** Relative gate behind
  `RETRIEVAL_RELATIVE_GATES` (OFF). Collect `[gate] ... DIVERGE` logs before
  switching. **Risk:** loosening wrong = answering from insufficient grounding.
- [x] ✅ Which chat model per task — answered above.
- [x] ✅ Which embedding model — answered above.
- [x] ✅ OpenRouter vs direct Anthropic — routing is now per-model-id, so both work
  in one run (`claude-*` → Anthropic SDK, vendor-prefixed → OpenRouter).
- [x] ✅ Cost of shipping live — **~$0.30/exam**, measured not estimated.

---

## Open items, ranked (2026-08-13)

Every open item, ordered by importance. Verified against the code on 2026-08-13 —
each line states what was actually found, not what was previously assumed.
Rank is *do-next order*: severity weighted by whether the thing is silently wrong
for a real user today.

### Tier 1 — correctness risk, users affected now

1. ✅ ~~**Migrations 010, 011, 012 not applied.**~~ **DONE 2026-08-13** — found
   unapplied during the audit, applied and verified the same day (50 rows
   backfilled, 0 integrity mismatches). → "Migrations applied to real Supabase"
2. ✅ ~~**Open-answer / multi-part exams unsupported.**~~ **Rescoped + fixed 2026-08-13.**
   MCQ-only is the intended product, not a gap — an open answer has nothing to grade
   against. The real defect was the *silent* drop; open questions are now counted and
   reported to the user, file still completes `done`. Full open-answer support stays
   deliberately unbuilt. → "Known broken / limited on real data"
3. 🟠 **No accuracy measurement.** The harness is label-free — it ranks models by
   agreement, not correctness. `results/divergences.json` (52 questions, 7 with no
   majority) converts it to accuracy for ~1h of hand-labelling. Blocks #4 and #8.
   → "Still open"
4. 🟠 **Absolute vs relative grounding gate.** Relative gate implemented behind
   `RETRIEVAL_RELATIVE_GATES` (confirmed default OFF, `lib/ai/grounding-gate.ts:26`).
   **Risk: loosening it wrong means answering from insufficient grounding** — the
   never-guess invariant is the product's core claim. Needs #3 before flipping.
   → "Still open"
5. 🟠 **Math/formula fidelity through PDF→markdown is poor.** Confirmed
   `converter/main.py:41` is MarkItDown-first, Docling only as a sparse-text
   fallback — the A/B was never run. Mangled source text corrupts both retrieval
   and verbatim `source_quote` grounding, so it silently undermines #4.
   → "Known broken / limited on real data"

### Tier 2 — cost and real-usage friction

6. 🟡→🟠 **Prompt caching + tiebreak batching.** Confirmed zero `cache_control`
   anywhere in `lib/` or `app/`. ~1.18M input tokens/exam resent per question;
   caching should cut input cost ~90%, tiebreak batching 125 calls → ~7.
   **Suggest promoting to 🟠: this is the single biggest remaining cost lever,
   larger than any model swap, and it is pure engineering with no eval dependency.**
   → "Still open"
7. 🟠 **Customizable daily question target.** 524-card review pile for one day/one
   exam is the headline usability problem. Confirmed nothing exists (no
   `daily_target` anywhere). → "UX updates (18-07-2026)"
8. 🟠 **Per-subject retrieval profiles.** `getRetrievalConfig` still takes
   `_opts` and ignores subject/language (verified). `exams.subject` exists
   (migration 012) so the prerequisite is met; needs `[retrieval]` logs across
   more exams, and ideally #3. → "Still open"
9. 🟠 **Deployment on app/mobile.** Noted, unscoped, no work started.
   → "UX updates (18-07-2026)"
10. 🟡 **Async work fire-and-forget — one site left.** `upload/route.ts` fixed
    2026-08-19 (now awaited in-process). `generate-exam/route.ts:75` still uses
    `setImmediate`: it runs up to 20 min per file so it cannot be awaited inside
    a request. Works on Railway's long-lived container, but the callback is not
    guaranteed to run — a real job queue is the durable fix.
    → "Production deploy debugging (2026-08-19)"
11. 🟡 **Truncation warns but isn't handled.** `lib/ai/usage.ts:31` logs on
    `finish_reason=length` and does nothing — no retry with higher `max_tokens`
    or smaller batch. Silent partial output. → "Still open"

### Tier 3 — known limits, deliberate

12. 🟡 **`extractLargeExam` question-number regex.** Brittle for exams numbered
    differently (`lib/ai/extract-past-exam-questions.ts:90`). Overlaps #2 — likely
    fixed as part of a sub-part-aware extraction schema rather than on its own.
13. 🟡 **Visual / image questions.** `generateQuestionsFromImage` exists but
    `lib/ai/generate-questions.ts:271` is still a TODO stub (never fetches from
    Storage). Reuses the embedding retrieval layer. → "Deferred features"
14. 🟡 **Optional timer.** Nothing exists. → "UX updates (18-07-2026)"
15. ✅ ~~**Mock user ID duplicated in 2 places.**~~ **DONE (verified 2026-08-19)** —
    both components now resolve the user through `supabase.auth.getUser()`. The
    only remaining literal is `lib/supabase/mock/store.ts:12`, which is the mock
    store's own seed user and belongs there. Real auth has since landed.
    → "Hardcoded assumptions to revisit"
16. 🔵 **MCQ lettered A–E assumption, in 2 modules.** `optionLetter()`
    copy-pasted into `lib/ai/generate-questions-run.ts:19` and
    `lib/ai/recalibrate-run.ts:10` (both moved out of `app/api/` on 2026-08-19).
    Intentional design, but the duplication is real debt.
    → "Hardcoded assumptions to revisit"
17. 🔵 **Mastery-over-time has no trend data.** No `mastery_snapshots` table
    (migrations stop at 012). Left honestly absent from Analytics rather than
    faked. → "UX / frontend"
18. 🔵 **Untuned retrieval thresholds.** Config-driven and visible in
    `lib/ai/retrieval-config.ts`, still default-valued. Subsumed by #3/#8 — no
    independent action. → "Thresholds & magic numbers"
19. 🔵 **Target Date dropped.** No schema column. Revisit with study-scheduling.
20. 🔵 **Input formats: PDF + PPTX only.** DOCX/TXT/URL deferred.
21. 🔵 **Shuffle mode — worth it?** Open question, not a task. Note:
    `shuffleOptions` in the codebase is the answer-position de-bias fix, unrelated
    to a user-facing shuffle mode.

### Also worth noting

✅ ~~**RLS disabled on all tables** (migration 003).~~ **DONE 2026-08-18/19** —
migration 013 on live (`smkuscpfrzmewsijlefb`) added owner-scoped storage policies,
`profiles.is_admin`, and `public.is_admin()`; migration 014 brought dev
(`zwyhbjkqxwpqecpabhbs`) to parity. `npm run db:parity` diffs both projects and
exits non-zero on drift. Storage objects are owner-prefixed (`<user_id>/<file>`).

⚠️ **Still off on dev for topics / subtopics / questions / attempts / study_sessions.**
Live has them enabled. Not a data-exposure issue there (single user, dev data), but
it is drift `db:parity` deliberately allow-lists.

⚠️ **19 orphaned storage objects on dev** — pre-date the cleanup added to
`app/api/exam/[examId]/route.ts` (which now removes objects on exam delete).

## Production deploy debugging (2026-08-19)

First real alpha deploy on Railway. Seven faults, each masking the next — the
upload 403 that started it was the *last* one visible, not the first one broken.
All fixed and verified on live.

| Fault | Cause | Fix |
|---|---|---|
| Upload 403 `new row violates RLS` | every build failed on a TS7006 in the storage-cleanup filter; Railway kept serving the last good container, so the app ran pre-fix code writing flat storage paths that migration 013's owner-scoped policy correctly rejected | `e41abae` |
| `ERR_SSL_PACKET_LENGTH_TOO_LONG` | `request.nextUrl.origin` is the public `https://` URL behind Railway's TLS-terminating proxy; the container listens on plain HTTP | `5ebabe7` |
| Silent hang, no logs, no error | `convertFile` had no timeout — an unreachable converter never threw, so the file sat at `processing` forever | `fc1b7da` |
| `getaddrinfo ENOTFOUND converter.railway.internal` | Railway private domains do not follow service renames — the service is named `Converter` but answers to `fastexams.railway.internal` | config |
| Stuck at `processing`, converter never contacted | `setImmediate` callback dropped after the response was sent | `3c80360` |
| `process-file returned 404` | self-fetching the app's own `/api` endpoint resolves in the page-render context, not the route context | `3644692` |
| `generate-questions returned 404` | same self-fetch failure, one step later | `59ac24b` |
| `[schema-check] run_sql RPC not available` on every boot | the validator called an RPC that **has never existed in this project** — it returned early every time, silently validating nothing. This is why migrations 010-012 sat unapplied unnoticed | `bb83b9a` |

### Lessons worth keeping

- **A Railway service showing Online + healthcheck passing can be running stale
  code.** A failed build leaves the previous container serving; only the *build*
  log shows the failure. Verify with
  `grep -c "<new string>" .next/server/app/api/<route>/route.js` in the Console.
  Note routes compile to `.next/server/app/api/<name>/route.js`, **not** to
  `.next/server/chunks/*.js`.
- **Redeploy ≠ deploy latest.** Redeploy rebuilds the commit that deployment was
  pinned to.
- **Never self-fetch your own API routes.** It has to resolve a base URL, pass
  the middleware gate, and land in the route context. Extract to a `lib/` module
  and call in-process. A route-to-route import does **not** bundle — Next treats
  route modules as separate entry points — but a shared `lib/` module does.

### New / still open from this session

- 🟡 **`generate-exam` still uses `setImmediate`** — see ranked item #10.
- 🔵 **Node engine mismatch.** `package.json` requires `>=22.19.0 <23`; Nixpacks
  provides `22.14.0`. Builds pass with an `EBADENGINE` warning. Either pin the
  Nixpacks Node version or relax the range.
- 🔵 **Upload response now waits for full conversion.** Fine for small files;
  a large PDF could approach a proxy timeout. The fix is a job queue, not another
  self-fetch.
