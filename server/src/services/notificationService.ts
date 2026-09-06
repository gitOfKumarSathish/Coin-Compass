import { Types } from "mongoose";
import { Notification, type NotificationDoc, NOTIFICATION_TYPES } from "../models/Notification";
import { RecurringTransaction } from "../models/RecurringTransaction";
import { Budget } from "../models/Budget";
import { Account } from "../models/Account";
import { Goal } from "../models/Goal";
import { Holding } from "../models/Holding";
import { Transaction } from "../models/Transaction";
import { getSpentForCategory } from "./reportService";
import { computeAllBalances } from "./balanceService";
import { fundingByGoal, projectionFor, rollDueGoalCycles } from "./goalCycleService";
import { withLinkedBalances } from "./goalService";
import { resolvePeriod, addDays, startOfDay, type Period } from "../utils/dateRange";
import {
  DUE_SOON_DAYS,
  ruleTitle,
  classifyDue,
  isBudgetOver,
  dueDedupeKey,
  budgetDedupeKey,
  balanceDedupeKey,
  goalAchievedDedupeKey,
  goalBehindDedupeKey,
  goalCycleDedupeKey,
  depositMaturedDedupeKey,
  isDepositMatured,
  monthKey,
} from "./notificationLogic";

type NotificationType = (typeof NOTIFICATION_TYPES)[number];

type NotifyInput = {
  user: unknown;
  type: NotificationType;
  params?: Record<string, unknown>;
  link?: string | null;
  recurring?: unknown;
  dedupeKey?: string | null;
};

/**
 * Create a notification. When `dedupeKey` is set, upsert on (user, dedupeKey) so
 * a repeated sweep never creates a second copy of the same reminder; without a
 * key, a plain insert (the caller guarantees uniqueness). Returns true if a new
 * row was actually inserted.
 */
export async function notify(input: NotifyInput): Promise<boolean> {
  const { user, type, params = {}, link = null, recurring = null, dedupeKey = null } = input;
  if (dedupeKey) {
    const res = await Notification.updateOne(
      { user, dedupeKey },
      { $setOnInsert: { user, type, params, link, recurring, dedupeKey, read: false } },
      { upsert: true }
    );
    return Boolean(res.upsertedCount);
  }
  await Notification.create({ user, type, params, link, recurring });
  return true;
}

const periodMap: Record<string, Period> = { weekly: "week", monthly: "month", yearly: "year" };

/** Extract a category id string whether it's a raw ObjectId or a populated doc. */
function categoryIdOf(cat: unknown): string | null {
  if (!cat) return null;
  if (typeof cat === "object" && cat !== null && "_id" in cat) return String((cat as { _id: unknown })._id);
  return String(cat);
}

function categoryNameOf(cat: unknown): string | null {
  if (cat && typeof cat === "object" && "name" in cat) return String((cat as { name: unknown }).name);
  return null;
}

/**
 * Scan every user's active rules, budgets and account balances and create the
 * reminder/alert notifications (recurring due-soon/overdue, budget exceeded, low
 * balance). Idempotent via dedupe keys, so it's safe to run on boot and daily.
 * Returns the number of new notifications created.
 */
export async function runNotificationSweep(now: Date = new Date()): Promise<number> {
  let created = 0;
  created += await sweepRecurringDue(now);
  created += await sweepBudgets(now);
  created += await sweepBalances(now);
  created += await sweepGoals(now);
  created += await sweepMaturedDeposits(now);
  return created;
}

/**
 * Repeating goals: roll any whose due date has arrived (a yearly insurance fund
 * starts its next year the day the premium is due), and warn about goals that
 * won't reach their target date at the rate they're actually being funded.
 */
