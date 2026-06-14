// In-session requeue logic ("repropose wrong answers with criteria").
//
// A quiz session works through a queue of question ids. Answer one correctly →
// it leaves the queue. Answer wrong → it goes to the BACK of the queue to be
// reproposed later in the same session, up to MAX_REQUEUE times. After that it
// leaves the session (spaced repetition has already scheduled it for tomorrow),
// so a stubbornly-missed question can't loop forever.

export const MAX_REQUEUE = 1

export interface QueueState {
  /** Remaining question ids, front = next to show. */
  queue: string[]
  /** How many times each id has been reproposed this session. */
  requeued: Record<string, number>
}

/**
 * Advance the queue after answering the front question.
 * Pure: returns a new state, does not mutate the input.
 */
export function advanceQueue(state: QueueState, wasCorrect: boolean): QueueState {
  const [answeredId, ...rest] = state.queue
  if (answeredId === undefined) return state

  const requeued = { ...state.requeued }
  const seen = requeued[answeredId] ?? 0

  // Wrong and still under the repropose cap → send to the back.
  if (!wasCorrect && seen < MAX_REQUEUE) {
    requeued[answeredId] = seen + 1
    return { queue: [...rest, answeredId], requeued }
  }

  // Correct, or out of repropose attempts → drop from the session.
  return { queue: rest, requeued }
}

/** True once every question has been resolved (correct or out of attempts). */
export function isSessionComplete(state: QueueState): boolean {
  return state.queue.length === 0
}
