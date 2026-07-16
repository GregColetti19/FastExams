import Link from "next/link";
import { IconFlame, IconChevronRight } from "@tabler/icons-react";
import { createServerClient_ } from "@/lib/supabase/server";
import { seedAccent } from "@/lib/icons/registry";
import {
  buildReviewGroups,
  buildHorizon,
  dueTodayCount,
  minutesToGo,
} from "@/lib/review/queue";
import { MasteryBar, Pill } from "@/components/cadence";
import { ReviewHorizon } from "@/components/cadence/ReviewHorizon";
import { masteryLabel } from "@/lib/mastery";
import type { Exam, Topic, Subtopic, Question } from "@/types";

export const dynamic = "force-dynamic";

const HORIZON_DAYS = 10;

export default async function ReviewPage() {
  const supabase = await createServerClient_();

  // Flat fetches (mock DB has no nested relational selects); joined in queue.ts.
  const [{ data: exams }, { data: topics }, { data: subtopics }, { data: questions }] =
    await Promise.all([
      supabase.from("exams").select("*"),
      supabase.from("topics").select("*"),
      supabase.from("subtopics").select("*"),
      supabase.from("questions").select("*"),
    ]);

  const E = (exams ?? []) as Exam[];
  const T = (topics ?? []) as Topic[];
  const S = (subtopics ?? []) as Subtopic[];
  const Q = (questions ?? []) as Question[];

  const groups = buildReviewGroups(E, T, S, Q, seedAccent);
  const horizon = buildHorizon(E, T, S, Q, HORIZON_DAYS);
  const due = dueTodayCount(groups);
  const mins = minutesToGo(due);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-display text-[22px] tracking-[-0.01em] text-ink">Review</h1>
          <p className="text-sm text-ink-muted">Your spaced-repetition queue for today</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-coral/15 px-2.5 py-1 text-xs text-coral-soft">
          <IconFlame size={14} stroke={1.75} /> on a roll
        </span>
      </div>

      {due === 0 ? (
        <CaughtUp horizon={horizon} />
      ) : (
        <>
          {/* Hero */}
          <div className="mb-4 rounded-card border border-border-hair bg-surface p-5">
            <p className="font-display text-[34px] leading-none tracking-[-0.01em] text-ink">
              {due} <span className="text-[18px] text-ink-muted">cards left today</span>
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              ~{mins} min to go
            </p>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-pill bg-surface-inset">
              <div className="h-full rounded-pill bg-coral" style={{ width: "8%" }} />
            </div>
            <Link
              href={`/quiz/${groups[0].subtopicId}?due=1`}
              className="mt-4 inline-flex h-11 items-center justify-center rounded-control bg-coral px-6 font-display text-white transition-colors duration-tempo hover:bg-coral-deep"
            >
              Continue review
            </Link>
          </div>

          {/* Return horizon */}
          <div className="mb-6 rounded-card border border-border-hair bg-surface p-5">
            <p className="mb-3 text-sm text-ink-secondary">Return horizon</p>
            <ReviewHorizon days={horizon} />
          </div>

          {/* Due now, grouped */}
          <p className="mb-3 text-xs uppercase tracking-wide text-ink-muted">
            due now · grouped by topic
          </p>
          <div className="space-y-2">
            {groups.map((g) => {
              const label = masteryLabel(g.mastery);
              return (
                <Link
                  key={g.subtopicId}
                  href={`/quiz/${g.subtopicId}?due=1`}
                  className="flex items-center gap-3 rounded-card border border-border-hair bg-surface p-4 transition-all duration-150 motion-safe:hover:-translate-y-px hover:border-border-strong"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: g.accent }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-ink">{g.subtopicName}</p>
                    <p className="truncate text-xs text-ink-muted">
                      {g.examName} · {g.whyNow}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <MasteryBar pct={g.mastery} className="max-w-[120px]" />
                      {label && <span className="text-[11px] text-ink-muted">{label}</span>}
                    </div>
                  </div>
                  <Pill variant="due">{g.dueCount} due</Pill>
                  <IconChevronRight size={16} className="shrink-0 text-ink-muted" />
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Caught-up state (§8.2): calm, affirming, shows the horizon so it feels earned. */
function CaughtUp({ horizon }: { horizon: ReturnType<typeof buildHorizon> }) {
  const tomorrow = horizon[1]?.count ?? 0;
  return (
    <div className="rounded-card border border-border-hair bg-surface p-8 text-center">
      <p className="font-display text-[22px] text-ink">You&apos;re caught up.</p>
      <p className="mt-2 text-sm text-ink-muted">
        {tomorrow > 0
          ? `${tomorrow} cards return tomorrow — the loop keeps going.`
          : "Nothing due right now. Enjoy the breather."}
      </p>
      <div className="mx-auto mt-6 max-w-md text-left">
        <ReviewHorizon days={horizon} />
      </div>
    </div>
  );
}