async function sweepGoals(now: Date): Promise<number> {
  let created = 0;

  for (const { goal, cycles } of await rollDueGoalCycles(now)) {
    try {
      const inserted = await notify({
        user: goal.user,
        type: "goal.cycle_rolled",
        params: {
          name: goal.name,
          amount: goal.targetAmount,
          currency: goal.currency,
          count: cycles,
          date: goal.targetDate?.toISOString() ?? null,
        },
        link: "/goals",
        dedupeKey: goalCycleDedupeKey(String(goal._id), goal.cycleCount ?? 1),
      });
      if (inserted) created += 1;
    } catch (e) {
      console.error("[notify] goal cycle notice failed for goal", String(goal._id), e);
    }
  }

  const userIds: Types.ObjectId[] = await Goal.distinct("user");
  for (const uid of userIds) {
    try {
      const goals = await withLinkedBalances(
        await Goal.find({ user: uid, targetDate: { $ne: null } }).lean(),
        String(uid)
      );
      const funding = await fundingByGoal(goals, String(uid));
      for (const goal of goals) {
        const projection = projectionFor(
          {
            savedAmount: goal.savedAmount ?? 0,
            targetAmount: goal.targetAmount,
            targetDate: goal.targetDate,
            monthlyContribution: goal.monthlyContribution ?? 0,
          },
          funding.get(String(goal._id)),
          now
        );
        // Arriving is worth saying. The app already says when you're falling
        // behind and said nothing at all when you got there.
        if ((goal.savedAmount ?? 0) >= goal.targetAmount && goal.targetAmount > 0) {
          const hit = await notify({
            user: uid,
            type: "goal.achieved",
            params: { name: goal.name, amount: goal.targetAmount, currency: goal.currency },
            link: "/goals",
            dedupeKey: goalAchievedDedupeKey(String(goal._id)),
          });
          if (hit) created += 1;
          continue;
        }

        if (projection.schedule !== "behind") continue;
        const inserted = await notify({
          user: uid,
          type: "goal.behind",
          params: {
            name: goal.name,
            amount: projection.fundedMonthly,
            currency: goal.currency,
            date: goal.targetDate?.toISOString() ?? null,
            projected: projection.projectedDate,
          },
          link: "/goals",
          dedupeKey: goalBehindDedupeKey(String(goal._id), monthKey(now)),
        });
        if (inserted) created += 1;
      }
    } catch (e) {
      console.error("[notify] goal sweep failed for user", String(uid), e);
    }
  }
  return created;
}

/** Reminders for active rules that are overdue or coming due within the window. */
async function sweepRecurringDue(now: Date): Promise<number> {
  const dueSoonBefore = addDays(now, DUE_SOON_DAYS);
  const rules = await RecurringTransaction.find({
    active: true,
    nextRun: { $lte: dueSoonBefore },
    // Skip rules whose end date already passed but the cron hasn't deactivated yet.
    $or: [{ endDate: null }, { endDate: { $gte: startOfDay(now) } }],
  }).lean();

  let created = 0;
  for (const rule of rules) {
    try {
      const nextRun = new Date(rule.nextRun);
      const kind = classifyDue(nextRun, now);
      const inserted = await notify({
        user: rule.user,
        type: kind === "overdue" ? "recurring.overdue" : "recurring.due_soon",
        params: {
          ruleTitle: ruleTitle(rule),
          amount: rule.amount,
          currency: rule.currency,
          type: rule.type,
          date: nextRun,
        },
        link: "/recurring",
        recurring: rule._id,
        dedupeKey: dueDedupeKey(kind, String(rule._id), nextRun),
      });
      if (inserted) created += 1;
    } catch (e) {
      console.error("[notify] recurring-due failed for rule", String(rule._id), e);
    }
  }
  return created;
}

/** One "budget exceeded" per budget per period once its spend passes the limit. */
async function sweepBudgets(now: Date): Promise<number> {
  const budgets = await Budget.find({}).populate("category", "name").lean();
  let created = 0;
  for (const budget of budgets) {
    try {
      const { start, end } = resolvePeriod(periodMap[budget.period] ?? "month", now);
      const spent = await getSpentForCategory(
        String(budget.user),
        categoryIdOf(budget.category),
        start,
        end
      );
      if (!isBudgetOver(spent, budget.amount)) continue;
      const inserted = await notify({
        user: budget.user,
        type: "budget.exceeded",
        params: {
          category: categoryNameOf(budget.category) ?? "Overall",
          spent,
          amount: budget.amount,
          currency: budget.currency,
        },
        link: "/budgets",
        dedupeKey: budgetDedupeKey(String(budget._id), start),
      });
      if (inserted) created += 1;
    } catch (e) {
      console.error("[notify] budget sweep failed for budget", String(budget._id), e);
    }
  }
  return created;
}

