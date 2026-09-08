import type { Types } from "mongoose";
import { Transaction } from "../models/Transaction";
import { Split } from "../models/Split";
import { Credit } from "../models/Credit";
import { Person } from "../models/Person";
import { HttpError } from "../middleware/errorHandler";
import {
  createCredit,
  deleteCredit,
  ledgerKey,
  allocateOutstanding,
  type AllocatableEntry,
} from "./creditService";

/**
 * Half a paisa — the tolerance for "these shares add up". Mirrors the client's
 * SETTLED_EPSILON (client/src/lib/credits.ts): summing decimal amounts leaves
 * float dust like 1e-10, and a bare `!==` would reject a perfectly valid split.
 */
export const SPLIT_EPSILON = 0.005;

/**
 * Divide a bill into `n` equal shares that sum EXACTLY back to the total.
 *
 * Done in integer paise, because 1000/3 in floats gives 333.33333… and three of
 * those sum to 999.99999…, leaving a phantom fraction of a rupee sitting in the
 * "Money Lent" receivable forever. The indivisible remainder is handed out one
 * paisa at a time from the FIRST share down, so the payer's own share (always
 * index 0 by convention in createSplit) absorbs the rounding rather than a
 * friend being asked for an extra paisa.
 *
 *   splitEqually(3000, 6) -> [500, 500, 500, 500, 500, 500]
 *   splitEqually(1000, 3) -> [333.34, 333.33, 333.33]   (sums to exactly 1000)
 *   splitEqually(0.05, 2) -> [0.03, 0.02]
 */
export function splitEqually(total: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new HttpError(400, "A split needs at least one share");
  }
  if (!(total >= 0)) {
    throw new HttpError(400, "Split total must be zero or more");
  }
  const totalPaise = Math.round(total * 100);
  const base = Math.floor(totalPaise / n);
  const remainder = totalPaise - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100);
}

/**
 * THE RULE, as a pure function: a split conserves money. Your share plus every
 * participant's share must equal the bill exactly — otherwise the ledger legs
 * we post (an expense for your share + a transfer for theirs) would not add up
 * to what actually left your account, and the "Money Lent" receivable would
 * drift away from what people really owe you.
 *
 * Throws rather than returning a boolean so every caller fails loudly; the
 * shares come from a UI where the user can type any number.
 */
/**
 * Validation for a bill SOMEONE ELSE paid. Conservation doesn't apply: you only
 * know the bill and your own share of it — who else was there, and what they
 * each owe the payer, is none of your ledger's business.
 */
export function validateBorrowedShare(total: number, yourShare: number): void {
  if (!(total > 0)) throw new HttpError(400, "Split total must be greater than 0");
  if (yourShare < 0) throw new HttpError(400, "Split shares cannot be negative");
  if (yourShare > total + SPLIT_EPSILON) {
    throw new HttpError(400, "Your share can't be more than the bill");
  }
}

export function validateShares(total: number, yourShare: number, participantShares: number[]): void {
  if (!(total > 0)) {
    throw new HttpError(400, "Split total must be greater than 0");
  }
  if (!participantShares.length) {
    throw new HttpError(400, "Add at least one person to split with");
  }
  if (yourShare < 0 || participantShares.some((s) => s < 0)) {
    throw new HttpError(400, "Split shares cannot be negative");
  }
  const sum = participantShares.reduce((a, b) => a + b, yourShare);
  if (Math.abs(sum - total) > SPLIT_EPSILON) {
    throw new HttpError(400, "Split shares must add up to the total");
  }
}

export interface SplitParticipantInput {
  /** Display name — find-or-creates a Person when no `personId` is given. */
  person: string;
  /** An existing Person, sent when one is picked from the list. */
  personId?: string | null;
  amount: number;
}

