import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { InstructorAnalytics } from "./instructor-analytics";
import type { InstructorAnalyticsData } from "~/services/analyticsService";
import type { AnalyticsRange } from "~/lib/analyticsRange";
import { CourseStatus } from "~/db/schema";

const NO_SALES = { salesCents: 0, earningsCents: 0 };
const NO_QUESTIONS = { questions: 0, unansweredQuestions: 0 };

const EMPTY_COURSE: NonNullable<InstructorAnalyticsData["selectedCourse"]> = {
  ...NO_SALES,
  students: 0,
  finished: 0,
  notFinished: 0,
  finishingRate: 0,
  progressionRate: 0,
  ...NO_QUESTIONS,
  modules: [],
};

function analyticsData(
  overrides: Partial<InstructorAnalyticsData> = {}
): InstructorAnalyticsData {
  return {
    totals: NO_SALES,
    courses: [{ id: 1, title: "Intro to TypeScript", status: CourseStatus.Published }],
    selectedCourseId: 1,
    selectedCourse: EMPTY_COURSE,
    ...overrides,
  };
}

function renderAnalytics(
  analytics: InstructorAnalyticsData,
  range: AnalyticsRange = "30d"
) {
  return render(
    <MemoryRouter>
      <InstructorAnalytics analytics={analytics} range={range} />
    </MemoryRouter>
  );
}

