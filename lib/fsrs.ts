import { fsrs, createEmptyCard, Rating, State, type Card, type Grade } from "ts-fsrs";

/**
 * FSRS scheduling wrapper — the product's core loop.
 * Runs server-side (Server Actions / Route Handlers). Keeps Python scoped to conversion.
 *
 * Persist these Card fields per item: stability, difficulty, reps, lapses,
 * state, next_review_at (= Card.due). Rehydrate with `toCard`, schedule with `review`.
 */

const scheduler = fsrs(); // default params: ~90% retention target

/** The subset of FSRS Card fields we persist. `due` is the DB's next_review_at. */
export interface StoredCard {
  due: Date;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: State;
  learning_steps: number; // position in the learning/relearning step ladder — must round-trip
  last_review?: Date | null;
}

export function newCard(now: Date = new Date()): StoredCard {
  return toStored(createEmptyCard(now));
}

/** Binary flashcard rating → FSRS grade. Isolated so a 1–5 scale can feed grades later. */
export function binaryGrade(gotIt: boolean): Grade {
  return gotIt ? Rating.Good : Rating.Again;
}

/**
 * Apply a review. Returns the next StoredCard state to persist.
 * `grade` is an FSRS Grade (Again/Hard/Good/Easy) — use `binaryGrade` for the default UI.
 */
export function review(stored: StoredCard, grade: Grade, now: Date = new Date()): StoredCard {
  const { card } = scheduler.next(toCard(stored), now, grade);
  return toStored(card);
}

/** Rehydrate a full FSRS Card from persisted fields. */
function toCard(s: StoredCard): Card {
  return {
    due: s.due,
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.last_review ?? undefined,
    learning_steps: s.learning_steps,
  } as Card;
}

function toStored(c: Card): StoredCard {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    learning_steps: c.learning_steps ?? 0,
    last_review: c.last_review ?? null,
  };
}

export { Rating, State };
export type { Grade };