export interface SplitInput {
  description: string;
  totalAmount: number;
  yourShare: number;
  date: Date;
  /** The account that paid. Not needed when someone else paid the bill. */
  account?: string | null;
  category?: string | null;
  method?: string;
  note?: string;
  participants: SplitParticipantInput[];
  /** Set when a FRIEND paid the bill — their name. You then owe them your share. */
  paidBy?: string | null;
  /** The Person behind `paidBy`, when picked from the list. */
  paidById?: string | null;
}

/**
 * Post the ledger legs for a split bill:
 *
 *   • YOUR share      → a normal EXPENSE in the chosen category. This is the
 *                       only leg that ever reaches a budget or a spend report —
 *                       the whole point of the feature (₹500 of KFC, not ₹3,000).
 *   • THEIR shares    → one reflected "given" Credit each, which creates a
 *                       TRANSFER from your account into the auto-managed
 *                       "Money Lent" receivable (see creditService). Never an
 *                       expense, never income; your net worth only drops by
 *                       what you actually consumed.
 *
 * Together the legs move exactly `totalAmount` out of the paying account.
 *
 * Each participant gets their OWN credit (rather than the split sharing one
 * combined transfer) so that settling up, editing and deleting a single person
 * keep flowing through the already-tested creditService paths — including
 * splitRepayment's rule that a repayment is a transfer BACK, not income.
 */
async function postLegs(uid: unknown, split: any, data: SplitInput): Promise<void> {
  // SOMEONE ELSE PAID. Nothing left your accounts, so there is no expense from
  // your bank and nobody owes you: you owe THEM your share. One reflected
  // `borrowed` credit carries both halves — a real categorised expense funded by
  // "Money Owed" — which is what stops a friend's generosity reading as income.
  if (data.paidBy?.trim()) {
    if (data.yourShare > 0) {
      await createCredit(uid, {
        person: data.paidBy.trim(),
        personId: data.paidById,
        direction: "borrowed",
        amount: data.yourShare,
        date: data.date,
        method: data.method,
        account: null,
        category: data.category ?? null,
        note: `${data.description} (their treat, your share)`,
        reflected: true,
        split: split._id,
      });
    }
    return;
  }

  if (data.yourShare > 0) {
    const txn = await Transaction.create({
      user: uid,
      type: "expense",
      amount: data.yourShare,
      account: data.account,
      toAccount: null,
      category: data.category ?? null,
      date: data.date,
      note: data.note || data.description,
      payee: data.description,
      split: split._id,
    });
    split.expenseTransaction = txn._id;
  }

  for (const p of data.participants) {
    if (!(p.amount > 0)) continue; // a zero share is someone who owes nothing
    await createCredit(uid, {
      person: p.person,
      personId: p.personId,
      direction: "given",
      amount: p.amount,
      date: data.date,
      method: data.method,
      account: data.account,
      note: `${data.description} (split)`,
      reflected: true,
      split: split._id,
    });
  }
}

/** Remove every ledger leg a split posted: its expense and all participant credits. */
async function clearLegs(uid: unknown, split: any): Promise<void> {
  const credits = await Credit.find({ user: uid, split: split._id }).select("_id").lean();
  for (const c of credits) await deleteCredit(uid, c._id);
  if (split.expenseTransaction) {
    await Transaction.deleteMany({ _id: split.expenseTransaction, user: uid });
    split.expenseTransaction = null;
  }
}

/** Create a split bill and post all of its ledger legs. */
export async function createSplit(uid: unknown, data: SplitInput) {
  if (data.paidBy?.trim()) validateBorrowedShare(data.totalAmount, data.yourShare);
  else {
    if (!data.account) throw new HttpError(400, "Pick the account that paid");
    validateShares(data.totalAmount, data.yourShare, data.participants.map((p) => p.amount));
  }

  const split = await Split.create({
    user: uid,
    description: data.description,
    totalAmount: data.totalAmount,
    yourShare: data.yourShare,
    date: data.date,
    account: data.account ?? null,
    category: data.category ?? null,
    method: data.method ?? "",
    note: data.note ?? "",
    paidBy: data.paidBy?.trim() ?? "",
    expenseTransaction: null,
  });

  await postLegs(uid, split, data);
  await split.save();
  return split;
}

