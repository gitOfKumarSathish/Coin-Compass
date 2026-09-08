import { describe, it, expect } from "vitest";
import { projectionFor } from "./goalCycleService";

/**
 * What the app tells you about when a goal will land, and whether that beats the
 * date you set. Getting this wrong is not a wrong number on a chart — it is the
 * app telling someone they are on track for a deposit they are behind on, or
 * calling a deposit late that is running exactly to plan.
 *
 * projectionFor is the pure half of goalCycleService; the query side is covered
 * over HTTP by tests/src/api/goals.spec.ts.
 */

const at = (iso: string) => new Date(`${iso}T00:00:00`);
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The projected date back as a local calendar day, or null. */
const projected = (r: { projectedDate: string | null }) =>
  r.projectedDate ? ymd(new Date(r.projectedDate)) : null;

// Mid-month throughout: a month-end `now` would drag defect B12's setMonth
// overflow (tests/BUGS-FOUND.md) into assertions that aren't about it.
const now = at("2026-09-15");

describe("projectionFor — what is funding the goal", () => {
  it("prefers real recurring rules over the figure the user typed", () => {
    const result = projectionFor(
      { savedAmount: 0, targetAmount: 60_000, monthlyContribution: 1_000 },
      { monthly: 5_000, rules: 2 },
      now
    );
    expect(result.fundedMonthly).toBe(5_000);
    expect(result.fundedByRules).toBe(2);
  });

  it("falls back to the typed contribution when nothing is automated", () => {
    const result = projectionFor(
      { savedAmount: 0, targetAmount: 60_000, monthlyContribution: 1_000 },
      undefined,
      now
    );
    expect(result.fundedMonthly).toBe(1_000);
    expect(result.fundedByRules).toBe(0);
  });

  it("falls back when the rules exist but move no money", () => {
    // A rule paying zero is not funding: it must not shadow the planned figure.
    const result = projectionFor(
      { savedAmount: 0, targetAmount: 60_000, monthlyContribution: 1_000 },
      { monthly: 0, rules: 1 },
      now
    );
    expect(result.fundedMonthly).toBe(1_000);
  });

  it("reports no funding at all as zero, not as a guess", () => {
    const result = projectionFor({ savedAmount: 0, targetAmount: 60_000 }, undefined, now);
    expect(result.fundedMonthly).toBe(0);
    expect(result.projectedDate).toBeNull();
    expect(result.schedule).toBe("unknown");
  });
});

describe("projectionFor — when it lands", () => {
  it("rounds a part month up to a whole instalment", () => {
    // 10,000 left at 3,000 a month is four payments, not three and a third:
    // the goal is not funded until the fourth one arrives.
    const result = projectionFor(
      { savedAmount: 0, targetAmount: 10_000 },
      { monthly: 3_000, rules: 1 },
      now
    );
    expect(projected(result)).toBe("2027-01-15");
  });

  it("counts only what is still missing, not the whole target", () => {
    const result = projectionFor(
      { savedAmount: 7_000, targetAmount: 10_000 },
      { monthly: 3_000, rules: 1 },
      now
    );
    expect(projected(result)).toBe("2026-10-15");
  });

  it("has no date to project once the goal is met", () => {
    const result = projectionFor(
      { savedAmount: 10_000, targetAmount: 10_000, targetDate: at("2027-01-15") },
      { monthly: 3_000, rules: 1 },
      now
    );
    expect(result.projectedDate).toBeNull();
    expect(result.schedule).toBe("unknown");
  });

  it("treats an overshot goal as met rather than projecting backwards", () => {
    const result = projectionFor(
      { savedAmount: 25_000, targetAmount: 10_000 },
      { monthly: 3_000, rules: 1 },
      now
    );
    expect(result.projectedDate).toBeNull();
  });
});

describe("projectionFor — on track or behind", () => {
  it("is on track when the projection lands before the target date", () => {
    const result = projectionFor(
      { savedAmount: 0, targetAmount: 10_000, targetDate: at("2027-06-01") },
      { monthly: 3_000, rules: 1 },
      now
    );
    expect(result.schedule).toBe("on_track");
  });

  it("is behind when the projection overshoots the target date", () => {
    const result = projectionFor(
      { savedAmount: 0, targetAmount: 10_000, targetDate: at("2026-11-01") },
      { monthly: 3_000, rules: 1 },
      now
    );
    expect(result.schedule).toBe("behind");
  });

  it("counts landing exactly on the target date as on track", () => {
    const result = projectionFor(
      { savedAmount: 0, targetAmount: 3_000, targetDate: at("2026-10-15") },
      { monthly: 3_000, rules: 1 },
      now
    );
    expect(projected(result)).toBe("2026-10-15");
    expect(result.schedule).toBe("on_track");
  });

  it("has nothing to be late for without a target date", () => {
    const result = projectionFor(
      { savedAmount: 0, targetAmount: 10_000 },
      { monthly: 3_000, rules: 1 },
      now
    );
    expect(result.schedule).toBe("unknown");
  });

  it("is unknown, not behind, when a dated goal has no funding", () => {
    // Nothing is coming in, so there is no projection to compare — saying
    // "behind" would be a guess dressed as a fact.
    const result = projectionFor(
      { savedAmount: 0, targetAmount: 10_000, targetDate: at("2026-11-01") },
      undefined,
      now
    );
    expect(result.schedule).toBe("unknown");
  });
});

describe("projectionFor — goals that track a deposit", () => {
  it("finishes a deposit-backed goal on its own last instalment", () => {
    // The target IS the instalments added up and the deadline IS the last one,
    // so dividing what's left by a monthly rate compares the plan to itself and
    // lands a month out — "behind" about a deposit running exactly to plan.
    const result = projectionFor(
      {
        savedAmount: 0,
        targetAmount: 120_000,
        targetDate: at("2027-08-15"),
        linkedHolding: "hold-1",
      },
      { monthly: 10_000, rules: 1 },
      now
    );
    expect(projected(result)).toBe("2027-08-15");
    expect(result.schedule).toBe("on_track");
  });

  it("stays on track even when the first instalment is still ahead", () => {
    // The case that used to read "Behind 1 mo": the shortfall needs 12 months
    // from today, which is past the deadline, yet the deposit is fine.
    const result = projectionFor(
      {
        savedAmount: 0,
        targetAmount: 120_000,
        targetDate: at("2027-08-15"),
        linkedHolding: "hold-1",
      },
      { monthly: 10_000, rules: 1 },
      now
    );
    expect(result.schedule).not.toBe("behind");
  });

  it("has no date left once the deposit has matured", () => {
    const result = projectionFor(
      {
        savedAmount: 120_000,
        targetAmount: 120_000,
        targetDate: at("2027-08-15"),
        linkedHolding: "hold-1",
      },
      { monthly: 10_000, rules: 1 },
      now
    );
    expect(result.projectedDate).toBeNull();
  });

  it("projects normally when a linked goal has no deadline of its own", () => {
    const result = projectionFor(
      { savedAmount: 0, targetAmount: 10_000, linkedHolding: "hold-1" },
      { monthly: 3_000, rules: 1 },
      now
    );
    expect(projected(result)).toBe("2027-01-15");
  });
});
