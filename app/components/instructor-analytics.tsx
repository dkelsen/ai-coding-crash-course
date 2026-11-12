import { useSearchParams } from "react-router";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  ANALYTICS_RANGES,
  ANALYTICS_RANGE_LABELS,
  parseAnalyticsRange,
  type AnalyticsRange,
} from "~/lib/analyticsRange";
import type { InstructorAnalytics as InstructorAnalyticsData } from "~/services/analyticsService";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

/** Displays instructor analytics. Holds no data of its own; the filter writes `?range=`. */
export function InstructorAnalytics({
  analytics,
  range,
}: {
  analytics: InstructorAnalyticsData;
  range: AnalyticsRange;
}) {
  const [, setSearchParams] = useSearchParams();

  function handleRangeChange(value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("range", parseAnalyticsRange(value));
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <Tabs value={range} onValueChange={handleRangeChange}>
        <TabsList aria-label="Time range">
          {ANALYTICS_RANGES.map((option) => (
            <TabsTrigger key={option} value={option}>
              {ANALYTICS_RANGE_LABELS[option]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Sales" value={formatMoney(analytics.totals.salesCents)} />
        <StatCard label="Earnings" value={formatMoney(analytics.totals.earningsCents)} />
      </div>
    </div>
  );
}