/**
 * Update a split by tearing every leg down and re-posting from scratch, the same
 * strategy creditService uses for reflections. Diffing participants against the
 * existing credits would have to reason about part-settled people; a rebuild is
 * both simpler and provably consistent.
 *
 * Settlements are NOT rebuilt: a participant's repayment is a separate credit
 * with no `split`, so it survives and still nets against the new share.
 */
export async function updateSplit(uid: unknown, splitId: unknown, data: SplitInput) {
  const split = await Split.findOne({ _id: splitId, user: uid });
  if (!split) return null;

  if (data.paidBy?.trim()) validateBorrowedShare(data.totalAmount, data.yourShare);
  else {
    if (!data.account) throw new HttpError(400, "Pick the account that paid");
    validateShares(data.totalAmount, data.yourShare, data.participants.map((p) => p.amount));
  }

  await clearLegs(uid, split);
  Object.assign(split, {
    description: data.description,
    totalAmount: data.totalAmount,
    yourShare: data.yourShare,
    date: data.date,
    account: data.account ?? null,
    category: data.category ?? null,
    method: data.method ?? "",
    note: data.note ?? "",
    paidBy: data.paidBy?.trim() ?? "",
  });
  await postLegs(uid, split, data);
  await split.save();
  return split;
}

/** Delete a split and every leg it posted. */
export async function deleteSplit(uid: unknown, splitId: unknown): Promise<boolean> {
  const split = await Split.findOne({ _id: splitId, user: uid });
  if (!split) return false;
  await clearLegs(uid, split);
  await Split.deleteOne({ _id: split._id, user: uid });
  return true;
}

/**
 * The split a transaction belongs to — whether it's the expense leg carrying your
 * share (`Transaction.split`) or one of the participants' transfer legs, which
 * reach the split through their credit (`Credit.split`). Null when neither.
 */
export async function splitIdForTransaction(
  uid: unknown,
  txn: { split?: unknown; credit?: unknown }
): Promise<unknown | null> {
  if (txn.split) return txn.split;
  if (!txn.credit) return null;
  const credit = await Credit.findOne({ _id: txn.credit, user: uid }).select("split").lean();
  return credit?.split ?? null;
}

/**
 * Dissolve a split's GROUPING without touching a rupee: the expense and the
 * participants' credits survive as ordinary standalone records, and only the
 * Split header goes away.
 *
 * This is what editing or deleting a single leg from the Transactions page does.
 * A split's whole promise is that your share plus everyone else's equals the
 * bill; once one leg is changed on its own that can no longer hold, so the
 * grouping has to go. Deleting the individual legs instead would destroy entries
 * the user never asked to lose — the full teardown is reserved for DELETE
 * /splits/:id, where the UI shows exactly what's about to be removed.
 * Mirrors unlinkCreditTransaction in creditService.
 */
export async function unlinkSplitForTransaction(uid: unknown, splitId: unknown): Promise<void> {
  await Credit.updateMany({ user: uid, split: splitId }, { $set: { split: null } });
  await Transaction.updateMany({ user: uid, split: splitId }, { $set: { split: null } });
  await Split.deleteOne({ _id: splitId, user: uid });
}

/**
 * The half of participant resolution that has nothing to do with which split you
 * are looking at: the whole ledger allocated per person, plus the person index.
 *
 * It lives on its own because listSplits needs it exactly once. Resolving it
 * per split meant re-reading every credit and every person the user owns for
 * each bill on the page, so a ledger that grew made a list of N splits cost
 * N full scans of it.
 */
