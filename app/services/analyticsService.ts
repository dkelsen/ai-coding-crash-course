import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  sum,
  type SQL,
} from "drizzle-orm";
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
import { inWindow, type WindowStart } from "~/lib/timeWindow";
import { countCourseQuestions } from "~/services/commentService";

// ─── Analytics Service ───
// Instructor-facing sales and earnings figures over a time window.

/** Share of every sale the platform keeps; the instructor earns the rest. */
export const PLATFORM_CUT = 0.2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The earliest moment inside the window. */
function windowStart(range: AnalyticsRange, now: Date): WindowStart {
  const days = ANALYTICS_RANGE_DAYS[range];
  if (days === null) return null;
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** A course seen through an analytics time window. */
type CourseWindow = { courseId: number; start: WindowStart };

/** Sales in the window, with the instructor's share after the platform cut. */
function salesAndEarnings(courseFilter: SQL, start: WindowStart) {
  const row = db
    .select({ salesCents: sum(purchases.amountPaid) })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(and(courseFilter, inWindow(purchases.createdAt, start)))
    .get();

  const salesCents = Number(row?.salesCents ?? 0);
  const earningsCents = Math.round(salesCents * (1 - PLATFORM_CUT));
  return { salesCents, earningsCents };
}

/**
 * The window's student group: enrollments in the course that started in the
 * window, however the student enrolled (purchase or team seat).
 */
function windowGroupFilter({ courseId, start }: CourseWindow) {
  return and(
    eq(enrollments.courseId, courseId),
    inWindow(enrollments.enrolledAt, start)
  );
}

/**
 * Students who enrolled in the window and how many have finished. The rate is
 * 0–1, and 0 when the group is empty.
 */
function studentStats(window: CourseWindow) {
  const row = db
    .select({ students: count(), finished: count(enrollments.completedAt) })
    .from(enrollments)
    .where(windowGroupFilter(window))
    .get();

  const students = row?.students ?? 0;
  const finished = row?.finished ?? 0;
  return {
    students,
    finished,
    notFinished: students - finished,
    finishingRate: students === 0 ? 0 : finished / students,
  };
}

/**
 * How many distinct students in the window's group completed each lesson of
 * the course, keyed by lesson id. Duplicate progress rows count once.
 */
function groupCompletionsByLesson(window: CourseWindow) {
  const rows = db
    .select({
      lessonId: lessons.id,
      completed: countDistinct(lessonProgress.userId),
    })
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
        windowGroupFilter(window),
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
  completions: Map<number, number>,
  students: number
): ModuleCompletion[] {
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

/**
 * Mean progression across the window's group: each student's distinct
 * completed lessons ÷ the course's lessons. Every student shares the same
 * lesson total, so this is the group's distinct completions ÷ (students ×
 * lessons). 0–1, and 0 when there is nothing to divide by.
 */
function progressionRate(
  modules: ModuleCompletion[],
  students: number
): number {
  const lessonsInCourse = modules.flatMap((mod) => mod.lessons);
  const possible = students * lessonsInCourse.length;
  if (possible === 0) return 0;
  const completed = lessonsInCourse.reduce(
    (total, lesson) => total + lesson.completedCount,
    0
  );
  return completed / possible;
}

function selectedCourseStats(window: CourseWindow) {
  const { courseId, start } = window;
  const students = studentStats(window);
  const modules = lessonCompletion(
    courseId,
    groupCompletionsByLesson(window),
    students.students
  );
  return {
    ...salesAndEarnings(eq(courses.id, courseId), start),
    ...students,
    progressionRate: progressionRate(modules, students.students),
    ...countCourseQuestions(courseId, start),
    modules,
  };
}

export type InstructorAnalyticsData = ReturnType<typeof getInstructorAnalytics>;

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
      selectedCourseId === null ? null : selectedCourseStats({ courseId: selectedCourseId, start }),
  };
}
