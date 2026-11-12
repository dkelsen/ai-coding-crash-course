import { and, eq, gte, sum } from "drizzle-orm";
import { db } from "~/db";
import { courses, purchases } from "~/db/schema";
import { ANALYTICS_RANGE_DAYS, type AnalyticsRange } from "~/lib/analyticsRange";

// ─── Analytics Service ───
// Instructor-facing sales and earnings figures over a time window.

/** Share of every sale the platform keeps; the instructor earns the rest. */
export const PLATFORM_CUT = 0.2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO timestamp of the earliest moment inside the window, or null for no lower bound. */
function windowStart(range: AnalyticsRange, now: Date): string | null {
  const days = ANALYTICS_RANGE_DAYS[range];
  if (days === null) return null;
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export type InstructorAnalytics = ReturnType<typeof getInstructorAnalytics>;

export function getInstructorAnalytics({
  instructorId,
  range,
  now,
}: {
  instructorId: number;
  range: AnalyticsRange;
  now: Date;
}) {
  const start = windowStart(range, now);

  const row = db
    .select({ salesCents: sum(purchases.amountPaid) })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(
      and(
        eq(courses.instructorId, instructorId),
        start === null ? undefined : gte(purchases.createdAt, start)
      )
    )
    .get();

  const salesCents = Number(row?.salesCents ?? 0);
  const earningsCents = Math.round(salesCents * (1 - PLATFORM_CUT));

  return {
    totals: { salesCents, earningsCents },
  };
}