describe("InstructorAnalytics", () => {
  it("shows sales and earnings as dollars", () => {
    renderAnalytics(analyticsData({ totals: { salesCents: 10000, earningsCents: 8000 } }));

    expect(screen.getByText("Total sales").parentElement).toHaveTextContent("$100.00");
    expect(screen.getByText("Total earnings").parentElement).toHaveTextContent("$80.00");
  });

  it("shows zeros for a period with no sales", () => {
    renderAnalytics(analyticsData());

    expect(screen.getByText("Total sales").parentElement).toHaveTextContent("$0.00");
    expect(screen.getByText("Total earnings").parentElement).toHaveTextContent("$0.00");
  });

  it("separates thousands", () => {
    renderAnalytics(analyticsData({ totals: { salesCents: 123456789, earningsCents: 98765431 } }));

    expect(screen.getByText("Total sales").parentElement).toHaveTextContent("$1,234,567.89");
  });

  it("writes the chosen range to the URL", async () => {
    function CurrentSearch() {
      return <output data-testid="search">{useLocation().search}</output>;
    }
    render(
      <MemoryRouter initialEntries={["/dashboard?range=30d"]}>
        <InstructorAnalytics
          analytics={analyticsData()}
          range="30d"
        />
        <CurrentSearch />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole("tab", { name: "7 days" }));

    expect(screen.getByTestId("search")).toHaveTextContent("?range=7d");
  });

  it.each([
    ["7d", "7 days"],
    ["30d", "30 days"],
    ["90d", "90 days"],
    ["all", "All time"],
  ] as const)("marks %s as the selected range", (range, label) => {
    renderAnalytics(analyticsData(), range);

    expect(screen.getByRole("tab", { name: label })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    for (const other of screen.getAllByRole("tab")) {
      if (other.textContent !== label) {
        expect(other).toHaveAttribute("aria-selected", "false");
      }
    }
  });

  it("shows the selected course's sales and earnings as dollars", () => {
    renderAnalytics(
      analyticsData({
        totals: { salesCents: 30000, earningsCents: 24000 },
        selectedCourse: { ...EMPTY_COURSE, salesCents: 10000, earningsCents: 8000 },
      })
    );

    expect(screen.getByText("Course sales").parentElement).toHaveTextContent("$100.00");
    expect(screen.getByText("Course earnings").parentElement).toHaveTextContent("$80.00");
  });

  it("shows the selected course's questions with how many are unanswered", () => {
    renderAnalytics(
      analyticsData({
        selectedCourse: { ...EMPTY_COURSE, questions: 12, unansweredQuestions: 3 },
      })
    );

    const tile = screen.getByText("Questions").parentElement;
    expect(tile).toHaveTextContent("12");
    expect(tile).toHaveTextContent("3 unanswered");
  });

  it("shows zero questions for a period with none", () => {
    renderAnalytics(analyticsData());

    const tile = screen.getByText("Questions").parentElement;
    expect(tile).toHaveTextContent("0");
    expect(tile).toHaveTextContent("0 unanswered");
  });

  it("labels an archived course in the picker", async () => {
    renderAnalytics(
      analyticsData({
        courses: [
          { id: 1, title: "Intro to TypeScript", status: CourseStatus.Published },
          { id: 2, title: "Legacy React", status: CourseStatus.Archived },
        ],
        selectedCourseId: 2,
      })
    );

    const picker = screen.getByRole("combobox", { name: "Course" });
    expect(picker).toHaveTextContent("Legacy React (Archived)");

    await userEvent.click(picker);

    expect(screen.getByRole("option", { name: "Intro to TypeScript" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Legacy React (Archived)" })).toBeInTheDocument();
  });

  it("writes the chosen course to the URL and keeps the range", async () => {
    function CurrentSearch() {
      return <output data-testid="search">{useLocation().search}</output>;
    }
    render(
      <MemoryRouter initialEntries={["/dashboard?range=90d&course=1"]}>
        <InstructorAnalytics
          analytics={analyticsData({
            courses: [
              { id: 1, title: "Intro to TypeScript", status: CourseStatus.Published },
              { id: 2, title: "Legacy React", status: CourseStatus.Archived },
            ],
          })}
          range="90d"
        />
        <CurrentSearch />
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Course" }));
    await userEvent.click(screen.getByRole("option", { name: "Legacy React (Archived)" }));

    expect(screen.getByTestId("search")).toHaveTextContent("?range=90d&course=2");
  });

  it("asks the instructor to publish a course when there is nothing to pick", () => {
    renderAnalytics(
      analyticsData({
        courses: [],
        selectedCourseId: null,
        selectedCourse: null,
      })
    );

    expect(
      screen.getByText("Publish a course to see its analytics.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Course" })).not.toBeInTheDocument();
    expect(screen.getByText("Total sales").parentElement).toHaveTextContent("$0.00");
    expect(screen.getByText("Total earnings").parentElement).toHaveTextContent("$0.00");
  });

  it("shows the selected course's student counts and rates as whole-number percentages", () => {
    renderAnalytics(
      analyticsData({
        selectedCourse: {
          ...EMPTY_COURSE,
          students: 3,
          finished: 2,
          notFinished: 1,
          finishingRate: 2 / 3,
          progressionRate: 0.125,
        },
      })
    );

    expect(screen.getByText("Students").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Finished").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Not finished").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Finishing rate").parentElement).toHaveTextContent("67%");
    expect(screen.getByText("Progression rate").parentElement).toHaveTextContent("13%");
  });

  it("shows zero students and 0% rates for an empty period", () => {
    renderAnalytics(analyticsData());

    expect(screen.getByText("Students").parentElement).toHaveTextContent("0");
    expect(screen.getByText("Finished").parentElement).toHaveTextContent("0");
    expect(screen.getByText("Not finished").parentElement).toHaveTextContent("0");
    expect(screen.getByText("Finishing rate").parentElement).toHaveTextContent("0%");
    expect(screen.getByText("Progression rate").parentElement).toHaveTextContent("0%");
  });
});

describe("InstructorAnalytics lesson completion table", () => {
  const MODULES = [
    {
      id: 10,
      title: "Getting Started",
      lessons: [
        { id: 100, title: "Welcome", completedCount: 12, completedRate: 0.24 },
        { id: 101, title: "Setup", completedCount: 1, completedRate: 1 / 3 },
      ],
    },
    {
      id: 11,
      title: "Advanced Types",
      lessons: [{ id: 102, title: "Generics", completedCount: 0, completedRate: 0 }],
    },
  ];

  it("groups lessons under their module in order", () => {
    renderAnalytics(analyticsData({ selectedCourse: { ...EMPTY_COURSE, modules: MODULES } }));

    const table = screen.getByRole("table", { name: "Lesson completion" });
    const rowText = within(table)
      .getAllByRole("row")
      .map((row) => row.textContent);

    expect(rowText).toEqual([
      "LessonCompleted",
      "Getting Started",
      "Welcome12 (24%)",
      "Setup1 (33%)",
      "Advanced Types",
      "Generics0 (0%)",
    ]);
  });

  it("shows each lesson's completions as count and whole-number percentage", () => {
    renderAnalytics(analyticsData({ selectedCourse: { ...EMPTY_COURSE, modules: MODULES } }));

    expect(screen.getByRole("row", { name: /Welcome/ })).toHaveTextContent("12 (24%)");
    expect(screen.getByRole("row", { name: /Setup/ })).toHaveTextContent("1 (33%)");
    expect(screen.getByRole("row", { name: /Generics/ })).toHaveTextContent("0 (0%)");
  });
});
