# StudyApp — Full Project Blueprint
> This document is the single source of truth for the StudyApp project.
> Claude Code should read this file at the start of every session and refer back to it when making architectural decisions.

---

## 1. Product Vision

A web application that allows university students (starting with medicine) to upload study material (PDFs, PowerPoints) and automatically generates **quizzes** and **flashcards** based on the content. The app tracks performance per question and per topic, and uses **active recall + spaced repetition** principles to surface weak areas at the right time.

### Core UX Flow
1. Student uploads files for an exam (e.g. "Anatomy – Year 2")
2. App processes files → extracts text, images, structure
3. App auto-generates Topic → Subtopic hierarchy
4. App generates multiple-choice questions and flashcards per subtopic
5. Student studies by doing quizzes and flashcards
6. Failed questions are tracked and resurface on a spaced schedule
7. Student can correct/retag questions and topics from within the quiz UI

---

## 2. Active Recall & Spaced Repetition — Implementation Rules

### Why It Matters
Active recall means forcing the brain to **retrieve** information rather than passively re-read it. Every time a student retrieves something correctly, the neural pathway strengthens. This app must never show the answer before the student has committed to a choice.

### Rules to Enforce in Code
- **Never reveal the answer** before the student selects an option
- **Always show a justification** after answering (correct or incorrect)
- On **incorrect answer**: immediately show correct option highlighted in green + justification in a card, then allow the student to continue
- On **correct answer**: brief positive feedback, then continue
- **No skipping questions** mid-quiz without recording an attempt

### Spaced Repetition Logic (Simple Version — MVP)
Each question row in the DB has: `times_seen`, `times_correct`, `last_seen_at`, `next_review_at`, `current_interval_days`.

**Scheduling rules:**
```
On INCORRECT answer:
  next_review_at = now + 1 day
  current_interval_days = 1

On CORRECT answer:
  new_interval = max(current_interval_days * 2.5, 1)
  new_interval = min(new_interval, 30)  -- cap at 30 days
  next_review_at = now + new_interval days
  current_interval_days = new_interval
```

**Dual-layer tracking:**
- Per-question: individual `next_review_at` as above
- Per-subtopic: `mastery_score = (correct_attempts / total_attempts) * 100` — recalculated after every session

**The `/review` page** surfaces all questions where `next_review_at <= now`, ordered by most overdue first.

> NOTE: This is intentionally simple. FSRS (the algorithm Anki uses) can replace this later with minimal DB changes. Do not over-engineer spaced repetition in Phase 1.

---

## 3. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | **Next.js 14 (App Router, TypeScript)** | Fullstack in one repo, easy Vercel deploy, future React Native reuse |
| Styling | **Tailwind CSS + shadcn/ui** | Fast, consistent, accessible components |
| Database | **PostgreSQL via Supabase** | Managed, free tier, built-in auth, file storage, pgvector support |
| File Storage | **Supabase Storage** | Integrated with DB, handles large files |
| Auth | **Supabase Auth** | Email/password to start, social login later |
| AI — Questions | **Anthropic API (claude-sonnet-4-20250514)** | Vision + text, structured JSON output, multilingual |
| AI — Embeddings | **OpenAI text-embedding-3-small** | Cheap, fast, for past-exam → theory matching (Phase 2+) |
| File Conversion — PPTX + clean PDF | **MarkItDown** (Python, Microsoft) | Excellent PPTX support via python-pptx; fast for clean digital PDFs |
| File Conversion — complex PDF | **Docling** (Python, IBM) | Superior table/multi-column/diagram layout handling |
| Conversion microservice | **FastAPI** (Python, single file) | Thin wrapper exposing MarkItDown + Docling over HTTP to Next.js |
| Language Detection | **franc** (Node.js) | Lightweight, zero-cost, runs before any LLM call |
| Background Jobs | **Next.js API routes + Supabase Edge Functions** | File processing is async; update job status in DB |
| Version Control | **GitHub** | Solo dev, invite collaborator later |
| Local Dev | **VS Code + Claude Code** | Primary development environment |

---

## 4. Repository Structure

