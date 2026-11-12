import { describe, it, expect } from "vitest";
import { parseAnalyticsRange } from "./analyticsRange";

describe("parseAnalyticsRange", () => {
  it.each(["7d", "30d", "90d", "all"])("accepts %s", (value) => {
    expect(parseAnalyticsRange(value)).toBe(value);
  });

  it.each([null, "", "14d", "ALL", "30"])("falls back to 30d for %j", (value) => {
    expect(parseAnalyticsRange(value)).toBe("30d");
  });
});
