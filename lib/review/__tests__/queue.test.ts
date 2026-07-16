import { describe, it, expect } from "vitest";
import { buildReviewGroups, buildHorizon, minutesToGo, dueTodayCount } from "../queue";
import type { Exam, Topic, Subtopic, Question } from "@/types";

const now = new Date("2026-07-16T12:00:00Z");
const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
const inThreeDays = new Date(now.getTime() + 3 * 86_400_000).toISOString();

function exam(id: string, active: boolean): Exam {
  return { id, user_id: "u", name: `Exam ${id}`, description: null, language: null, active, created_at: "", updated_at: "" };
}
function topic(id: string, examId: string): Topic {
  return { id, exam_id: examId, name: "T", display_order: 0, created_at: "" };
}
function sub(id: string, topicId: string, mastery = 50): Subtopic {
  return { id, topic_id: topicId, name: `Sub ${id}`, display_order: 0, mastery_score: mastery, created_at: "" };
}
function q(id: string, subId: string, next: string, over: Partial<Question> = {}): Question {
  return {
    id, subtopic_id: subId, chunk_id: null, question_text: "", image_storage_path: null,
    justification: "", language: null, question_type: "mcq", source: "ai_generated",
    past_exam_year: null, matched_chunk_id: null, ai_confidence: null, answer_status: "ai_answered",
    times_seen: 0, times_correct: 0, current_interval_days: 1, last_seen_at: null,
    next_review_at: next, stability: 0, difficulty: 0, reps: 0, lapses: 0, fsrs_state: 0,
    learning_steps: 0, created_at: "", ...over,
  };
}

const accent = () => "#5b8c7e";

describe("buildReviewGroups — Active filter (the load-bearing rule)", () => {
  const exams = [exam("active", true), exam("paused", false)];
  const topics = [topic("t1", "active"), topic("t2", "paused")];
  const subs = [sub("s1", "t1"), sub("s2", "t2")];
  const questions = [
    q("q1", "s1", dayAgo), // due, active exam
    q("q2", "s2", dayAgo), // due, PAUSED exam → must be excluded
  ];

  it("excludes questions from inactive exams", () => {
    const groups = buildReviewGroups(exams, topics, subs, questions, accent, now);
    expect(groups).toHaveLength(1);
    expect(groups[0].examName).toBe("Exam active");
    expect(dueTodayCount(groups)).toBe(1);
  });

  it("excludes not-yet-due, flashcards, and unanswerable questions", () => {
    const qs = [
      q("due", "s1", dayAgo),
      q("future", "s1", inThreeDays),
      q("card", "s1", dayAgo, { question_type: "flashcard" }),
      q("unans", "s1", dayAgo, { answer_status: "unanswerable" }),
    ];
    const groups = buildReviewGroups(exams, topics, subs, qs, accent, now);
    expect(dueTodayCount(groups)).toBe(1);
  });
});

describe("buildHorizon", () => {
  it("buckets active-exam questions by day offset and drops paused ones", () => {
    const exams = [exam("active", true), exam("paused", false)];
    const topics = [topic("t1", "active"), topic("t2", "paused")];
    const subs = [sub("s1", "t1"), sub("s2", "t2")];
    const qs = [
      q("today", "s1", dayAgo),        // offset 0
      q("d3", "s1", inThreeDays),      // offset 3
      q("paused", "s2", inThreeDays),  // excluded
    ];
    const h = buildHorizon(exams, topics, subs, qs, 10, now);
    expect(h[0].count).toBe(1);
    expect(h[3].count).toBe(1);
    expect(h.reduce((n, d) => n + d.count, 0)).toBe(2); // paused dropped
  });
});

describe("minutesToGo", () => {
  it("frames card count as minutes, floor 1", () => {
    expect(minutesToGo(0)).toBe(1);
    expect(minutesToGo(104)).toBe(14); // spec's example: ~14 min for 104
  });
});