```
studyapp/
├── app/                          # Next.js App Router pages
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── dashboard/page.tsx        # All exams overview
│   ├── exam/
│   │   └── [examId]/
│   │       ├── page.tsx          # Topic/subtopic grid for one exam
│   │       └── upload/page.tsx   # Upload UI — theory OR past exam toggle
│   ├── quiz/
│   │   └── [subtopicId]/page.tsx # Quiz engine
│   ├── review/page.tsx           # Spaced repetition review queue
│   ├── flashcards/
│   │   └── [subtopicId]/page.tsx # Flashcard mode
│   └── layout.tsx
├── components/
│   ├── ui/                       # shadcn/ui primitives
│   ├── quiz/
│   │   ├── QuizCard.tsx          # Single question — shows past-exam badge if source
│   │   ├── AnswerFeedback.tsx    # Correct/incorrect overlay
│   │   └── SessionSummary.tsx    # End-of-quiz screen
│   ├── flashcards/
│   │   └── FlashCard.tsx         # Flip card component
│   ├── exam/
│   │   ├── ExamCard.tsx          # Dashboard exam tile
│   │   ├── TopicGrid.tsx         # Topic/subtopic navigation
│   │   └── UploadZone.tsx        # Drag-and-drop with file_role selector
│   └── shared/
│       ├── ProgressRing.tsx
│       └── Navbar.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── types.ts
│   ├── ai/
│   │   ├── extract-topics.ts           # Pass 1: topic tree from theory outline
│   │   ├── generate-questions.ts       # Pass 2: MCQ from theory chunks
│   │   ├── extract-past-exam-questions.ts  # Extract Q&A pairs from past exam markdown
│   │   ├── match-to-theory.ts          # Match past exam Qs to theory chunks
│   │   ├── generate-flashcards.ts
│   │   └── prompts.ts                  # ALL prompt templates here
│   ├── processing/
│   │   ├── converter-client.ts         # HTTP client → Python microservice
│   │   ├── chunk-builder.ts            # Markdown → ContentChunk[]
│   │   ├── file-classifier.ts          # Auto-detect: theory vs past exam
│   │   └── language-detector.ts        # franc wrapper
│   └── scheduling/
│       └── spaced-repetition.ts
├── app/api/
│   ├── upload/route.ts
│   ├── process-file/route.ts           # Routes to theory OR past-exam pipeline
│   ├── generate-questions/route.ts
│   └── record-attempt/route.ts
├── converter/                          # Python microservice — runs on port 8001
│   ├── main.py                         # FastAPI: /convert endpoint
│   ├── requirements.txt                # markitdown, docling, fastapi, uvicorn, python-magic
│   └── README.md
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
├── types/
│   └── index.ts
├── .env.local.example
├── .gitignore
├── STUDYAPP_BLUEPRINT.md
└── package.json
```

---

## 5. Database Schema

