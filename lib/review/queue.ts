// Review queue assembly — pure functions over already-fetched rows.
// Kept pure (no DB) so the Active-exams filter and horizon math are unit-testable.
// The page does the flat fetches (mock DB can't do nested relational selects)
// and hands the rows here.

import type { Exam, Topic, Subtopic, Question } from "@/types";

/** Seconds per card, for the "minutes to go" framing (§8.2 — think in minutes). */
export const SECONDS_PER_CARD = 8;

export interface ReviewGroup {
  subtopicId: string;
  subtopicName: string;
  examId: string;
  examName: string;
  accent: string;
  mastery: number; // 0–100, from subtopic.mastery_score
  dueCount: number;
  /** "why now" line — coarse, from the most-overdue question in the group. */
  whyNow: string;
}

export interface HorizonDay {
  /** 0 = today, 1 = tomorrow, … */
  offset: number;
  count: number;
}

export type ReviewMode = "flashcard" | "quiz";

/**
 * Which questions feed today's queue depends on the study mode (§ mode
 * differentiation). Flashcard mode (default) pulls flashcard-type questions;
 * quiz mode pulls everything else (mcq/true_false/fill_blank). A question is
 * either quiz-shaped or flashcard-shaped in the DB — no pairing — so this is
 * a straight type filter, not a per-question view switch.
 */
function matchesMode(q: Question, mode: ReviewMode): boolean {
  const isFlashcard = q.question_type === "flashcard";
  if (mode === "flashcard" ? !isFlashcard : isFlashcard) return false;
  return q.answer_status !== "unanswerable";
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.setHours(0, 0, 0, 0) - from.setHours(0, 0, 0, 0);
  return Math.round(ms / 86_400_000);
}

function whyNow(mostOverdueDays: number): string {
  if (mostOverdueDays <= 0) return "ready to revisit";
  if (mostOverdueDays === 1) return "last seen recently, +1d past interval";
  return `last seen ${mostOverdueDays}d ago, interval reached`;
}

/**
 * Build the "due now, grouped by topic" rows. Only questions from ACTIVE exams,
 * only quizzable ones, only those due (next_review_at <= now).
 * `accentFor` maps an examId → its seeded accent (identity color, not state).
 */
export function buildReviewGroups(
  exams: Exam[],
  topics: Topic[],
  subtopics: Subtopic[],
  questions: Question[],
  accentFor: (examId: string) => string,
  mode: ReviewMode = "flashcard",
  now: Date = new Date()
): ReviewGroup[] {
  // active unless explicitly paused (legacy rows predating the `active` column read as active)
  const activeExamIds = new Set(exams.filter((e) => e.active !== false).map((e) => e.id));
  const examById = new Map(exams.map((e) => [e.id, e]));
  const topicById = new Map(topics.map((t) => [t.id, t]));
  const subById = new Map(subtopics.map((s) => [s.id, s]));

  const groups = new Map<string, { sub: Subtopic; exam: Exam; due: Question[] }>();

  for (const q of questions) {
    if (!matchesMode(q, mode)) continue;
    if (new Date(q.next_review_at) > now) continue; // not due yet
    const sub = subById.get(q.subtopic_id);
    if (!sub) continue;
    const topic = topicById.get(sub.topic_id);
    const exam = topic ? examById.get(topic.exam_id) : undefined;
    if (!exam || !activeExamIds.has(exam.id)) continue; // Active filter — the load-bearing rule

    let g = groups.get(sub.id);
    if (!g) {
      g = { sub, exam, due: [] };
      groups.set(sub.id, g);
    }
    g.due.push(q);
  }

  return [...groups.values()]
    .map(({ sub, exam, due }) => {
      const mostOverdue = Math.max(
        0,
        ...due.map((q) => daysBetween(new Date(q.next_review_at), new Date(now)))
      );
      return {
        subtopicId: sub.id,
        subtopicName: sub.name,
        examId: exam.id,
        examName: exam.name,
        accent: accentFor(exam.id),
        mastery: Math.round(sub.mastery_score),
        dueCount: due.length,
        whyNow: whyNow(mostOverdue),
      };
    })
    .sort((a, b) => b.dueCount - a.dueCount);
}

/**
 * Return horizon (§8.2): how many cards come back each day for the next `days`.
 * Buckets ACTIVE-exam quizzable questions by their next_review_at day offset.
 * offset 0 = today (the due pile), 1..n = future returns. Anything past the
 * window is dropped (the caption already says "spaced out").
 */
export function buildHorizon(
  exams: Exam[],
  topics: Topic[],
  subtopics: Subtopic[],
  questions: Question[],
  days: number,
  mode: ReviewMode = "flashcard",
  now: Date = new Date()
): HorizonDay[] {
  const activeExamIds = new Set(exams.filter((e) => e.active !== false).map((e) => e.id));
  const topicById = new Map(topics.map((t) => [t.id, t]));
  const subById = new Map(subtopics.map((s) => [s.id, s]));
  const examOfSub = (subId: string): string | undefined => {
    const sub = subById.get(subId);
    const topic = sub ? topicById.get(sub.topic_id) : undefined;
    return topic?.exam_id;
  };

  const buckets = new Array(days).fill(0);
  for (const q of questions) {
    if (!matchesMode(q, mode)) continue;
    const examId = examOfSub(q.subtopic_id);
    if (!examId || !activeExamIds.has(examId)) continue;
    const offset = Math.max(0, daysBetween(new Date(now), new Date(q.next_review_at)));
    if (offset < days) buckets[offset] += 1;
  }
  return buckets.map((count, offset) => ({ offset, count }));
}

/** Total due today (offset 0) across all groups. */
export function dueTodayCount(groups: ReviewGroup[]): number {
  return groups.reduce((n, g) => n + g.dueCount, 0);
}

export function minutesToGo(cardCount: number): number {
  return Math.max(1, Math.round((cardCount * SECONDS_PER_CARD) / 60));
}