/** Low-balance alert when a non-card account is overdrawn (once per account per month). */
async function sweepBalances(now: Date): Promise<number> {
  const userIds: Types.ObjectId[] = await Account.distinct("user");
  let created = 0;
  for (const uid of userIds) {
    try {
      const balances = await computeAllBalances(String(uid));
      const accounts = await Account.find({ user: uid, archived: false, type: { $ne: "card" } })
        .select("name currency")
        .lean();
      for (const acc of accounts) {
        const balance = balances.get(String(acc._id))?.balance ?? 0;
        if (balance >= 0) continue;
        const inserted = await notify({
          user: uid,
          type: "balance.low",
          params: { account: acc.name, balance, currency: acc.currency },
          link: `/accounts/${String(acc._id)}`,
          dedupeKey: balanceDedupeKey(String(acc._id), now),
        });
        if (inserted) created += 1;
      }
    } catch (e) {
      console.error("[notify] balance sweep failed for user", String(uid), e);
    }
  }
  return created;
}

/**
 * Deposits that have finished, and nobody has been told.
 *
 * This is the one moment in the app where money has to be moved by hand. Every
 * other schedule posts itself; a maturity is the bank crediting an account
 * CoinCompass can't see, so without a nudge an FD that matured last week looks
 * exactly like one maturing in 2029.
 *
 * Only deposits still holding something are worth mentioning — one already paid
 * out sits at zero and needs nothing. Once per deposit, ever: repeating it every
 * night until someone records the payout would just teach them to ignore it.
 */
async function sweepMaturedDeposits(now: Date): Promise<number> {
  const deposits = await Holding.find({
    value: { $gt: 0 },
    $or: [{ maturityDate: { $ne: null, $lte: now } }, { termCount: { $ne: null } }],
  })
    .select("user name value currency maturityDate termCount")
    .lean();

  let created = 0;
  for (const deposit of deposits) {
    try {
      // Instalments actually paid in, which is what serves a term.
      const paidCount = await Transaction.countDocuments({
        user: deposit.user,
        holding: deposit._id,
        holdingContribution: { $gt: 0 },
      });
      if (!isDepositMatured(deposit, paidCount, now)) continue;

      const inserted = await notify({
        user: deposit.user,
        type: "deposit.matured",
        params: { name: deposit.name, amount: deposit.value, currency: deposit.currency },
        link: "/net-worth",
        dedupeKey: depositMaturedDedupeKey(String(deposit._id)),
      });
      if (inserted) created += 1;
    } catch (e) {
      console.error("[notify] deposit maturity sweep failed for", String(deposit._id), e);
    }
  }
  return created;
}

// ---- Management API (used by the notification controller) ----

export async function listNotifications(
  userId: string,
  limit = 50
): Promise<{ items: NotificationDoc[]; unread: number }> {
  const [items, unread] = await Promise.all([
    Notification.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ user: userId, read: false }),
  ]);
  return { items: items as NotificationDoc[], unread };
}

export async function markRead(userId: string, id: string): Promise<boolean> {
  const res = await Notification.updateOne(
    { _id: id, user: userId },
    { $set: { read: true, readAt: new Date() } }
  );
  return res.matchedCount > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const res = await Notification.updateMany(
    { user: userId, read: false },
    { $set: { read: true, readAt: new Date() } }
  );
  return res.modifiedCount;
}

export async function clearOne(userId: string, id: string): Promise<boolean> {
  const res = await Notification.deleteOne({ _id: id, user: userId });
  return res.deletedCount > 0;
}

export async function clearAll(userId: string): Promise<number> {
  const res = await Notification.deleteMany({ user: userId });
  return res.deletedCount;
}