```sql
-- Enable pgvector for future semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Users (managed by Supabase Auth, this extends it)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Exams (top-level container, e.g. "Anatomy Year 2")
CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  language TEXT,                   -- e.g. 'en', 'it', 'de' — detected on upload
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Source files uploaded for an exam
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,         -- 'pdf' | 'pptx'
  file_role TEXT NOT NULL DEFAULT 'theory', -- 'theory' | 'past_exam' — set by user on upload
  storage_path TEXT NOT NULL,      -- Supabase Storage path
  size_bytes BIGINT,
  processing_status TEXT DEFAULT 'pending', -- 'pending'|'processing'|'done'|'error'
  processing_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Topics (Level 1)
CREATE TABLE topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Subtopics (Level 2)
CREATE TABLE subtopics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  mastery_score FLOAT DEFAULT 0,   -- 0–100, recalculated after each session
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Content chunks (intermediate: processed file sections before question gen)
CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  subtopic_id UUID REFERENCES subtopics(id),
  content_text TEXT,
  image_storage_path TEXT,         -- null if text-only chunk
  has_image BOOLEAN DEFAULT false,
  page_or_slide INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Questions
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subtopic_id UUID NOT NULL REFERENCES subtopics(id) ON DELETE CASCADE,
  chunk_id UUID REFERENCES chunks(id),
  question_text TEXT NOT NULL,
  image_storage_path TEXT,         -- null if no image in question
  justification TEXT NOT NULL,     -- explanation of the correct answer
  language TEXT,                   -- inherited from exam
  question_type TEXT DEFAULT 'mcq', -- 'mcq' | 'true_false' | 'fill_blank'
  source TEXT DEFAULT 'ai_generated',  -- 'ai_generated' | 'past_exam'
  past_exam_year TEXT,                 -- e.g. '2023', null if ai_generated
  matched_chunk_id UUID REFERENCES chunks(id), -- for past_exam questions
  embedding vector(1536),          -- for semantic search (Phase 2+)
  -- Spaced repetition state
  times_seen INTEGER DEFAULT 0,
  times_correct INTEGER DEFAULT 0,
  current_interval_days FLOAT DEFAULT 1,
  last_seen_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Answer options for MCQ questions
CREATE TABLE question_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL   -- 0–3 for 4 options
);

-- Study sessions
CREATE TABLE study_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  subtopic_id UUID REFERENCES subtopics(id),  -- null = review session
  session_type TEXT NOT NULL,      -- 'quiz' | 'flashcard' | 'review'
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_questions INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0
);

-- Individual question attempts
CREATE TABLE question_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id),
  selected_option_id UUID REFERENCES question_options(id),
  is_correct BOOLEAN NOT NULL,
  time_spent_seconds INTEGER,
  attempted_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_exams_user_id ON exams(user_id);
CREATE INDEX idx_topics_exam_id ON topics(exam_id);
CREATE INDEX idx_subtopics_topic_id ON subtopics(topic_id);
CREATE INDEX idx_questions_subtopic_id ON questions(subtopic_id);
CREATE INDEX idx_questions_next_review ON questions(next_review_at);
CREATE INDEX idx_attempts_session_id ON question_attempts(session_id);
CREATE INDEX idx_attempts_question_id ON question_attempts(question_id);
CREATE INDEX idx_files_exam_id ON files(exam_id);
CREATE INDEX idx_chunks_file_id ON chunks(file_id);
CREATE INDEX idx_questions_source ON questions(source);
CREATE INDEX idx_files_role ON files(file_role);
```

---

## 6. File Processing Pipeline

### Overview
Processing is **asynchronous**. Upload completes instantly; processing happens in the background. The UI polls `files.processing_status` to show progress.

The student selects `file_role` on upload: **Theory Material** or **Past Exam**. The pipeline branches accordingly.

### Step 0 — Conversion (Python Microservice on port 8001)

```
Any file (PDF or PPTX)
    │
    ▼
file-classifier.ts probes content type
    │
    ├─ PPTX → MarkItDown          (excellent structure fidelity for slides)
    │
    └─ PDF:
        ├─ Try MarkItDown first (fast, good for clean digital PDFs)
        └─ If extracted text < 100 chars/page average:
            └─ Escalate to Docling (handles complex layouts, tables, multi-column)

Output: Markdown string with heading hierarchy preserved
Images: extracted separately, uploaded to Supabase Storage, refs embedded in markdown
```

The Python microservice (`converter/main.py`) exposes a single `/convert` endpoint.
Next.js calls it via `lib/processing/converter-client.ts`.

### Path A — Theory Material Pipeline

```
Markdown from converter
    │
    ▼
chunk-builder.ts → ContentChunk[] (~500 tokens or 1 slide each)
    │
    ▼
language-detector.ts (franc on first 500 chars) → store on exam
    │
    ▼
Pass 1 — Topic Extraction (one LLM call)
    │   Input: headings/outline only
    │   Output: JSON Topic → Subtopic tree
    │   Store: topics + subtopics tables
    │
    ▼
Pass 2 — Question Generation (batched LLM calls)
    │   Input: chunks grouped by subtopic
    │   Text chunks: batch 5 per call
    │   Image chunks: 1 per call (vision)
    │   Output: JSON questions + options, source='ai_generated'
    │   Store: questions + question_options tables
    │
    ▼
Update files.processing_status = 'done'
```

### Path B — Past Exam Pipeline

```
Markdown from converter
    │
    ▼
Pass 1 — Question Extraction (LLM call)
    │   Input: full markdown of past exam
    │   Output: JSON array of extracted Q&A pairs
    │   Each pair: { question_text, correct_answer, other_options[], year? }
    │
    ▼
Pass 2 — Theory Matching (per extracted question)
    │   For each past exam question:
    │   ├─ Keyword-match against existing theory chunks (MVP: simple TF-IDF style)
    │   ├─ Assign to best-matching subtopic
    │   └─ Generate justification via LLM using matched chunk as context
    │
    ▼
Store questions with source='past_exam', matched_chunk_id, past_exam_year
    │
    ▼
Update files.processing_status = 'done'
```

