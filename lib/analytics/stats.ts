// Analytics data assembly — pure functions over already-fetched rows (§8.6).
// Pure so exam-toggle recompute is trivially client-side and testable.

import type { Exam, Topic, Subtopic, Question, QuestionAttempt } from "@/types";

export interface DeckMastery {
  examId: string;
  examName: string;
  mastery: number; // 0-100, subtopic-averaged
  subtopicCount: number;
  cardCount: number;
}

export interface AnalyticsData {
  decks: DeckMastery[];
  /** Card-weighted overall mastery (not a naive average of deck averages). */
  overallMastery: number;
  decksTracked: number;
  cardsInRotation: number;
  reviewsThisWeek: number;
}

export function buildDeckMastery(exams: Exam[], topics: Topic[], subtopics: Subtopic[]): DeckMastery[] {
  return exams.map((exam) => {
    const topicIds = new Set(topics.filter((t) => t.exam_id === exam.id).map((t) => t.id));
    const subs = subtopics.filter((s) => topicIds.has(s.topic_id));
    const mastery = subs.length
      ? Math.round(subs.reduce((sum, s) => sum + s.mastery_score, 0) / subs.length)
      : 0;
    return {
      examId: exam.id,
      examName: exam.name,
      mastery,
      subtopicCount: subs.length,
      cardCount: 0, // filled in by buildAnalytics once questions are counted
    };
  });
}

/**
 * Assemble the full analytics payload, scoped to `includedExamIds`.
 * Card-weighted overall mastery: each subtopic's mastery weighted by its
 * question count, not a flat average of deck percentages (spec §8.6 note).
 */
export function buildAnalytics(
  exams: Exam[],
  topics: Topic[],
  subtopics: Subtopic[],
  questions: Question[],
  attempts: QuestionAttempt[],
  includedExamIds: Set<string>,
  now: Date = new Date()
): AnalyticsData {
  const includedExams = exams.filter((e) => includedExamIds.has(e.id));
  const topicById = new Map(topics.map((t) => [t.id, t]));
  const subById = new Map(subtopics.map((s) => [s.id, s]));

  const examOfSub = (subId: string): string | undefined => {
    const sub = subById.get(subId);
    const topic = sub ? topicById.get(sub.topic_id) : undefined;
    return topic?.exam_id;
  };

  const cardCountByExam = new Map<string, number>();
  const weightedMasterySum = new Map<string, number>(); // examId -> sum(mastery per card)
  for (const q of questions) {
    const examId = examOfSub(q.subtopic_id);
    if (!examId || !includedExamIds.has(examId)) continue;
    const sub = subById.get(q.subtopic_id);
    if (!sub) continue;
    cardCountByExam.set(examId, (cardCountByExam.get(examId) ?? 0) + 1);
    weightedMasterySum.set(examId, (weightedMasterySum.get(examId) ?? 0) + sub.mastery_score);
  }

  const decks: DeckMastery[] = buildDeckMastery(includedExams, topics, subtopics).map((d) => ({
    ...d,
    cardCount: cardCountByExam.get(d.examId) ?? 0,
  }));

  const totalCards = [...cardCountByExam.values()].reduce((a, b) => a + b, 0);
  const totalWeightedMastery = [...weightedMasterySum.values()].reduce((a, b) => a + b, 0);
  const overallMastery = totalCards > 0 ? Math.round(totalWeightedMastery / totalCards) : 0;

  const subtopicIdsIncluded = new Set(
    subtopics.filter((s) => {
      const examId = topicById.get(s.topic_id)?.exam_id;
      return examId && includedExamIds.has(examId);
    }).map((s) => s.id)
  );

  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const reviewsThisWeek = attempts.filter((a) => {
    const q = questions.find((q) => q.id === a.question_id);
    if (!q || !subtopicIdsIncluded.has(q.subtopic_id)) return false;
    return new Date(a.attempted_at) >= weekAgo;
  }).length;

  return {
    decks,
    overallMastery,
    decksTracked: includedExams.length,
    cardsInRotation: totalCards,
    reviewsThisWeek,
  };
}
