import { Goal } from "../models/Goal";
import { Account } from "../models/Account";
import { Holding } from "../models/Holding";
import { computeAllBalances } from "./balanceService";
import { HttpError } from "../middleware/errorHandler";

/**
 * When a goal has just crossed (or fallen back below) its target, return the
 * achievedAt date it should carry: keep an existing stamp, set `now` the moment
 * saved first reaches the target, or clear it if saved drops back under.
 * Pure — the single source of truth for goal "completion" across every path
 * (manual contribute, direct edit, and transaction/recurring-driven contributions).
 */
export function nextAchievedAt(
  savedAmount: number,
  targetAmount: number,
  current: Date | null,
  now: Date
): Date | null {
  if (targetAmount > 0 && savedAmount >= targetAmount) return current ?? now;
  return null; // no target, or dropped back below it
}

export interface GoalState {
  savedAmount: number;
  targetAmount: number;
  achievedAt: Date | null;
}

/**
 * Apply a `delta` (negative to withdraw) to a goal's saved total. savedAmount is
 * clamped at ≥ 0 and achievedAt is kept in step. Returns the new state plus the
 * ACTUAL applied delta (post-clamp) — so a linked transaction can store exactly
 * what was applied and reverse it precisely later. Pure and DB-free.
 */
export function applyContribution(
  state: GoalState,
  delta: number,
  now: Date
): { savedAmount: number; achievedAt: Date | null; applied: number } {
  const before = state.savedAmount;
  const savedAmount = Math.max(0, before + delta);
  return {
    savedAmount,
    achievedAt: nextAchievedAt(savedAmount, state.targetAmount, state.achievedAt, now),
    applied: savedAmount - before,
  };
}

/**
 * Add `amount` to a goal's saved total (a positive contribution, or negative to
 * correct/withdraw), persisting savedAmount + achievedAt. Returns the amount
 * actually applied so the caller can record it for an exact reversal; a no-op
 * (missing goal / zero amount) returns 0.
 */
export async function applyGoalContribution(
  goalId: unknown,
  userId: unknown,
  amount: number,
  now: Date = new Date()
): Promise<number> {
  if (!goalId || !amount) return 0;
  const goal = await Goal.findOne({ _id: goalId, user: userId });
  if (!goal) return 0;
  // A goal that tracks a wallet reads its balance directly. Recording a stored
  // contribution as well would count the same money twice — once when it lands
  // in the account and again here. The API refuses these links up front; this is
  // the backstop for a goal that gets linked after a rule was pointed at it.
  if (goal.linkedAccount || goal.linkedHolding) return 0;

  const next = applyContribution(
    { savedAmount: goal.savedAmount ?? 0, targetAmount: goal.targetAmount, achievedAt: goal.achievedAt ?? null },
    amount,
    now
  );
  goal.savedAmount = next.savedAmount;
  goal.achievedAt = next.achievedAt;
  await goal.save();
  return next.applied;
}

/** Reverse a previously-applied contribution: subtract exactly what was applied. */
export async function reverseGoalContribution(
  goalId: unknown,
  userId: unknown,
  applied: number,
  now: Date = new Date()
): Promise<void> {
  if (!goalId || !applied) return;
  await applyGoalContribution(goalId, userId, -applied, now);
}


/** True when this goal's progress comes from an account balance, not a stored total. */
export async function isLinkedGoal(goalId: unknown, userId: unknown): Promise<boolean> {
  if (!goalId) return false;
  const goal = await Goal.findOne({ _id: goalId, user: userId })
    .select("linkedAccount linkedHolding")
    .lean();
  return Boolean(goal?.linkedAccount || goal?.linkedHolding);
}

/**
 * Reject pointing a transaction or a recurring rule at a wallet-tracking goal.
 * Those goals already move with the account, so an explicit contribution on top
 * would double-count; better a clear refusal than silently ignoring the link.
 */
export async function assertGoalTakesContributions(goalId: unknown, userId: unknown): Promise<void> {
  if (await isLinkedGoal(goalId, userId)) {
    throw new HttpError(400, "This goal tracks an account or a deposit", "GOAL_TRACKS_ACCOUNT");
  }
}

/**
 * Validate a goal's account link: the account must exist, belong to the user, and
 * not already be funding a different goal. Returns nothing; throws on a bad link.
 */
