/**
 * Pure helpers for notification generation — no database access, so they can be
 * unit-tested in isolation (the DB orchestration lives in notificationService).
 */

/** How far ahead (days) an active recurring rule counts as "due soon". */
export const DUE_SOON_DAYS = 3;

/** A short human title for a recurring rule, from its own fields (server has no
 *  category populate here). Mirrors the client's `ruleTitle` fallback order. */
export function ruleTitle(rule: { payee?: string | null; note?: string | null }): string {
  return (rule.payee || "").trim() || (rule.note || "").trim() || "Recurring";
}

/** Classify an upcoming/late occurrence relative to now. */
export function classifyDue(nextRun: Date, now: Date): "overdue" | "due_soon" {
  return nextRun < now ? "overdue" : "due_soon";
}

/** Spend has passed the budget's limit. */
export function isBudgetOver(spent: number, amount: number): boolean {
  return spent > amount;
}

/** `YYYY-MM` bucket used to rate-limit the low-balance alert to once per month. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---- Dedupe keys: stable strings that make each notification idempotent so a
// repeated sweep (or a boot+hourly double cron run) never duplicates a row. ----

export function postedDedupeKey(ruleId: string, lastRun: Date): string {
  return `recurring.posted:${ruleId}:${lastRun.toISOString()}`;
}

export function endedDedupeKey(ruleId: string): string {
  return `recurring.ended:${ruleId}`;
}

export function dueDedupeKey(kind: "due_soon" | "overdue", ruleId: string, nextRun: Date): string {
  return `recurring.${kind}:${ruleId}:${nextRun.toISOString()}`;
}

export function budgetDedupeKey(budgetId: string, periodStart: Date): string {
  return `budget.exceeded:${budgetId}:${periodStart.toISOString()}`;
}

export function balanceDedupeKey(accountId: string, ref: Date): string {
  return `balance.low:${accountId}:${monthKey(ref)}`;
}

/** One notice per cycle a goal closes. */
export function goalCycleDedupeKey(goalId: string, cycleIndex: number): string {
  return `goal.cycle_rolled:${goalId}:${cycleIndex}`;
}

/** Behind-schedule nags are worth at most one a month per goal. */
export function goalBehindDedupeKey(goalId: string, month: string): string {
  return `goal.behind:${goalId}:${month}`;
}

/**
 * One "you reached it" per goal, ever.
 *
 * Not per month like the "behind" nudge: arriving happens once, and a goal that
 * dips back under its target after a withdrawal should not announce itself again
 * on the way back up.
 */
export function goalAchievedDedupeKey(goalId: string): string {
  return `goal.achieved:${goalId}`;
}

/**
 * One "it matured" per deposit, ever. A deposit matures once; repeating the
 * reminder every night until someone records the payout would train them to
 * ignore it, and the card already carries the state in the meantime.
 */
export function depositMaturedDedupeKey(holdingId: string): string {
  return `deposit.matured:${holdingId}`;
}

/**
 * Has this deposit finished?
 *
 * Two ways to be done, and a deposit may have only one of them. A fixed deposit
 * knows a date; a recurring deposit knows a count of instalments and may never
 * have been given a date at all. Either is enough.
 *
 * Pure, so both conditions can be pinned without a database.
 */
export function isDepositMatured(
  deposit: { maturityDate?: Date | null; termCount?: number | null },
  paidCount: number,
  now: Date
): boolean {
  if (deposit.maturityDate && new Date(deposit.maturityDate) <= now) return true;
  return Boolean(deposit.termCount) && paidCount >= (deposit.termCount as number);
}
