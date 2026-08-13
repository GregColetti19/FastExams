# FastExams — Backlog & Known Assumptions

Canonical tracker for deferred work, tech debt, hardcoded assumptions, and
untuned parameters. Update this when you defer something or bake in an
assumption — don't let it live only in a commit message or someone's head.

Status: 🔴 blocker · 🟠 important · 🟡 nice-to-have · 🔵 assumption to revisit
Last updated: 2026-08-13

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
- [ ] 🔵 **MCQ format = lettered options A–E.** `optionLetter()` (`app/api/generate-questions/route.ts:20`,
  used at line 546) + `is_correct` matching assume "A. ...", "B) ...".
  2026-07-18 check: unchanged, current intentional design — not a defect, just
  an assumption to keep in mind if non-lettered formats are ever needed.
  Non-lettered / numbered / open formats not handled for auto-answer.
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
- [ ] 🟡 **`process-file` async work is fire-and-forget — partially fixed.** 2026-07-18 check:
  `app/api/process-file/route.ts` no longer uses `setImmediate` (pipeline now
  awaited synchronously in the request handler). `app/api/generate-exam/route.ts:74`
  still does — question generation is still fire-and-forget. Not a real queue;
  failures only surface via DB status.
- [ ] 🟡 **`extractLargeExam` splits on a question-number regex** (`^\d+\.` etc.); brittle for exams numbered differently.
- [ ] 🔴 **Open-answer / multi-part exams are unsupported end to end.** Found 2026-08-12 while
  selecting eval material (`TestData/NAPDE/NAPDE_Exams/`, MSc Numerical Analysis for PDEs, Politecnico).
  Those exams are 3 questions × sub-parts (a)–(d), open-ended and proof-based
  ("Analyze (with proofs) the stability properties…", "Derive the Steklov-Poincaré problem.
  Provide the complete proof."), some requiring MATLAB code. Nothing in the answering path fits:
  - `answerExamQuestion` (lib/ai/answer-exam-question.ts) is MCQ-shaped throughout —
    `options: string[]` in, `choice: "B"` / `choice_text` out. No options exist in these exams.
  - `PROMPTS.pastExamExtraction` (lib/ai/prompts.ts) emits `type: 'mcq' | 'open'` but has **no
    representation for sub-parts** — a 4-part question either flattens into one blob or splits
    into 4 orphaned questions that each lose the shared stem.
  - The FSRS/quiz UI assumes a gradeable discrete choice; an open answer has no `correct_answer`
    to compare against.
  This is a **product gap, not a test gap**: the app targets generic university exams, and
  open/multi-part/proof-based is what a large share of real university exams look like
  (engineering, maths, humanities). MCQ-only answering silently excludes them.
  Needs: a sub-part-aware extraction schema (stem + parts), an open-answer variant of
  answer-determination that keeps the never-guess/grounding invariant but drops `choice`,
  and a UI/grading story for non-discrete answers (rubric? self-grade? model-graded with
  citation?). **Blocks** using NAPDE-style material as eval data for answer-determination.
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
- [ ] 🟡 **Spaced repetition algorithm.** Simple interval×2.5 in lib/scheduling; replaceable with FSRS later.

## Migrations applied to real Supabase (2026-07-14)

All 9 migrations (001-009) confirmed applied to the real Supabase project
(`zwyhbjkqxwpqecpabhbs`). 001-008 were already live (applied manually,
outside CLI tracking); 009 (`match_chunks` RPC — pgvector retrieval path) was
the actual gap and has now been applied + verified. CLI migration history
repaired so `supabase migration list` reflects reality.

⚠️ **RLS is disabled on all tables** on this real project (migration 003 —
matches mock-DB dev behavior). Fine for solo dev/testing; revisit before any
multi-user or public deploy.

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

