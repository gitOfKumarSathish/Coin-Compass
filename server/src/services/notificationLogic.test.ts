import { describe, it, expect } from "vitest";
import {
  ruleTitle,
  classifyDue,
  isBudgetOver,
  monthKey,
  postedDedupeKey,
  endedDedupeKey,
  dueDedupeKey,
  budgetDedupeKey,
  balanceDedupeKey,
  isDepositMatured,
} from "./notificationLogic";

describe("notificationLogic.ruleTitle", () => {
  it("prefers payee, then note, then a fallback", () => {
    expect(ruleTitle({ payee: "Landlord", note: "rent" })).toBe("Landlord");
    expect(ruleTitle({ payee: "", note: "rent" })).toBe("rent");
    expect(ruleTitle({ payee: null, note: null })).toBe("Recurring");
    expect(ruleTitle({ payee: "  ", note: "  " })).toBe("Recurring");
  });
});

describe("notificationLogic.classifyDue", () => {
  const now = new Date(2026, 6, 4);
  it("is overdue when the run date is in the past", () => {
    expect(classifyDue(new Date(2026, 6, 1), now)).toBe("overdue");
  });
  it("is due_soon when the run date is now or upcoming", () => {
    expect(classifyDue(new Date(2026, 6, 6), now)).toBe("due_soon");
    expect(classifyDue(now, now)).toBe("due_soon");
  });
});

describe("notificationLogic.isBudgetOver", () => {
  it("is true only when spend passes the limit", () => {
    expect(isBudgetOver(101, 100)).toBe(true);
    expect(isBudgetOver(100, 100)).toBe(false);
    expect(isBudgetOver(50, 100)).toBe(false);
  });
});

describe("notificationLogic dedupe keys", () => {
  const id = "abc123";
  const d = new Date("2026-07-04T00:00:00.000Z");

  it("are stable for the same inputs and vary by input", () => {
    expect(postedDedupeKey(id, d)).toBe(postedDedupeKey(id, d));
    expect(postedDedupeKey(id, d)).not.toBe(postedDedupeKey("other", d));
    expect(endedDedupeKey(id)).toBe("recurring.ended:abc123");
    expect(dueDedupeKey("overdue", id, d)).not.toBe(dueDedupeKey("due_soon", id, d));
    expect(budgetDedupeKey(id, d)).toContain("budget.exceeded:abc123:");
  });

  it("keys the low-balance alert to a monthly bucket", () => {
    expect(monthKey(d)).toBe("2026-07");
    expect(balanceDedupeKey(id, d)).toBe("balance.low:abc123:2026-07");
  });
});

describe("a deposit that has finished", () => {
  const now = new Date("2026-09-06T10:00:00Z");

  it("is done once its maturity date arrives", () => {
    expect(isDepositMatured({ maturityDate: new Date("2026-09-05") }, 0, now)).toBe(true);
    expect(isDepositMatured({ maturityDate: new Date("2026-09-07") }, 0, now)).toBe(false);
    // The day itself counts: a deposit maturing today has matured.
    expect(isDepositMatured({ maturityDate: new Date("2026-09-06T09:00:00Z") }, 0, now)).toBe(true);
  });

  it("is done once the last instalment is paid, date or no date", () => {
    // A recurring deposit may never have been given a maturity date — the term
    // is what it agreed to, so the term is what finishes it.
    expect(isDepositMatured({ termCount: 12 }, 12, now)).toBe(true);
    expect(isDepositMatured({ termCount: 12 }, 11, now)).toBe(false);
    expect(isDepositMatured({ termCount: 12 }, 13, now)).toBe(true);
  });

  it("needs one of the two, not both", () => {
    // An open-ended pot with neither a date nor a term never "matures".
    expect(isDepositMatured({}, 500, now)).toBe(false);
    expect(isDepositMatured({ maturityDate: null, termCount: null }, 9, now)).toBe(false);
    // A term served counts even though the date is still ahead.
    expect(isDepositMatured({ maturityDate: new Date("2027-01-01"), termCount: 6 }, 6, now)).toBe(true);
  });

  it("treats a term of zero as no term", () => {
    expect(isDepositMatured({ termCount: 0 }, 0, now)).toBe(false);
  });
});