> NOTE: Theory matching in MVP uses keyword overlap. Phase 2 upgrades this to vector embeddings (pgvector + OpenAI text-embedding-3-small) for semantic matching.

### Chunk Format (internal TypeScript type)
```typescript
interface ContentChunk {
  fileId: string;
  pageOrSlide: number;
  text: string;
  imageStoragePath: string | null;
  hasImage: boolean;
  candidateTopic?: string;       // from slide title or PDF heading
  candidateSubtopic?: string;
  language: string;
}

// Extracted question from a past exam file
interface PastExamQuestion {
  questionText: string;
  correctAnswer: string;
  otherOptions: string[];        // wrong options as extracted
  year?: string;                 // e.g. "2023" if detectable from filename/content
  pageNumber?: number;
}
```

### Cost Optimization Rules
- Text-only chunks: send only text to LLM (no image token cost)
- Image chunks: send image + text together in one call
- Batch up to 5 text-only chunks per LLM call (reduces API calls ~5x)
- Image chunks are always processed individually
- Target: max 25 LLM calls per 100-slide deck

---

## 7. AI Prompts

All prompts live in `lib/ai/prompts.ts`. This is the authoritative source — never write prompts inline in route handlers.

### Prompt 1 — Topic Extraction

```
System:
You are an expert academic curriculum analyzer. You extract structured topic hierarchies from study material outlines.
Always respond with valid JSON only. No preamble, no markdown fences.

User:
Below is the outline of a study document for a university {subject} course.
The document language is: {language}

Extract a 2-level hierarchy of Topic → Subtopic.
- Topics should be broad themes (e.g. "Cardiovascular System")
- Subtopics should be specific, teachable units (e.g. "Heart Valves", "Cardiac Cycle")
- Aim for 3–8 subtopics per topic
- Use the same language as the document

Outline:
{outline}

Respond with this exact JSON structure:
{
  "topics": [
    {
      "name": "Topic Name",
      "subtopics": ["Subtopic A", "Subtopic B", "Subtopic C"]
    }
  ]
}
```

### Prompt 2 — Question Generation (text chunk)

```
System:
You are an expert medical exam question writer. You create high-quality multiple choice questions 
for university medical students. Always respond with valid JSON only. No preamble, no markdown fences.

User:
Generate {n} multiple choice questions from the following study content.
Document language: {language}
Topic: {topic}
Subtopic: {subtopic}

Rules:
- Each question must have exactly 4 options
- Exactly one option must be correct
- Wrong options must be plausible (not obviously wrong)
- The justification must explain WHY the correct answer is right, and briefly why the others are wrong
- Questions must test understanding, not just memorization of exact phrases
- Write questions and options in the same language as the document ({language})
- Question types to use: mix of factual, applied, and clinical reasoning

Content:
{text}

Respond with this exact JSON structure:
{
  "questions": [
    {
      "question_text": "...",
      "options": [
        { "text": "...", "is_correct": false },
        { "text": "...", "is_correct": true },
        { "text": "...", "is_correct": false },
        { "text": "...", "is_correct": false }
      ],
      "justification": "..."
    }
  ]
}
```

### Prompt 3 — Question Generation (image chunk)

```
System:
You are an expert medical exam question writer specializing in visual/diagram-based questions.
Always respond with valid JSON only. No preamble, no markdown fences.

User:
The following image is from a medical study document.
Document language: {language}
Topic: {topic}
Subtopic: {subtopic}

Additional text context from this slide/page:
{text}

Generate 2 multiple choice questions that specifically reference this image/diagram.
At least one question must require visual interpretation of the image.

Rules:
- Each question must have exactly 4 options
- Exactly one option is correct
- Wrong options must be plausible
- Reference the image explicitly in the question (e.g. "In the diagram shown...", "Based on the figure...")
- Justification must explain what to look for in the image
- Write in {language}

Respond with this exact JSON structure:
{
  "questions": [
    {
      "question_text": "...",
      "options": [
        { "text": "...", "is_correct": false },
        { "text": "...", "is_correct": true },
        { "text": "...", "is_correct": false },
        { "text": "...", "is_correct": false }
      ],
      "justification": "..."
    }
  ]
}
```

### Prompt 4 — Flashcard Generation

