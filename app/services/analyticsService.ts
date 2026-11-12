import { and, desc, eq, gte, inArray, sum, type SQL } from "drizzle-orm";
import { db } from "~/db";
import { CourseStatus, courses, purchases } from "~/db/schema";
import { ANALYTICS_RANGE_DAYS, type AnalyticsRange } from "~/lib/analyticsRange";
import { countCourseQuestions } from "~/services/commentService";

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

/** Sales in the window, with the instructor's share after the platform cut. */
function salesAndEarnings(courseFilter: SQL, start: string | null) {
  const row = db
    .select({ salesCents: sum(purchases.amountPaid) })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(
      and(
        courseFilter,
        start === null ? undefined : gte(purchases.createdAt, start)
      )
    )
    .get();

  const salesCents = Number(row?.salesCents ?? 0);
  const earningsCents = Math.round(salesCents * (1 - PLATFORM_CUT));
  return { salesCents, earningsCents };
}

/** The instructor's published and archived courses, newest first. Drafts can't be picked. */
function pickerCourses(instructorId: number) {
  return db
    .select({ id: courses.id, title: courses.title, status: courses.status })
    .from(courses)
    .where(
      and(
        eq(courses.instructorId, instructorId),
        inArray(courses.status, [CourseStatus.Published, CourseStatus.Archived])
      )
    )
    .orderBy(desc(courses.createdAt), desc(courses.id))
    .all();
}

/**
 * The requested course if it's in the picker; otherwise the newest published
 * course, or the newest archived one if none is published.
 */
function selectCourseId(
  options: ReturnType<typeof pickerCourses>,
  requestedId: number | undefined
): number | null {
  const requested = options.find((course) => course.id === requestedId);
  const fallback =
    options.find((course) => course.status === CourseStatus.Published) ??
    options[0];
  return (requested ?? fallback)?.id ?? null;
}

/** Questions asked on the course in the window, and how many still await staff. */
function courseQuestions(courseId: number, start: string | null) {
  const { questions, unanswered } = countCourseQuestions(courseId, start);
  return { questions, unansweredQuestions: unanswered };
}

export type InstructorAnalytics =ReturnType<typeof getInstructorAnalytics>;

export function getInstructorAnalytics({
  instructorId,
  courseId,
  range,
  now,
}: {
  instructorId: number;
  courseId?: number;
  range: AnalyticsRange;
  now: Date;
}) {
  const start = windowStart(range, now);
  const options = pickerCourses(instructorId);
  const selectedCourseId = selectCourseId(options, courseId);

  return {
    totals: salesAndEarnings(eq(courses.instructorId, instructorId), start),
    courses: options,
    selectedCourseId,
    selectedCourse:
      selectedCourseId === null
        ? null
        : {
            ...salesAndEarnings(eq(courses.id, selectedCourseId), start),
            ...courseQuestions(selectedCourseId, start),
          },
  };
}
