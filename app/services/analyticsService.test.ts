import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getInstructorAnalytics } from "./analyticsService";
import { createTeamPurchase } from "./purchaseService";

const NOW = new Date("2026-06-30T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number, extraMs = 0) {
  return new Date(NOW.getTime() - days * DAY_MS + extraMs).toISOString();
}

function addPurchase(courseId: number, amountPaid: number, createdAt: string) {
  testDb
    .insert(schema.purchases)
    .values({ userId: base.user.id, courseId, amountPaid, createdAt })
    .run();
}

describe("getInstructorAnalytics", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("totals", () => {
    it("sums sales within the 30-day window", () => {
      addPurchase(base.course.id, 4999, daysAgo(1));
      addPurchase(base.course.id, 3001, daysAgo(29));
      addPurchase(base.course.id, 10000, daysAgo(31));

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        range: "30d",
        now: NOW,
      });

      expect(result.totals.salesCents).toBe(8000);
    });

    it("reports earnings as sales minus a 20% platform cut", () => {
      addPurchase(base.course.id, 8000, daysAgo(1));

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        range: "30d",
        now: NOW,
      });

      expect(result.totals.earningsCents).toBe(6400);
    });

    it("rounds earnings to the nearest cent", () => {
      // 4999 * 0.8 = 3999.2 -> 3999; 4998 + 4999 = 9997 * 0.8 = 7997.6 -> 7998
      addPurchase(base.course.id, 4999, daysAgo(1));
      const first = getInstructorAnalytics({
        instructorId: base.instructor.id,
        range: "30d",
        now: NOW,
      });
      expect(first.totals.earningsCents).toBe(3999);

      addPurchase(base.course.id, 4998, daysAgo(2));
      const second = getInstructorAnalytics({
        instructorId: base.instructor.id,
        range: "30d",
        now: NOW,
      });
      expect(second.totals.earningsCents).toBe(7998);
    });

    it.each([
      ["7d", 7],
      ["30d", 30],
      ["90d", 90],
    ] as const)(
      "%s includes purchases exactly at the window start and excludes earlier ones",
      (range, days) => {
        addPurchase(base.course.id, 1000, daysAgo(days));
        addPurchase(base.course.id, 500, daysAgo(days, -1));
        addPurchase(base.course.id, 250, NOW.toISOString());

        const result = getInstructorAnalytics({
          instructorId: base.instructor.id,
          range,
          now: NOW,
        });

        expect(result.totals.salesCents).toBe(1250);
      }
    );

    it("all has no lower bound", () => {
      addPurchase(base.course.id, 1000, daysAgo(1));
      addPurchase(base.course.id, 2000, daysAgo(400));
      addPurchase(base.course.id, 3000, "2001-01-01T00:00:00.000Z");

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        range: "all",
        now: NOW,
      });

      expect(result.totals.salesCents).toBe(6000);
    });

    it("totals sales across all of the instructor's courses", () => {
      const second = testDb
        .insert(schema.courses)
        .values({
          title: "Second Course",
          slug: "second-course",
          description: "Another",
          salesCopy: "Copy",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Archived,
        })
        .returning()
        .get();
      addPurchase(base.course.id, 1000, daysAgo(1));
      addPurchase(second.id, 2500, daysAgo(2));

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        range: "30d",
        now: NOW,
      });

      expect(result.totals).toEqual({ salesCents: 3500, earningsCents: 2800 });
    });

    it("does not include another instructor's sales", () => {
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const otherCourse = testDb
        .insert(schema.courses)
        .values({
          title: "Other Course",
          slug: "other-course",
          description: "Not yours",
          salesCopy: "Copy",
          instructorId: other.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();
      addPurchase(base.course.id, 1000, daysAgo(1));
      addPurchase(otherCourse.id, 9000, daysAgo(1));

      const mine = getInstructorAnalytics({
        instructorId: base.instructor.id,
        range: "30d",
        now: NOW,
      });
      const theirs = getInstructorAnalytics({
        instructorId: other.id,
        range: "30d",
        now: NOW,
      });

      expect(mine.totals.salesCents).toBe(1000);
      expect(theirs.totals.salesCents).toBe(9000);
    });

    it("counts a team seat purchase's full amount", () => {
      createTeamPurchase(base.user.id, base.course.id, 24995, null, 5);

      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        range: "30d",
        now: new Date(),
      });

      expect(result.totals).toEqual({
        salesCents: 24995,
        earningsCents: 19996,
      });
    });

    it("reports zero sales and earnings when there are no purchases", () => {
      const result = getInstructorAnalytics({
        instructorId: base.instructor.id,
        range: "all",
        now: NOW,
      });

      expect(result.totals).toEqual({ salesCents: 0, earningsCents: 0 });
    });
  });
});
