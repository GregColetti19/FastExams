# FastExams

Turn your course material into a spaced-repetition study system. Upload theory
PDFs and past exams; FastExams converts them, uses retrieval-grounded Claude to
generate quiz questions and flashcards, and schedules your reviews with FSRS.

Built for medical-school exam prep (the prompts default to a medical domain),
but the pipeline is subject-agnostic.

## How it works

1. **Upload** — drop a theory doc or a past exam (`app/exam/[examId]/upload`).
2. **Convert** — a Python FastAPI microservice (MarkItDown, with Docling
   fallback for hard PDFs) turns the file into markdown.
3. **Process** — `/api/process-file` detects language, splits into token-sized
   chunks, and embeds them for retrieval.
4. **Generate** — `/api/generate-questions` runs one of two paths:
   - *Theory:* extract topics → build a subtopic tree → generate questions +
     flashcards, grounded in retrieved chunks.
   - *Past exam:* extract questions → match to theory → generate justifications.
5. **Study** — quiz engine and flashcards, with attempts recorded and each item
   scheduled for its next review via [FSRS](https://github.com/open-spaced-repetition/ts-fsrs).
   The `/review` page surfaces everything due now.

## The study experience

**Dashboard.** Your home screen (`/dashboard`) lists every exam as a card
showing overall mastery (averaged across its subtopics) and a due-today count,
so you can see at a glance where attention is needed. Add a new exam from here.

**Exam page.** Open an exam to a topic → subtopic breakdown. Each subtopic card
carries a mastery bar with a percentage and label (e.g. "learning", "solid"),
plus when it's next due — "due today", "next due in 3d", or "nothing scheduled".
That turns the page into a study map: strong topics fade, weak or overdue ones
stand out.

**Quiz.** Multiple-choice questions grounded in your own material. You commit to
an answer before any feedback appears — active recall, never a giveaway. Correct
answers auto-advance; wrong ones show the justification and are requeued within
the same session so you re-see them before you leave. A flag button lets you
report a bad question or reassign its subtopic. A session ends on a summary:
score, time, and the questions you missed.

**Flashcards.** Front/back cards with a flip. After revealing the back you
self-rate on FSRS's four grades — **Again · Hard · Good · Easy** — and that grade
drives the scheduling directly (no invented 1–5 layer). Your rating decides when
the card comes back.

**Review.** The `/review` page is the "what should I study right now" view. It
pools everything due across all exams, in either **flashcard** or **quiz** mode,
and shows a horizon of what's coming due over the next ~10 days plus an estimated
minutes-to-go for today's load. Reviews are scheduled per item, so the queue
reflects how well you actually know each thing — not a fixed calendar.

**Analytics.** An `/analytics` page for tracking progress over time.

## Stack

- **Next.js 14** (App Router) + TypeScript + Tailwind
- **Supabase** — Postgres, Auth, RLS, pgvector for retrieval
- **Anthropic Claude** (`@anthropic-ai/sdk`) — pluggable chat + embedding
  providers, per-task model resolution
- **ts-fsrs** — spaced-repetition scheduling
- **Python / FastAPI** converter service under `converter/`

## Getting started

```bash
npm install
npm run dev:all   # Next.js + converter microservice together
```

Open http://localhost:3000.

Other useful scripts:

| Command | Does |
|---|---|
| `npm run dev` | Next.js only |
| `npm run dev:mock` | Next + converter against an in-memory mock DB (`DB_MODE=mock`) |
| `npm run dev:seed` | Seed the dev database |
| `npm run test` | Vitest suite |
| `npm run test:ai` | AI-pipeline tests only |
| `npm run test:converter` | Python converter tests |

The converter needs its own venv: `cd converter && python -m venv venv && ./venv/bin/pip install -r requirements.txt`.

## Configuration

Retrieval knobs (match thresholds, seed count, refinement iters, etc.) live in
[lib/ai/retrieval-config.ts](lib/ai/retrieval-config.ts) and are env-overridable
(`RETRIEVAL_*`). Defaults are untuned — see [BACKLOG.md](BACKLOG.md) for what's
deferred and which parameters still need an eval set.

## Project map

- `app/` — pages + API routes
- `components/` — quiz engine, flashcards, cadence UI, exam upload
- `lib/ai/` — prompts, embeddings, retrieval, generation
- `lib/review/` — review queue
- `converter/` — Python conversion microservice
- `graphify-out/` — knowledge graph of the codebase (start at `GRAPH_REPORT.md`)
