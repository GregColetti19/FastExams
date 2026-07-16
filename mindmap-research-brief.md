# FastExams — Semantic Mind Map: Research Brief

Drop this into a fresh chat to explore the idea from scratch — stack, data model,
visual design, algorithm. This doc is context, not a plan; nothing below is decided.

---

## 1. What exists today (the raw material)

FastExams already builds most of the semantic substrate a mind map would need —
it's just never been surfaced visually.

**Embeddings.** Every content chunk (theory PDF/PPTX text) gets a 1536-dim vector
via OpenAI `text-embedding-3-small` (`lib/ai/embeddings.ts`). Batched, cached,
stored per-chunk in Postgres via pgvector (`chunks.embedding`).

**Automatic topic/subtopic clustering.** `lib/ai/assign-subtopics.ts` runs a
seeded k-means-like pass over chunk embeddings:
- Seed each subtopic's center as the mean of its `seedK` (default 3) chunks
  nearest to the subtopic's AI-written description.
- Iteratively reassign every chunk to its nearest center (cosine similarity),
  recompute centers, repeat `iters` (default 2) times.
- A chunk assignment is "confident" only if the top match beats the runner-up
  by `confidentMargin` (default 0.03) — otherwise it's tie-broken by an LLM call.

So every chunk already has: a position in 1536-dim embedding space, a subtopic
assignment, and a confidence score for that assignment.

**Question-level grounding.** Past-exam questions get matched to their source
theory chunk via `matchChunkForQuestion` (`lib/ai/match-to-theory.ts`), using
pgvector ANN search (`match_chunks` RPC, migration 009) instead of brute-force
cosine — this already runs a real vector similarity search at query time.

**Mastery, per subtopic.** `subtopics.mastery_score` (0–100), now derived from
FSRS card stability (`lib/mastery.ts` `masteryFromCard`) — averaged per subtopic
in `record-attempt`. Color-coded via `masteryColor()` (teal spectrum → gold at
100%, never red).

**Hierarchy that exists in the schema:** `exams → topics → subtopics → chunks
→ questions`. Strictly tree-shaped, no cross-topic or cross-exam edges recorded
anywhere today.

**What's missing for a mind map specifically:**
- No **cross-subtopic edges**. Two subtopics that are semantically close (e.g.
  "Beta blockers" in Pharmacology and "AV node conduction" in Electrophysiology)
  have no recorded relationship — even though their chunk embeddings would show
  it, nothing computes or stores that similarity today.
- No **question-to-question** semantic graph. Two questions from different
  exams testing the same underlying concept aren't linked.
- No **graph visualization layer** anywhere in the app — the whole UI (Cadence
  redesign, in progress) is cards/lists/bars, not node-link diagrams.
- No **mastery-history table** — current mastery is a snapshot, not a trend
  (relevant if the mind map wants to show *change over time* per node, e.g. a
  branch "cooling down" from lack of review — see BACKLOG.md 🔵 item on this).

## 2. The new idea (as described, 2026-07-16)

A graphical mind map, rooted in the automatic exam categorization already
happening, where:
- Nodes = topics/subtopics (possibly down to question-level in a zoomed view).
- Edges = semantic closeness between nodes — computed from the *existing*
  chunk embeddings, not a new data source. Distance in embedding space becomes
  visual distance/edge-weight in the graph.
- Edges cross the existing tree — a Pharmacology node could connect directly to
  a Cardiology node if their content is conceptually close, which is the whole
  point: **the current UI is strictly hierarchical (exam→topic→subtopic), and
  a real medical curriculum isn't** — concepts recur and interlock across
  "chapters." A mind map surfaces that.
- High-level view = mastery per branch, using the same teal→gold mastery-color
  system already built (`lib/mastery.ts`), so a student can see at a glance
  which whole *regions* of their knowledge are strong vs. still cool.

## 3. Why this is a separate research track, not a UI tweak

Confirmed reason to research before building: this is not a color/layout
choice like the rest of the current Cadence pass — it's a **new kind of data**
(a similarity graph) and a **new kind of view** (node-link, not cards), and it
touches the clustering pipeline that already exists and is load-bearing for
subtopic assignment. Getting the data model wrong here is expensive to unwind
later; getting a button color wrong isn't.

Concretely, things that need real research/design decisions before code:
1. **Similarity computation at scale.** Precomputed edge list (batch job,
   stored) vs. computed on-demand per view? At what granularity — subtopic
   centers (cheap, ~dozens of nodes) or chunk/question level (expensive,
   hundreds–thousands of nodes)? pgvector ANN search already exists for
   chunk↔question matching — could extend to subtopic↔subtopic, but at what
   threshold does an edge get drawn (avoid a hairball)?
2. **Visualization stack.** Force-directed graph (d3-force, cytoscape.js,
   sigma.js) vs. a fixed hierarchical-with-cross-links layout vs. something
   else entirely. Needs to work in Cadence's dark+light theme, stay legible at
   "hundreds of views without fatigue" (the project's core UX mandate), and
   ideally not add a heavy new dependency for a single view (ponytail-relevant
   — the project explicitly avoided a charting library for Analytics; a graph
   library is a bigger ask than that).
3. **Interaction model.** Pan/zoom a canvas? Click a node to drill into its
   subtopic (linking back to the existing Exam page)? How does "Active exams"
   filtering (already core to Review) interact with a cross-exam graph — do
   paused exams' nodes fade, disappear, or stay as context?
4. **Reference patterns worth studying first** (per your ask — look before
   building): Obsidian's graph view (local graph vs. global graph modes),
   Roam Research's graph, academic citation-network visualizers, and mastery-
   heatmap / skill-tree UIs from language-learning or upskilling apps (Duolingo
   skill tree is tree-only though — this needs the cross-link case those don't
   have). Also worth looking at how knowledge-graph note apps handle "edge
   threshold" tuning so the graph doesn't become an unreadable hairball at
   scale (hundreds of chunks × thousands of questions).
5. **Whether it needs a schema change.** At minimum, if edges get precomputed
   and stored (recommended over live compute, for the "opens every day for
   weeks" performance bar), that's a new table (`subtopic_similarity` or
   similar) — small, additive, doesn't touch existing tables. If it goes to
   question-level, volume gets much larger and probably needs its own ANN
   index rather than a naive edge table.

## 4. Suggested starting questions for the research chat

- What's the right node granularity for a *useful* (not overwhelming) graph —
  subtopic-level only, or does question-level ever add value?
- Precompute-and-store vs. compute-on-view for the similarity edges — given
  FastExams' actual data volume (a few hundred chunks per exam, growing)?
- Which JS graph-rendering approach fits a Next.js/Tailwind/Cadence-tokens app
  without becoming its own heavy subsystem?
- Should mastery color (existing teal→gold system) drive node fill, edge
  color, or both? Does edge *thickness* encode similarity strength, or
  something else?
- Does this replace or sit alongside the Exam page's current topic/subtopic
  list view — same data, second lens, or the new default?

## 5. Status of everything else (context, not blocking this research)

The current work-in-progress is a full visual redesign ("Cadence") of the
existing app — tokens, FSRS-based scheduling, and every page restyled
(Dashboard, Review, Exam, Quiz, Flashcards, Upload, Analytics, Login/Signup).
That work is functionally complete and tested but **not yet committed**. A
separate small feature (quiz-mode vs. flashcard-mode visual differentiation,
plus a 1–5 confidence rating mapped to FSRS's native Again/Hard/Good/Easy
grades) is designed but not yet built. The mind map is intentionally being
kept **out of scope** for both of those — it's a bigger, independent research
question, not a extension of the current redesign pass.