export async function assertAccountLinkable(
  accountId: unknown,
  userId: unknown,
  exceptGoalId?: unknown
): Promise<void> {
  if (!accountId) return;
  const account = await Account.findOne({ _id: accountId, user: userId })
    .select("_id type system")
    .lean();
  if (!account) throw new HttpError(404, "Account not found");
  // The app's own ledgers are not a place anyone puts money aside. Savings &
  // Deposits holds the principal of EVERY deposit, so a goal reading it would
  // count the lot as progress toward one target; Stock Investments is the same
  // for lots, and Money Lent / Money Owed are records of other people's debts.
  if (
    account.system ||
    account.type === "securities" ||
    account.type === "deposits" ||
    account.type === "receivable" ||
    account.type === "payable"
  ) {
    throw new HttpError(400, "That account is managed by the app", "ACCOUNT_SYSTEM_MANAGED");
  }
  const clash = await Goal.findOne({
    user: userId,
    linkedAccount: accountId,
    ...(exceptGoalId ? { _id: { $ne: exceptGoalId } } : {}),
  })
    .select("name")
    .lean();
  if (clash) {
    throw new HttpError(409, "That account already funds another goal", "ACCOUNT_ALREADY_LINKED", {
      name: clash.name,
    });
  }
}

/**
 * Validate a goal's deposit link: the deposit must exist, belong to the user,
 * take deposits at all, and not already be feeding a different goal.
 */
export async function assertHoldingLinkable(
  holdingId: unknown,
  userId: unknown,
  exceptGoalId?: unknown
): Promise<void> {
  if (!holdingId) return;
  const holding = await Holding.findOne({ _id: holdingId, user: userId }).select("subtype").lean();
  if (!holding) throw new HttpError(404, "Deposit not found");
  // Stocks and funds are valued from their lots by their own pages; a goal
  // reading one would be reading a market price, not money set aside.
  if (holding.subtype === "stocks" || holding.subtype === "mutual_funds") {
    throw new HttpError(400, "That holding is valued from its lots", "HOLDING_LOT_OWNED");
  }
  const clash = await Goal.findOne({
    user: userId,
    linkedHolding: holdingId,
    ...(exceptGoalId ? { _id: { $ne: exceptGoalId } } : {}),
  })
    .select("name")
    .lean();
  if (clash) {
    throw new HttpError(409, "That deposit already feeds another goal", "HOLDING_ALREADY_LINKED", {
      name: clash.name,
    });
  }
}

/**
 * A goal tracks a wallet or a deposit, never both — two sources would be two
 * answers to the one question the goal exists to answer.
 */
export function assertOneLinkOnly(linkedAccount: unknown, linkedHolding: unknown): void {
  if (linkedAccount && linkedHolding) {
    throw new HttpError(
      400,
      "A goal can track an account or a deposit, not both",
      "GOAL_TWO_LINKS"
    );
  }
}

/** The account id behind a link, whether it arrives raw or already populated. */
function accountIdOf(link: unknown): string {
  if (!link) return "";
  if (typeof link === "object" && link !== null && "_id" in link) {
    return String((link as { _id: unknown })._id);
  }
  return String(link);
}

/**
 * Swap in live balances for every goal that tracks an account. Costs one balance
 * aggregation for the whole list, and only when at least one goal is linked.
 */
export async function withLinkedBalances<
  T extends { savedAmount?: number; linkedAccount?: unknown; linkedHolding?: unknown },
>(goals: T[], userId: string): Promise<T[]> {
  const anyAccount = goals.some((g) => g.linkedAccount);
  const anyHolding = goals.some((g) => g.linkedHolding);
  if (!anyAccount && !anyHolding) return goals;

  // One aggregation and one query for the whole list, and only for the kind of
  // link that's actually present.
  const balances = anyAccount ? await computeAllBalances(userId) : null;
  const holdings = anyHolding ? await holdingValues(userId) : null;

  return goals.map((g) => {
    if (g.linkedAccount) {
      return { ...g, savedAmount: Math.max(0, balances?.get(accountIdOf(g.linkedAccount))?.balance ?? 0) };
    }
    if (g.linkedHolding) {
      // What the deposit holds is the progress: pay an instalment and the goal
      // advances, take money out and it falls back — exactly as a wallet does.
      return { ...g, savedAmount: Math.max(0, holdings?.get(accountIdOf(g.linkedHolding)) ?? 0) };
    }
    return g;
  });
}

/** Every deposit's current value, keyed by id. */
async function holdingValues(userId: string): Promise<Map<string, number>> {
  const rows = await Holding.find({ user: userId }).select("value").lean();
  return new Map(rows.map((h) => [String(h._id), h.value ?? 0]));
}

/** The live value behind a deposit-tracking goal (0 when it tracks nothing). */
export async function linkedHoldingValue(linkedHolding: unknown, userId: string): Promise<number> {
  if (!linkedHolding) return 0;
  const holding = await Holding.findOne({ _id: accountIdOf(linkedHolding), user: userId })
    .select("value")
    .lean();
  return Math.max(0, holding?.value ?? 0);
}

/** The live balance behind one linked goal (0 when it tracks nothing). */
export async function linkedBalance(linkedAccount: unknown, userId: string): Promise<number> {
  if (!linkedAccount) return 0;
  const balances = await computeAllBalances(userId);
  return Math.max(0, balances.get(accountIdOf(linkedAccount))?.balance ?? 0);
}
