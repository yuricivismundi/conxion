/**
 * Unit tests for the bidirectional city matching logic used across
 * all 4 tabs (Dancers, Travelers, Events, Teachers) in /connections.
 */
import { describe, expect, it } from "vitest";

// Extracted from connections/page.tsx city matching logic
function cityMatches(itemCity: string | null | undefined, query: string): boolean {
  if (!query) return true;
  if (!itemCity) return false;
  const c = itemCity.toLowerCase();
  const q = query.toLowerCase();
  return c.includes(q) || q.includes(c);
}

describe("cityMatches — bidirectional includes", () => {
  it("returns true when query is empty (no filter)", () => {
    expect(cityMatches("Barcelona", "")).toBe(true);
    expect(cityMatches(null, "")).toBe(true);
  });

  it("returns false when city is null and query is non-empty", () => {
    expect(cityMatches(null, "barcelona")).toBe(false);
    expect(cityMatches(undefined, "paris")).toBe(false);
  });

  it("exact match (case insensitive)", () => {
    expect(cityMatches("Barcelona", "barcelona")).toBe(true);
    expect(cityMatches("PARIS", "paris")).toBe(true);
  });

  it("city contains query (partial city search)", () => {
    expect(cityMatches("Buenos Aires", "buenos")).toBe(true);
    expect(cityMatches("Mexico City", "mexico")).toBe(true);
  });

  it("query contains city (typed full city name, city is partial)", () => {
    // e.g. city stored as "Berlin" and user typed "Berlin, Germany"
    expect(cityMatches("Berlin", "berlin, germany")).toBe(true);
  });

  it("no match when completely different cities", () => {
    expect(cityMatches("Madrid", "lisbon")).toBe(false);
    expect(cityMatches("Amsterdam", "tallinn")).toBe(false);
  });

  it("handles accented city names", () => {
    expect(cityMatches("Medellín", "medell")).toBe(true);
  });

  it("short query does not match unrelated city", () => {
    expect(cityMatches("Berlin", "la")).toBe(false);
    expect(cityMatches("Tallinn", "par")).toBe(false);
  });

  it("partial prefix matches correctly", () => {
    // "los" is contained in "los angeles"
    expect(cityMatches("Los Angeles", "los")).toBe(true);
    expect(cityMatches("Los Angeles", "angeles")).toBe(true);
  });
});

// ── event date filter helpers ──────────────────────────────────────────────
// Replicates resolveEventDateRange from connections/page.tsx

type DateRange = { from: Date; to: Date };

function resolveEventDateRange(
  preset: string,
  customFrom?: string,
  customTo?: string
): DateRange | null {
  const now = new Date();
  if (preset === "today") {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    return { from: start, to: end };
  }
  if (preset === "this_week") {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(end.getDate() + (7 - end.getDay()));
    end.setHours(23, 59, 59, 999);
    return { from: start, to: end };
  }
  if (preset === "this_month") {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { from: start, to: end };
  }
  if (preset === "custom") {
    if (!customFrom || !customTo) return null;
    return { from: new Date(customFrom), to: new Date(customTo) };
  }
  return null; // "all" or unknown
}

describe("resolveEventDateRange", () => {
  it("returns null for 'all' preset", () => {
    expect(resolveEventDateRange("all")).toBeNull();
  });

  it("returns null for unknown preset", () => {
    expect(resolveEventDateRange("next_year")).toBeNull();
  });

  it("today range: from < to, both same day", () => {
    const range = resolveEventDateRange("today")!;
    expect(range).not.toBeNull();
    expect(range.from.toDateString()).toBe(range.to.toDateString());
    expect(range.from.getHours()).toBe(0);
    expect(range.to.getHours()).toBe(23);
  });

  it("this_week range: from <= to, span <= 7 days", () => {
    const range = resolveEventDateRange("this_week")!;
    expect(range).not.toBeNull();
    const diffDays = (range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeLessThanOrEqual(7);
    expect(range.from <= range.to).toBe(true);
  });

  it("this_month range: ends on last day of current month", () => {
    const range = resolveEventDateRange("this_month")!;
    expect(range).not.toBeNull();
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    expect(range.to.getDate()).toBe(lastDay);
  });

  it("custom preset with valid dates returns correct range", () => {
    const range = resolveEventDateRange("custom", "2025-01-01", "2025-01-31")!;
    expect(range).not.toBeNull();
    expect(range.from.getFullYear()).toBe(2025);
    expect(range.to.getMonth()).toBe(0); // January
  });

  it("custom preset without dates returns null", () => {
    expect(resolveEventDateRange("custom")).toBeNull();
    expect(resolveEventDateRange("custom", "2025-01-01")).toBeNull();
  });
});