```
System:
You are an expert at creating concise, effective study flashcards using active recall principles.
Always respond with valid JSON only. No preamble, no markdown fences.

User:
Create {n} flashcards from the following study content.
Document language: {language}
Topic: {topic}
Subtopic: {subtopic}

Rules:
- Front: a clear question or concept prompt
- Back: a concise answer (2–4 sentences max)
- Focus on definitions, mechanisms, classifications, and clinical relevance
- Write in {language}

Content:
{text}

Respond with:
{
  "flashcards": [
    { "front": "...", "back": "..." }
  ]
}
```


### Prompt 5 — Past Exam Question Extraction

```
System:
You are an expert at extracting structured question-and-answer data from university exam papers.
Always respond with valid JSON only. No preamble, no markdown fences.

User:
The following is a past exam paper converted to markdown.
Extract all questions and their answer options.
Document language: {language}

Rules:
- Extract every question verbatim (preserve exact wording)
- Identify the correct answer if an answer key is present; otherwise mark correct_answer as null
- Extract all answer options for MCQ questions
- For non-MCQ questions (open text), still extract the question and mark type as 'open'
- If the exam year is visible in the document, extract it
- Preserve question numbering

Content:
{markdown}

Respond with:
{
  "year": "2023",
  "questions": [
    {
      "question_number": "1",
      "question_text": "...",
      "type": "mcq",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correct_answer": "B",
      "correct_answer_text": "..."
    }
  ]
}
```

### Prompt 6 — Justification Generation for Past Exam Questions

```
System:
You are an expert medical educator. You write clear, concise explanations for why exam answers are correct.
Always respond with valid JSON only. No preamble, no markdown fences.

User:
A past exam question has been matched to the following theory content.
Document language: {language}

Question: {question_text}
Correct answer: {correct_answer}
Wrong options: {wrong_options}

Relevant theory content:
{matched_chunk_text}

Write a justification explaining:
1. Why the correct answer is right (grounded in the theory content above)
2. Why each wrong option is incorrect (brief, 1 sentence each)

Respond with:
{
  "justification": "..."
}
```

---

## 8. Spaced Repetition Module

`lib/scheduling/spaced-repetition.ts`

```typescript
export interface QuestionSchedule {
  timesCorrect: number;
  timesSeen: number;
  currentIntervalDays: number;
  lastSeenAt: Date | null;
}

export interface ScheduleUpdate {
  nextReviewAt: Date;
  currentIntervalDays: number;
  timesCorrect: number;
  timesSeen: number;
}

export function calculateNextReview(
  schedule: QuestionSchedule,
  isCorrect: boolean
): ScheduleUpdate {
  const now = new Date();
  const newTimesSeen = schedule.timesSeen + 1;
  const newTimesCorrect = isCorrect
    ? schedule.timesCorrect + 1
    : schedule.timesCorrect;

  let newIntervalDays: number;

  if (!isCorrect) {
    newIntervalDays = 1;
  } else {
    const raw = Math.max(schedule.currentIntervalDays * 2.5, 1);
    newIntervalDays = Math.min(raw, 30);
  }

  const nextReviewAt = new Date(now);
  nextReviewAt.setDate(nextReviewAt.getDate() + Math.round(newIntervalDays));

  return {
    nextReviewAt,
    currentIntervalDays: newIntervalDays,
    timesCorrect: newTimesCorrect,
    timesSeen: newTimesSeen,
  };
}

export function getMasteryScore(
  timesCorrect: number,
  timesSeen: number
): number {
  if (timesSeen === 0) return 0;
  return Math.round((timesCorrect / timesSeen) * 100);
}
```

---

## 9. UI/UX Specifications

