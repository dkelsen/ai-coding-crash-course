import { gte, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

/** ISO timestamp a time window starts at, or null for no lower bound. */
export type WindowStart = string | null;

/** Filter for rows whose `column` falls inside the window; no filter when it is unbounded. */
export function inWindow(column: SQLiteColumn, start: WindowStart): SQL | undefined {
  return start === null ? undefined : gte(column, start);
}
