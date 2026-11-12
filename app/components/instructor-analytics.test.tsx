import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { InstructorAnalytics } from "./instructor-analytics";
import type { InstructorAnalytics as InstructorAnalyticsData } from "~/services/analyticsService";
import type { AnalyticsRange } from "~/lib/analyticsRange";

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
    renderAnalytics({ totals: { salesCents: 10000, earningsCents: 8000 } });

    expect(screen.getByText("Sales").parentElement).toHaveTextContent("$100.00");
    expect(screen.getByText("Earnings").parentElement).toHaveTextContent("$80.00");
  });

  it("shows zeros for a period with no sales", () => {
    renderAnalytics({ totals: { salesCents: 0, earningsCents: 0 } });

    expect(screen.getByText("Sales").parentElement).toHaveTextContent("$0.00");
    expect(screen.getByText("Earnings").parentElement).toHaveTextContent("$0.00");
  });

  it("separates thousands", () => {
    renderAnalytics({ totals: { salesCents: 123456789, earningsCents: 98765431 } });

    expect(screen.getByText("Sales").parentElement).toHaveTextContent("$1,234,567.89");
  });

  it("writes the chosen range to the URL", async () => {
    function CurrentSearch() {
      return <output data-testid="search">{useLocation().search}</output>;
    }
    render(
      <MemoryRouter initialEntries={["/dashboard?range=30d"]}>
        <InstructorAnalytics
          analytics={{ totals: { salesCents: 0, earningsCents: 0 } }}
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
    renderAnalytics({ totals: { salesCents: 0, earningsCents: 0 } }, range);

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
});