### Design Principles
- **Mobile-first layout** (will extend to React Native later — use Tailwind classes only, no CSS that can't translate)
- **Minimal cognitive load** during quizzes — one question visible at a time, no distractions
- **Clear color coding**: green = correct, red = incorrect, blue = primary actions
- Use **shadcn/ui** components throughout for consistency

### Page Specs

#### `/dashboard`
- Grid of exam cards
- Each card: exam name, file count, progress ring (% mastery across all subtopics), last studied date
- "+ New Exam" button (opens modal to name exam, then redirects to upload page)

#### `/exam/[examId]`
- Exam name + header
- Grouped by Topic (accordion or section)
- Each subtopic shown as a card: name, question count, mastery score (colored 0–100), "Quiz" button, "Flashcards" button
- "Review Due" banner at top if any questions are due for spaced repetition
- Button to upload more files

#### `/exam/[examId]/upload`
- Drag-and-drop zone accepting PDF and PPTX
- Show upload progress, then processing status (pending → processing → done)
- Processing is async — show spinner with status message from DB polling

#### `/quiz/[subtopicId]`
- One question at a time, full screen focus
- Question text (+ image if present, displayed above options)
- 4 answer options as large tappable cards
- After selection:
  - Correct: card turns green, brief "Correct!" feedback, auto-advance after 1.5s
  - Incorrect: selected card turns red, correct card turns green, justification appears in a card below, "Continue" button
- Progress bar at top (question X of N)
- End screen: score, time, list of failed questions, "Review Missed" button

#### `/flashcards/[subtopicId]`
- One card at a time, centered
- Front of card shown (question/prompt)
- Tap/click to flip → back shown (answer)
- After flip: two buttons — "Got it ✓" and "Missed it ✗"
- These feed the spaced repetition scheduler (same logic as quiz)
- Progress indicator

#### `/review`
- List of all questions due for review (next_review_at <= now)
- Count of due questions shown on dashboard nav
- Starts a quiz session with only the due questions
- Grouped by subtopic for context

### Quiz Correction UI
During a quiz, on any question, a small "⚑ Flag" icon allows the student to:
- Reassign the question to a different subtopic (dropdown)
- Mark question as "poor quality" (queues for regeneration)
This is saved immediately and does not interrupt the quiz flow.

---

## 10. Environment Variables

```bash
# .env.local.example

# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # server-side only

# Anthropic
ANTHROPIC_API_KEY=your-anthropic-key

# OpenAI (Phase 2 — embeddings)
OPENAI_API_KEY=your-openai-key

# Processing
CONVERTER_SERVICE_URL=http://localhost:8001  # Python microservice
MAX_FILE_SIZE_MB=300
QUESTIONS_PER_CHUNK=5
PDF_MIN_CHARS_PER_PAGE=100  # below this → escalate to Docling
```

---

## 11. Build Phases & Priority

### Phase 1 — Foundation (Week 1)
- [ ] GitHub repo + Next.js 14 scaffold (TypeScript, Tailwind, shadcn/ui)
- [ ] Supabase project setup + run migration `001_initial_schema.sql`
- [ ] Supabase Auth (email/password)
- [ ] Basic routing: `/dashboard`, `/exam/[examId]`, auth pages
- [ ] `.env.local` configured

### Phase 2 — File Processing Pipeline (Week 2)
- [ ] Python microservice `converter/main.py` (FastAPI, MarkItDown + Docling)
- [ ] File upload UI (UploadZone with Theory / Past Exam toggle)
- [ ] `/api/upload` route — stores file in Supabase Storage, saves file_role
- [ ] `lib/processing/converter-client.ts` — HTTP client to Python microservice
- [ ] `lib/processing/file-classifier.ts` — detect if PDF needs Docling escalation
- [ ] `lib/processing/language-detector.ts` — franc integration
- [ ] `lib/processing/chunk-builder.ts` — markdown → ContentChunk[]
- [ ] `/api/process-file` route — branches to theory or past-exam pipeline
- [ ] Processing status polling in UI

### Phase 3 — AI Question Generation (Week 3)
- [ ] `lib/ai/extract-topics.ts` — Pass 1 (theory path)
- [ ] `lib/ai/generate-questions.ts` — Pass 2 (text + vision, theory path)
- [ ] `lib/ai/extract-past-exam-questions.ts` — extract Q&A from past exam markdown
- [ ] `lib/ai/match-to-theory.ts` — keyword match past exam Qs → theory chunks
- [ ] `lib/ai/prompts.ts` — all prompt templates (Prompts 1–6)
- [ ] `/api/generate-questions` route
- [ ] Store topics, subtopics, questions with correct source field

### Phase 4 — Core Study UI (Week 4)
- [ ] Topic/subtopic grid on exam page
- [ ] Quiz engine (`/quiz/[subtopicId]`) — full question/answer/feedback flow
- [ ] `lib/scheduling/spaced-repetition.ts`
- [ ] `/api/record-attempt` route — saves attempt + updates scheduling
- [ ] Session summary screen

### Phase 5 — Flashcards & Review (Week 5)
- [ ] `lib/ai/generate-flashcards.ts`
- [ ] Flashcard UI (`/flashcards/[subtopicId]`)
- [ ] Review queue page (`/review`)
- [ ] Due-question badge on dashboard
- [ ] Mastery score calculation + display

### Phase 6 — Polish & Corrections (Week 6)
- [ ] Question flagging / subtopic reassignment UI
- [ ] Performance dashboard per exam
- [ ] Upload additional files to existing exam
- [ ] Error handling throughout pipeline
- [ ] Basic responsive polish

### Phase 7 — Future (Post-MVP)
- [ ] Upgrade past exam → theory matching to vector embeddings (pgvector + OpenAI text-embedding-3-small)
- [ ] FSRS algorithm upgrade for spaced repetition
- [ ] Collaborative / sharing features
- [ ] React Native mobile app (Expo)
- [ ] True/false and fill-in-the-blank question types

---

## 12. Key Technical Decisions & Rationale

| Decision | Choice | Why |
|---|---|---|
| PPTX conversion | MarkItDown | python-pptx backend gives excellent structure; slide titles → subtopic candidates |
| PDF conversion | MarkItDown (fast path) + Docling (fallback) | MarkItDown for clean digital PDFs; Docling for complex layouts, scanned, multi-column |
| Conversion architecture | Python FastAPI microservice | MarkItDown and Docling are Python-only; thin sidecar avoids Node.js constraints |
| Past exam detection | User-selected on upload + auto-confirm | Explicit toggle is reliable; auto-detect via question pattern heuristics as confirmation |
| Async processing | API route + DB status polling | Prevents timeouts on large files; simple to implement |
| Prompt output | Always JSON, no markdown fences | Deterministic parsing, no cleanup needed |
| Chunk size | ~500 tokens or 1 slide | Fits 5 chunks in one LLM call, ~5 questions per chunk is optimal |
| Image questions | Always 1 chunk = 1 LLM call | Images can't be batched; each needs its own context |
| Language handling | Detect once on upload, store on exam | Avoids re-detecting; passed into every prompt |
| Spaced repetition | Custom simple algorithm | FSRS can be swapped in later with no schema change |
| Mastery score | % correct × 100 | Simple, understood by students, easy to visualize |

---

## 13. Local Development Setup

```bash
# 1. Clone repo
git clone https://github.com/YOUR_USERNAME/studyapp.git
cd studyapp

# 2. Install Node dependencies
npm install

# 3. Set up Python microservice
cd converter
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install markitdown docling fastapi uvicorn python-magic
cd ..

# 4. Copy env file and fill in values
cp .env.local.example .env.local

# 5. Run Supabase migration
# (via Supabase dashboard SQL editor, or Supabase CLI)
supabase db push

# 6. Start both services (two terminals)
# Terminal 1 — Next.js
npm run dev

# Terminal 2 — Python converter microservice
cd converter && source venv/bin/activate && uvicorn main:app --port 8001 --reload
```

---

## 14. Notes for Claude Code

- **Always read this file at the start of a session** before writing any code
- **Do not deviate from the tech stack** listed in Section 3 without flagging it
- **All AI prompts** must go in `lib/ai/prompts.ts` — never inline in route handlers
- **Processing pipeline** is async — never make the user wait synchronously for LLM calls
- **Spaced repetition logic** must only live in `lib/scheduling/spaced-repetition.ts` — import from there everywhere
- **Never show the answer** before the student commits to a choice (active recall rule)
- **File conversion** always goes through the Python microservice at `CONVERTER_SERVICE_URL` — never call MarkItDown or Docling from Node.js directly
- **Past exam questions** are stored in the same `questions` table as AI-generated ones, distinguished by `source = 'past_exam'` — the quiz engine treats them identically
- **Past exam badge**: in QuizCard.tsx, if `question.source === 'past_exam'`, show a small "📋 Past Exam {year}" badge above the question — this is motivating for students
- When adding a new page, follow the folder structure in Section 4 exactly
- When in doubt about a DB query, check the schema in Section 5 first
- Keep components small and single-purpose — prefer composition
- All API routes should return consistent error shapes: `{ error: string, code: string }`
- The Python microservice is a sidecar — document how to start it in every session's setup checklist
