import { describe, it, expect } from "vitest";
import { termEndDate, firstRun, termFromEnd } from "./depositScheduleService";

/**
 * The date arithmetic behind a deposit's schedule. Everything here decides when
 * a recurring deposit stops taking money, so an off-by-one is a real instalment:
 * a thirteenth payment out of an account, or a term that ends a month early and
 * leaves the deposit short of its maturity value.
 *
 * These are the pure functions of depositScheduleService; the query side is
 * covered over HTTP by tests/src/api/deposit-instalments.spec.ts.
 */

/** Local midnight, so the assertions read in the calendar the user is in. */
const at = (iso: string) => new Date(`${iso}T00:00:00`);
/** Local Y-M-D — toISOString would shift the day in any non-UTC zone. */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("termEndDate", () => {
  it("puts the last instalment one interval short of the term", () => {
    // A 12-month RD starting in September pays in September and eleven more
    // times, so the last falls 11 months out — not 12.
    expect(ymd(termEndDate(at("2026-09-15"), "monthly", 1, 12))).toBe("2027-08-15");
  });

  it("ends a single-instalment term on its start date", () => {
    expect(ymd(termEndDate(at("2026-09-15"), "monthly", 1, 1))).toBe("2026-09-15");
  });

  it("treats a zero or negative term as one instalment rather than reaching backwards", () => {
    // Math.max(1, termCount) guards this: an end date before the start would
    // describe a schedule that finishes before it begins.
    expect(ymd(termEndDate(at("2026-09-15"), "monthly", 1, 0))).toBe("2026-09-15");
    expect(ymd(termEndDate(at("2026-09-15"), "monthly", 1, -5))).toBe("2026-09-15");
  });

  it("counts intervals, not periods, on a fortnightly schedule", () => {
    // 12 instalments every 2 weeks = 22 weeks from the first.
    expect(ymd(termEndDate(at("2026-09-15"), "weekly", 2, 12))).toBe("2027-02-16");
  });

  it("handles daily and yearly terms", () => {
    expect(ymd(termEndDate(at("2026-09-15"), "daily", 1, 10))).toBe("2026-09-24");
    expect(ymd(termEndDate(at("2026-06-10"), "yearly", 1, 5))).toBe("2030-06-10");
  });

  it("never ends before it starts, for any term or frequency", () => {
    const start = at("2026-09-15");
    for (const frequency of ["daily", "weekly", "monthly", "yearly"] as const) {
      for (const count of [0, 1, 2, 7, 60, 600]) {
        expect(termEndDate(start, frequency, 1, count).getTime()).toBeGreaterThanOrEqual(
          start.getTime()
        );
      }
    }
  });

  // Known defect B12 (tests/BUGS-FOUND.md): addMonths uses setMonth, which
  // overflows instead of clamping, so "31 January + 1 month" becomes 3 March and
  // every later instalment inherits the drift. An RD opened on the 31st should
  // end on the last day of its final month.
  it.fails("clamps a month-end start to the last valid day of the target month", () => {
    expect(ymd(termEndDate(at("2026-01-31"), "monthly", 1, 3))).toBe("2026-04-30");
    expect(ymd(termEndDate(at("2026-01-31"), "monthly", 1, 12))).toBe("2026-12-31");
  });
});

describe("firstRun", () => {
  const now = at("2026-09-06");

  it("starts today when the start date is today", () => {
    // The comparison is by day, not by timestamp: a date typed as today must not
    // be judged "in the past" merely because midnight has gone.
    expect(ymd(firstRun(at("2026-09-06"), "monthly", 1, now))).toBe("2026-09-06");
  });

  it("keeps a start later in today rather than pushing it a month out", () => {
    const late = new Date("2026-09-06T23:59:00");
    expect(firstRun(late, "monthly", 1, now).getTime()).toBe(late.getTime());
  });

  it("leaves a future start date alone", () => {
    expect(ymd(firstRun(at("2026-12-01"), "monthly", 1, now))).toBe("2026-12-01");
  });

  it("rolls a past start forward instead of firing a burst of catch-up instalments", () => {
    // June 15 with today at September 6: the next occurrence is September 15.
    // Payments already made belong to "Import past payments", not to a new rule.
    expect(ymd(firstRun(at("2026-06-15"), "monthly", 1, now))).toBe("2026-09-15");
  });

  it("never schedules the first instalment before today", () => {
    const midnight = at("2026-09-06");
    for (const start of ["2020-01-01", "2026-06-15", "2026-09-05", "2026-09-06", "2027-01-01"]) {
      expect(firstRun(at(start), "monthly", 1, now).getTime()).toBeGreaterThanOrEqual(
        midnight.getTime()
      );
    }
  });

  it("stays on the schedule's own day when rolling forward", () => {
    // Rolling a past start must land on an actual occurrence, not on "today".
    expect(ymd(firstRun(at("2026-03-20"), "monthly", 1, now))).toBe("2026-09-20");
    expect(ymd(firstRun(at("2026-08-30"), "weekly", 1, now))).toBe("2026-09-06");
  });
});

describe("termFromEnd", () => {
  it("reads back the term that produced the end date", () => {
    // The round trip is the contract: adopting a hand-built rule must recover
    // the term the user already described, or the deposit's progress bar and
    // its maturity date disagree about how many payments there are.
    for (const [frequency, interval] of [
      ["monthly", 1],
      ["monthly", 3],
      ["weekly", 2],
      ["daily", 10],
      ["yearly", 1],
    ] as const) {
      for (const term of [1, 2, 6, 12, 60]) {
        const start = at("2026-09-15");
        const end = termEndDate(start, frequency, interval, term);
        expect(termFromEnd(start, end, frequency, interval)).toBe(term);
      }
    }
  });

  it("counts an end that lands exactly on an occurrence", () => {
    expect(termFromEnd(at("2026-09-15"), at("2026-12-15"), "monthly", 1)).toBe(4);
  });

  it("ignores the tail of a period the schedule never reaches", () => {
    // An end date part-way to the next instalment does not buy another one.
    expect(termFromEnd(at("2026-09-15"), at("2026-12-14"), "monthly", 1)).toBe(3);
  });

  it("is zero when the schedule ends before it starts", () => {
    expect(termFromEnd(at("2026-09-15"), at("2026-08-01"), "monthly", 1)).toBe(0);
  });

  it("stops at the schema ceiling instead of looping forever on a zero interval", () => {
    // A zero interval never advances; the guard is what keeps this terminating.
    expect(termFromEnd(at("2026-09-15"), at("2027-09-15"), "monthly", 0)).toBe(600);
  });
});
