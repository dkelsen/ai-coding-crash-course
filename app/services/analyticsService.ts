import { and, asc, count, desc, eq, gte, inArray, sum, type SQL } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  LessonProgressStatus,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
} from "~/db/schema";
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

/**
 * The window's student group: enrollments in the course that started in the
 * window, however the student enrolled (purchase or team seat).
 */
function windowGroupFilter(courseId: number, start: string | null) {
  return and(
    eq(enrollments.courseId, courseId),
    start === null ? undefined : gte(enrollments.enrolledAt, start)
  );
}

function lessonCount(courseId: number) {
  const row = db
    .select({ lessons: count() })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .get();
  return row?.lessons ?? 0;
}

/** Completed lessons in the course, summed over the window's student group. */
function groupCompletedLessons(courseId: number, start: string | null) {
  const row = db
    .select({ completed: count() })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(
      enrollments,
      and(
        eq(enrollments.userId, lessonProgress.userId),
        eq(enrollments.courseId, modules.courseId)
      )
    )
    .where(
      and(
        windowGroupFilter(courseId, start),
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    )
    .get();
  return row?.completed ?? 0;
}

/**
 * Students who enrolled in the window, how many have finished, and how far
 * they got. Rates are 0–1, and 0 when there is nothing to divide by.
 */
function studentStats(courseId: number, start: string | null) {
  const row = db
    .select({ students: count(), finished: count(enrollments.completedAt) })
    .from(enrollments)
    .where(windowGroupFilter(courseId, start))
    .get();

  const students = row?.students ?? 0;
  const finished = row?.finished ?? 0;
  // Every student shares the same lesson total, so the mean of each student's
  // completed ÷ total equals the group's completions ÷ (students × total).
  const possibleCompletions = students * lessonCount(courseId);
  return {
    students,
    finished,
    notFinished: students - finished,
    finishingRate: students === 0 ? 0 : finished / students,
    progressionRate:
      possibleCompletions === 0
        ? 0
        : groupCompletedLessons(courseId, start) / possibleCompletions,
  };
}

/** Per-lesson completion counts for the window's student group, keyed by lesson id. */
function groupCompletionsByLesson(courseId: number, start: string | null) {
  const rows = db
    .select({ lessonId: lessons.id, completed: count() })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(
      enrollments,
      and(
        eq(enrollments.userId, lessonProgress.userId),
        eq(enrollments.courseId, modules.courseId)
      )
    )
    .where(
      and(
        windowGroupFilter(courseId, start),
        eq(lessonProgress.status, LessonProgressStatus.Completed)
      )
    )
    .groupBy(lessons.id)
    .all();
  return new Map(rows.map((row) => [row.lessonId, row.completed]));
}

type LessonCompletion = {
  id: number;
  title: string;
  completedCount: number;
  completedRate: number;
};

type ModuleCompletion = { id: number; title: string; lessons: LessonCompletion[] };

/**
 * Every lesson in the course, grouped by module in position order, with how
 * many of the window's `students` completed it. Rates are 0–1, and 0 when the
 * group is empty.
 */
function lessonCompletion(
  courseId: number,
  start: string | null,
  students: number
): ModuleCompletion[] {
  const completions = groupCompletionsByLesson(courseId, start);
  const rows = db
    .select({
      moduleId: modules.id,
      moduleTitle: modules.title,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
    })
    .from(modules)
    .innerJoin(lessons, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .orderBy(asc(modules.position), asc(modules.id), asc(lessons.position), asc(lessons.id))
    .all();

  const result: ModuleCompletion[] = [];
  for (const row of rows) {
    let mod = result.at(-1);
    if (mod?.id !== row.moduleId) {
      mod = { id: row.moduleId, title: row.moduleTitle, lessons: [] };
      result.push(mod);
    }
    const completedCount = completions.get(row.lessonId) ?? 0;
    mod.lessons.push({
      id: row.lessonId,
      title: row.lessonTitle,
      completedCount,
      completedRate: students === 0 ? 0 : completedCount / students,
    });
  }
  return result;
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

function selectedCourseStats(courseId: number, start: string | null) {
  const students = studentStats(courseId, start);
  return {
    ...salesAndEarnings(eq(courses.id, courseId), start),
    ...students,
    modules: lessonCompletion(courseId, start, students.students),
  };
}

export type InstructorAnalytics = ReturnType<typeof getInstructorAnalytics>;

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
      selectedCourseId === null ? null : selectedCourseStats(selectedCourseId, start),
  };
}