async function loadLedgerContext(uid: unknown) {
  const [all, people] = await Promise.all([
    Credit.find({ user: uid }).select("person personRef direction amount date settles").lean(),
    Person.find({ user: uid }).select("key name").lean(),
  ]);

  const index = new Map(people.map((p) => [p.key, String(p._id)]));
  const nameById = new Map(people.map((p) => [String(p._id), p.name]));

  /*
   * What's still owed on THIS bill's share — not the person's overall balance.
   *
   * Those are different numbers the moment someone appears on two bills, and
   * conflating them was a real bug: a share that had been settled kept showing a
   * figure borrowed from an unrelated bill, so the row never cleared and the
   * "owed to you" total was overstated.
   *
   * Repayments are allocated per person (a payment only pays down that person's
   * debts), then each share reads its own remainder out of the result.
   */
  const byPerson = new Map<string, typeof all>();
  for (const c of all) {
    const key = ledgerKey(c, index);
    const bucket = byPerson.get(key);
    if (bucket) bucket.push(c);
    else byPerson.set(key, [c]);
  }
  const leftByCredit = new Map<string, number>();
  for (const entries of byPerson.values()) {
    for (const [id, left] of allocateOutstanding(entries as AllocatableEntry[])) {
      leftByCredit.set(id, left);
    }
  }

  return { index, nameById, leftByCredit };
}

type LedgerContext = Awaited<ReturnType<typeof loadLedgerContext>>;

/** The credits belonging to one or more splits, in natural order. */
function findSplitCredits(uid: unknown, splitMatch: unknown) {
  return Credit.find({ user: uid, split: splitMatch })
    .select("person personRef amount date split")
    .lean();
}

type SplitCredit = Awaited<ReturnType<typeof findSplitCredits>>[number];

/** Shape one split's credits into participant rows against a resolved ledger. */
function participantsOf(credits: SplitCredit[], ctx: LedgerContext) {
  return credits.map((c) => {
    const key = ledgerKey(c, ctx.index);
    const id = key.startsWith("id:") ? key.slice(3) : null;
    const outstanding = ctx.leftByCredit.get(String(c._id)) ?? 0;
    return {
      // The Person's current name, so a rename reaches past splits too.
      person: (id && ctx.nameById.get(id)) || c.person,
      personId: id,
      amount: c.amount,
      credit: String(c._id),
      outstanding,
      settled: outstanding < SPLIT_EPSILON,
    };
  });
}

/** Participants of a split, resolved from their credits, with what's still owed. */
export async function getSplitParticipants(uid: unknown, splitId: unknown) {
  const [credits, ctx] = await Promise.all([
    findSplitCredits(uid, splitId),
    loadLedgerContext(uid),
  ]);
  return participantsOf(credits, ctx);
}

/** Every split, newest first, with participants and settlement state attached. */
export async function listSplits(uid: unknown) {
  const splits = await Split.find({ user: uid })
    .sort({ date: -1, createdAt: -1 })
    .populate({ path: "account", select: "name color icon currency" })
    .populate({ path: "category", select: "name color icon" })
    .lean();
  if (splits.length === 0) return [];

  // Three queries for the whole page, however many splits are on it: the ledger
  // once, and every split's credits in one pass, grouped here by split.
  const [credits, ctx] = await Promise.all([
    findSplitCredits(uid, { $in: splits.map((s) => s._id) }),
    loadLedgerContext(uid),
  ]);

  const bySplit = new Map<string, SplitCredit[]>();
  for (const c of credits) {
    const key = String(c.split);
    const bucket = bySplit.get(key);
    if (bucket) bucket.push(c);
    else bySplit.set(key, [c]);
  }

  return splits.map((s) => ({
    ...s,
    participants: participantsOf(bySplit.get(String(s._id)) ?? [], ctx),
  }));
}

/** One split with its participants, or null when it isn't the caller's. */
export async function getSplit(uid: unknown, splitId: unknown) {
  const split = await Split.findOne({ _id: splitId, user: uid })
    .populate({ path: "account", select: "name color icon currency" })
    .populate({ path: "category", select: "name color icon" })
    .lean();
  if (!split) return null;
  return { ...split, participants: await getSplitParticipants(uid, split._id as Types.ObjectId) };
}
