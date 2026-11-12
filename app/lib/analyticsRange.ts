// Time windows for instructor analytics. Kept free of server imports so the
// analytics display component can use them on the client.

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "all"] as const;

export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = "30d";

export const ANALYTICS_RANGE_DAYS: Record<AnalyticsRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRange, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
};

/** Read a `?range=` value; anything missing or unknown means the default. */
export function parseAnalyticsRange(value: string | null): AnalyticsRange {
  return (
    ANALYTICS_RANGES.find((range) => range === value) ?? DEFAULT_ANALYTICS_RANGE
  );
}
