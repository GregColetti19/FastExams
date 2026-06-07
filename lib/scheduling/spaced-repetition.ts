export interface QuestionSchedule {
  timesCorrect: number
  timesSeen: number
  currentIntervalDays: number
  lastSeenAt: Date | null
}

export interface ScheduleUpdate {
  nextReviewAt: Date
  currentIntervalDays: number
  timesCorrect: number
  timesSeen: number
}

export function calculateNextReview(
  schedule: QuestionSchedule,
  isCorrect: boolean
): ScheduleUpdate {
  const now = new Date()
  const newTimesSeen = schedule.timesSeen + 1
  const newTimesCorrect = isCorrect ? schedule.timesCorrect + 1 : schedule.timesCorrect

  let newIntervalDays: number

  if (!isCorrect) {
    newIntervalDays = 1
  } else {
    const raw = Math.max(schedule.currentIntervalDays * 2.5, 1)
    newIntervalDays = Math.min(raw, 30)
  }

  const nextReviewAt = new Date(now)
  nextReviewAt.setDate(nextReviewAt.getDate() + Math.round(newIntervalDays))

  return {
    nextReviewAt,
    currentIntervalDays: newIntervalDays,
    timesCorrect: newTimesCorrect,
    timesSeen: newTimesSeen,
  }
}

export function getMasteryScore(timesCorrect: number, timesSeen: number): number {
  if (timesSeen === 0) return 0
  return Math.round((timesCorrect / timesSeen) * 100)
}
