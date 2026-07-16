import { describe, it, expect } from "vitest";
import { buildAnalytics } from "../stats";
import type { Exam, Topic, Subtopic, Question, QuestionAttempt } from "@/types";

function exam(id: string): Exam {
  return { id, user_id: "u", name: `Exam ${id}`, description: null, language: null, active: true, created_at: "", updated_at: "" };
}
function topic(id: string, examId: string): Topic {
  return { id, exam_id: examId, name: "T", display_order: 0, created_at: "" };
}
function sub(id: string, topicId: string, mastery: number): Subtopic {
  return { id, topic_id: topicId, name: "S", display_order: 0, mastery_score: mastery, created_at: "" };
}
function q(id: string, subId: string): Question {
  return {
    id, subtopic_id: subId, chunk_id: null, question_text: "", image_storage_path: null,
    justification: "", language: null, question_type: "mcq", source: "ai_generated",
    past_exam_year: null, matched_chunk_id: null, ai_confidence: null, answer_status: "ai_answered",
    times_seen: 0, times_correct: 0, current_interval_days: 1, last_seen_at: null,
    next_review_at: "", stability: 0, difficulty: 0, reps: 0, lapses: 0, fsrs_state: 0,
    learning_steps: 0, created_at: "",
  };
}
function attempt(id: string, questionId: string, daysAgo: number): QuestionAttempt {
  return {
    id, session_id: "sess", question_id: questionId, selected_option_id: null,
    is_correct: true, time_spent_seconds: null,
    attempted_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  };
}

describe("buildAnalytics", () => {
  const exams = [exam("a"), exam("b")];
  const topics = [topic("ta", "a"), topic("tb", "b")];
  // exam a: 1 subtopic at 80% mastery with 3 questions
  // exam b: 1 subtopic at 20% mastery with 1 question
  const subs = [sub("sa", "ta", 80), sub("sb", "tb", 20)];
  const questions = [q("qa1", "sa"), q("qa2", "sa"), q("qa3", "sa"), q("qb1", "sb")];

  it("card-weights overall mastery instead of averaging deck percentages", () => {
    const data = buildAnalytics(exams, topics, subs, questions, [], new Set(["a", "b"]));
    // naive average of (80+20)/2 = 50; card-weighted = (80*3 + 20*1)/4 = 65
    expect(data.overallMastery).toBe(65);
    expect(data.cardsInRotation).toBe(4);
  });

  it("excludes filtered-out exams from every metric", () => {
    const data = buildAnalytics(exams, topics, subs, questions, [], new Set(["a"]));
    expect(data.decks).toHaveLength(1);
    expect(data.decks[0].examId).toBe("a");
    expect(data.overallMastery).toBe(80);
    expect(data.cardsInRotation).toBe(3);
    expect(data.decksTracked).toBe(1);
  });

  it("empty selection yields zeroed metrics, not a crash", () => {
    const data = buildAnalytics(exams, topics, subs, questions, [], new Set());
    expect(data.decks).toHaveLength(0);
    expect(data.overallMastery).toBe(0);
    expect(data.cardsInRotation).toBe(0);
  });

  it("counts only reviews within the last 7 days, scoped to included exams", () => {
    const attempts = [
      attempt("r1", "qa1", 1), // within window, exam a
      attempt("r2", "qa1", 10), // outside window
      attempt("r3", "qb1", 1), // within window, exam b — excluded when b is filtered out
    ];
    const data = buildAnalytics(exams, topics, subs, questions, attempts, new Set(["a"]));
    expect(data.reviewsThisWeek).toBe(1);
  });
});
