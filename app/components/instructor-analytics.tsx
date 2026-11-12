import { useSearchParams } from "react-router";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { CourseStatus } from "~/db/schema";
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

type PickerCourse = InstructorAnalyticsData["courses"][number];

function courseLabel(course: PickerCourse): string {
  return course.status === CourseStatus.Archived
    ? `${course.title} (Archived)`
    : course.title;
}

/** Displays instructor analytics. Holds no data of its own; the controls write `?range=` and `?course=`. */
export function InstructorAnalytics({
  analytics,
  range,
}: {
  analytics: InstructorAnalyticsData;
  range: AnalyticsRange;
}) {
  const [, setSearchParams] = useSearchParams();

  function setParam(name: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(name, value);
      return next;
    });
  }

  const { selectedCourse, selectedCourseId } = analytics;

  return (
    <div className="space-y-6">
      <Tabs value={range} onValueChange={(value) => setParam("range", parseAnalyticsRange(value))}>
        <TabsList aria-label="Time range">
          {ANALYTICS_RANGES.map((option) => (
            <TabsTrigger key={option} value={option}>
              {ANALYTICS_RANGE_LABELS[option]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Total sales" value={formatMoney(analytics.totals.salesCents)} />
        <StatCard label="Total earnings" value={formatMoney(analytics.totals.earningsCents)} />
      </div>

      {selectedCourse === null || selectedCourseId === null ? (
        <p className="text-muted-foreground">
          Publish a course to see its analytics.
        </p>
      ) : (
        <section className="space-y-4">
          <Select
            value={String(selectedCourseId)}
            onValueChange={(value) => setParam("course", value)}
          >
            <SelectTrigger aria-label="Course" className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {analytics.courses.map((course) => (
                <SelectItem key={course.id} value={String(course.id)}>
                  {courseLabel(course)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Course sales" value={formatMoney(selectedCourse.salesCents)} />
            <StatCard label="Course earnings" value={formatMoney(selectedCourse.earningsCents)} />
          </div>
        </section>
      )}
    </div>
  );
}
