import { describe, it, expect } from "vitest";
import { createVerifiedUser } from "../harness/users";

describe("Goals — CRUD", () => {
  it("creates a goal (201) with progress fields", async () => {
    const u = await createVerifiedUser();
    const res = await u.session.http.post("/goals", { name: "Vacation", targetAmount: 1000 });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ name: "Vacation", targetAmount: 1000, savedAmount: 0 });
    expect(res.data).toMatchObject({ remaining: 1000, percent: 0, complete: false });
  });

  it("lists goals", async () => {
    const u = await createVerifiedUser();
    await u.session.http.post("/goals", { name: "G", targetAmount: 100 });
    const res = await u.session.http.get("/goals");
    expect(res.status).toBe(200);
    expect(res.data.length).toBeGreaterThanOrEqual(1);
  });

  it("updates a goal", async () => {
    const u = await createVerifiedUser();
    const g = (await u.session.http.post("/goals", { name: "Old", targetAmount: 100 })).data;
    const res = await u.session.http.patch(`/goals/${g._id}`, { name: "New", targetAmount: 250 });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ name: "New", targetAmount: 250 });
  });

  it("deletes a goal", async () => {
    const u = await createVerifiedUser();
    const g = (await u.session.http.post("/goals", { name: "Temp", targetAmount: 100 })).data;
    expect((await u.session.http.delete(`/goals/${g._id}`)).status).toBe(200);
    expect((await u.session.http.delete(`/goals/${g._id}`)).status).toBe(404);
  });
});

describe("Goals — contributions", () => {
  it("adds a contribution and tracks progress", async () => {
    const u = await createVerifiedUser();
    const g = (await u.session.http.post("/goals", { name: "Car", targetAmount: 1000 })).data;
    const res = await u.session.http.post(`/goals/${g._id}/contribute`, { amount: 400 });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ savedAmount: 400, percent: 40, complete: false });
  });

  it("marks the goal complete when saved reaches the target", async () => {
    const u = await createVerifiedUser();
    const g = (await u.session.http.post("/goals", { name: "Phone", targetAmount: 500 })).data;
    const res = await u.session.http.post(`/goals/${g._id}/contribute`, { amount: 500 });
    expect(res.data).toMatchObject({ complete: true, percent: 100 });
  });

  it("clamps saved to zero on an over-withdrawal", async () => {
    const u = await createVerifiedUser();
    const g = (await u.session.http.post("/goals", { name: "X", targetAmount: 1000, savedAmount: 100 })).data;
    const res = await u.session.http.post(`/goals/${g._id}/contribute`, { amount: -500 });
    expect(res.data.savedAmount).toBe(0);
  });
});

describe("Goals — validation & ownership", () => {
  it("rejects a non-positive target with 400", async () => {
    const u = await createVerifiedUser();
    expect((await u.session.http.post("/goals", { name: "Bad", targetAmount: 0 })).status).toBe(400);
  });

  it("rejects a blank name with 400", async () => {
    const u = await createVerifiedUser();
    expect((await u.session.http.post("/goals", { name: "", targetAmount: 100 })).status).toBe(400);
  });

  it("404s for another user's goal", async () => {
    const owner = await createVerifiedUser();
    const g = (await owner.session.http.post("/goals", { name: "Mine", targetAmount: 100 })).data;
    const stranger = await createVerifiedUser();
    expect((await stranger.session.http.post(`/goals/${g._id}/contribute`, { amount: 10 })).status).toBe(404);
    expect((await stranger.session.http.delete(`/goals/${g._id}`)).status).toBe(404);
  });
});

/**
 * A goal can track a wallet instead of counting contributions: progress is then
 * that account's live balance, so paying in — by salary transfer, a recurring
 * rule, or an ad-hoc top-up — moves the goal with nothing recorded on the goal
 * itself. The rules below exist to stop the same rupee being counted twice.
 */
describe("Goals — linked to an account", () => {
  /** A user with a dedicated wallet, ready to be linked. */
  async function withWallet(initialBalance = 0) {
    const u = await createVerifiedUser();
    const wallet = (await u.session.http.post("/accounts", { name: "Emergency Wallet", initialBalance })).data;
    const main = (await u.session.http.post("/accounts", { name: "Main", initialBalance: 100000 })).data;
    return { u, wallet, main };
  }

  it("reports the wallet's balance as progress, opening balance included", async () => {
    const { u, wallet } = await withWallet(40000);
    const goal = (
      await u.session.http.post("/goals", {
        name: "Emergency Fund",
        targetAmount: 500000,
        linkedAccount: wallet._id,
      })
    ).data;
    expect(goal).toMatchObject({ savedAmount: 40000, remaining: 460000, percent: 8 });
  });

  it("advances on a transfer in and falls back on a withdrawal", async () => {
    const { u, wallet, main } = await withWallet();
    const goal = (
      await u.session.http.post("/goals", { name: "Emergency Fund", targetAmount: 100000, linkedAccount: wallet._id })
    ).data;

    // The monthly ₹15,000, then an ad-hoc ₹3,000 of leftover cash.
    await u.session.http.post("/transactions", { type: "transfer", amount: 15000, account: main._id, toAccount: wallet._id });
    await u.session.http.post("/transactions", { type: "transfer", amount: 3000, account: main._id, toAccount: wallet._id });
    let listed = (await u.session.http.get("/goals")).data.find((g: { _id: string }) => g._id === goal._id);
    expect(listed).toMatchObject({ savedAmount: 18000, percent: 18 });

    // Taking money back out moves the goal down again — no bookkeeping either way.
    await u.session.http.post("/transactions", { type: "transfer", amount: 5000, account: wallet._id, toAccount: main._id });
    listed = (await u.session.http.get("/goals")).data.find((g: { _id: string }) => g._id === goal._id);
    expect(listed.savedAmount).toBe(13000);
  });

  it("completes when the wallet reaches the target", async () => {
    const { u, wallet, main } = await withWallet();
    await u.session.http.post("/goals", { name: "Insurance", targetAmount: 12000, linkedAccount: wallet._id });
    await u.session.http.post("/transactions", { type: "transfer", amount: 12000, account: main._id, toAccount: wallet._id });
    const [g] = (await u.session.http.get("/goals")).data;
    expect(g).toMatchObject({ savedAmount: 12000, remaining: 0, percent: 100, complete: true });
  });

  it("refuses a second goal on the same wallet", async () => {
    const { u, wallet } = await withWallet();
    expect((await u.session.http.post("/goals", { name: "First", targetAmount: 1000, linkedAccount: wallet._id })).status).toBe(201);
    const res = await u.session.http.post("/goals", { name: "Second", targetAmount: 2000, linkedAccount: wallet._id });
    expect(res.status).toBe(409);
    expect(res.data.code).toBe("ACCOUNT_ALREADY_LINKED");
  });

  it("refuses another user's account, and a missing one", async () => {
    const { wallet } = await withWallet();
    const other = await createVerifiedUser();
    const res = await other.session.http.post("/goals", { name: "Sneaky", targetAmount: 100, linkedAccount: wallet._id });
    expect(res.status).toBe(404);
  });

  it("refuses a manual contribution — the money belongs in the wallet", async () => {
    const { u, wallet } = await withWallet(1000);
    const goal = (
      await u.session.http.post("/goals", { name: "Fund", targetAmount: 5000, linkedAccount: wallet._id })
    ).data;
    const res = await u.session.http.post(`/goals/${goal._id}/contribute`, { amount: 500 });
    expect(res.status).toBe(400);
    expect(res.data.code).toBe("GOAL_TRACKS_ACCOUNT");
    // And nothing moved.
    const [listed] = (await u.session.http.get("/goals")).data;
    expect(listed.savedAmount).toBe(1000);
  });

  it("refuses a transaction or a recurring rule pointed at it", async () => {
    const { u, wallet, main } = await withWallet();
    const goal = (
      await u.session.http.post("/goals", { name: "Fund", targetAmount: 5000, linkedAccount: wallet._id })
    ).data;

    const txn = await u.session.http.post("/transactions", {
      type: "expense",
      amount: 500,
      account: main._id,
      goal: goal._id,
    });
    expect(txn.status).toBe(400);
    expect(txn.data.code).toBe("GOAL_TRACKS_ACCOUNT");

    const rule = await u.session.http.post("/recurring", {
      type: "expense",
      amount: 1000,
      account: main._id,
      goal: goal._id,
      frequency: "monthly",
      interval: 1,
      startDate: new Date().toISOString(),
    });
    expect(rule.status).toBe(400);
    expect(rule.data.code).toBe("GOAL_TRACKS_ACCOUNT");
  });

  it("ignores contributions stored before the goal was linked", async () => {
    // A rule pointed at the goal first, then the goal starts tracking a wallet:
    // its posted amounts must not be added on top of the balance.
    const { u, wallet, main } = await withWallet();
    const goal = (await u.session.http.post("/goals", { name: "Fund", targetAmount: 50000 })).data;
    await u.session.http.post(`/goals/${goal._id}/contribute`, { amount: 7000 });

    expect((await u.session.http.patch(`/goals/${goal._id}`, { linkedAccount: wallet._id })).status).toBe(200);
    await u.session.http.post("/transactions", { type: "transfer", amount: 2000, account: main._id, toAccount: wallet._id });

    const [listed] = (await u.session.http.get("/goals")).data;
    expect(listed.savedAmount).toBe(2000); // the wallet, not 9,000
  });

  it("keeps the figure on unlink, and when the wallet is deleted", async () => {
    const { u, wallet, main } = await withWallet();
    const goal = (
      await u.session.http.post("/goals", { name: "Fund", targetAmount: 50000, linkedAccount: wallet._id })
    ).data;
    await u.session.http.post("/transactions", { type: "transfer", amount: 8000, account: main._id, toAccount: wallet._id });

    // Unlinking freezes what the user last saw as the goal's own total.
    expect((await u.session.http.patch(`/goals/${goal._id}`, { linkedAccount: null })).status).toBe(200);
    let [listed] = (await u.session.http.get("/goals")).data;
    expect(listed).toMatchObject({ savedAmount: 8000, linkedAccount: null });

    // Same when the account is deleted out from under a linked goal.
    await u.session.http.patch(`/goals/${goal._id}`, { linkedAccount: wallet._id });
    expect((await u.session.http.delete(`/accounts/${wallet._id}?force=true`)).status).toBe(200);
    [listed] = (await u.session.http.get("/goals")).data;
    expect(listed.linkedAccount).toBeNull();
    expect(listed.savedAmount).toBe(8000);
  });
});

/**
 * A sinking fund: ₹12,000 for the car insurance due every February, fed by an RD.
 * The goal isn't finished when it's reached — it starts again for next year, and
 * what the finished year managed is kept.
 */
describe("Goals — repeating cycles", () => {
  /** The most recent 12 February that has already passed — one cycle overdue,
   *  the way a daily sweep would find it. */
  const lastDue = () => {
    const now = new Date();
    const feb = new Date(Date.UTC(now.getUTCFullYear(), 1, 12));
    if (feb.getTime() > now.getTime()) feb.setUTCFullYear(feb.getUTCFullYear() - 1);
    return feb.toISOString();
  };
  const yearsAgo = (n: number) => new Date(Date.UTC(new Date().getUTCFullYear() - n, 1, 12)).toISOString();
  const daysAhead = (n: number) => new Date(Date.now() + n * 86400_000).toISOString();

  it("starts the next cycle once the due date has passed, keeping the last one", async () => {
    const u = await createVerifiedUser();
    const goal = (
      await u.session.http.post("/goals", {
        name: "Car Insurance",
        targetAmount: 12000,
        repeat: "yearly",
        targetDate: lastDue(),
      })
    ).data;
    await u.session.http.post(`/goals/${goal._id}/contribute`, { amount: 12000 });

    // Opening the page rolls anything that came due.
    const [listed] = (await u.session.http.get("/goals")).data;
    expect(listed.cycleCount).toBeGreaterThan(1);
    expect(listed.savedAmount).toBe(0); // that year's ₹12,000 went on the premium
    expect(listed.cycles.at(-1)).toMatchObject({ targetAmount: 12000, savedAmount: 12000 });
    expect(new Date(listed.targetDate).getTime()).toBeGreaterThan(Date.now());
    // February stays February — cycles chain from the due date, not from today.
    expect(new Date(listed.targetDate).getUTCMonth()).toBe(1);
  });

  it("carries a surplus forward and doesn't lose a shortfall", async () => {
    const u = await createVerifiedUser();
    const over = (
      await u.session.http.post("/goals", { name: "Over", targetAmount: 12000, repeat: "yearly", targetDate: lastDue() })
    ).data;
    await u.session.http.post(`/goals/${over._id}/contribute`, { amount: 15000 });
    const under = (
      await u.session.http.post("/goals", { name: "Under", targetAmount: 12000, repeat: "yearly", targetDate: lastDue() })
    ).data;
    await u.session.http.post(`/goals/${under._id}/contribute`, { amount: 9000 });

    const goals = (await u.session.http.get("/goals")).data as {
      name: string;
      savedAmount: number;
      cycles: { savedAmount: number }[];
    }[];
    expect(goals.find((g) => g.name === "Over")!.savedAmount).toBe(3000);
    expect(goals.find((g) => g.name === "Under")!.savedAmount).toBe(0);
    expect(goals.find((g) => g.name === "Under")!.cycles.at(-1)!.savedAmount).toBe(9000);
  });

  it("never rolls a one-time goal, however long ago its date passed", async () => {
    const u = await createVerifiedUser();
    const goal = (
      await u.session.http.post("/goals", { name: "Laptop", targetAmount: 60000, targetDate: yearsAgo(2) })
    ).data;
    await u.session.http.post(`/goals/${goal._id}/contribute`, { amount: 60000 });

    const [listed] = (await u.session.http.get("/goals")).data;
    expect(listed).toMatchObject({ cycleCount: 1, savedAmount: 60000, complete: true });
    expect(listed.cycles).toEqual([]);
  });

  it("closes a cycle on demand, for a premium paid early", async () => {
    const u = await createVerifiedUser();
    const due = daysAhead(30);
    const goal = (
      await u.session.http.post("/goals", {
        name: "Car Insurance",
        targetAmount: 12000,
        repeat: "yearly",
        targetDate: due,
      })
    ).data;
    await u.session.http.post(`/goals/${goal._id}/contribute`, { amount: 12000 });

    const res = await u.session.http.post(`/goals/${goal._id}/roll`);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ cycleCount: 2, savedAmount: 0 });
    // Next year's date chains from the due date, not from today.
    expect(new Date(res.data.targetDate).getTime()).toBeGreaterThan(new Date(due).getTime());
  });

  it("refuses to close a cycle on a one-time goal", async () => {
    const u = await createVerifiedUser();
    const goal = (await u.session.http.post("/goals", { name: "Laptop", targetAmount: 1000 })).data;
    const res = await u.session.http.post(`/goals/${goal._id}/roll`);
    expect(res.status).toBe(400);
    expect(res.data.code).toBe("GOAL_NOT_REPEATING");
  });

  it("leaves a wallet-tracking goal's balance alone when it rolls", async () => {
    const u = await createVerifiedUser();
    const wallet = (await u.session.http.post("/accounts", { name: "RD Wallet", initialBalance: 12000 })).data;
    const goal = (
      await u.session.http.post("/goals", {
        name: "Insurance",
        targetAmount: 12000,
        repeat: "yearly",
        targetDate: lastDue(),
        linkedAccount: wallet._id,
      })
    ).data;

    const [listed] = (await u.session.http.get("/goals")).data;
    expect(listed._id).toBe(goal._id);
    expect(listed.cycleCount).toBeGreaterThan(1);
    // The wallet still holds the money — only paying the premium empties it.
    expect(listed.savedAmount).toBe(12000);
  });
});

/**
 * "Ready by February" is only worth showing if it comes from what's actually
 * paying in, so the projection is built from live recurring rules — the RD
 * feeding the goal, or one paying into its wallet — not a figure typed once.
 */
describe("Goals — funding and projection", () => {
  const daysAhead = (n: number) => new Date(Date.now() + n * 86400_000).toISOString();

  /** A monthly rule of `amount`, either tagged to a goal or paying into a wallet. */
  async function rule(
    u: Awaited<ReturnType<typeof createVerifiedUser>>,
    body: Record<string, unknown>
  ) {
    return u.session.http.post("/recurring", {
      frequency: "monthly",
      interval: 1,
      startDate: new Date().toISOString(),
      ...body,
    });
  }

  it("falls back to the planned monthly figure when nothing is automated", async () => {
    const u = await createVerifiedUser();
    await u.session.http.post("/goals", { name: "Plan", targetAmount: 12000, monthlyContribution: 1000 });
    const [g] = (await u.session.http.get("/goals")).data;
    expect(g).toMatchObject({ fundedMonthly: 1000, fundedByRules: 0, monthsLeft: 12 });
  });

  it("adds up the rules feeding the goal, and prefers them over the plan", async () => {
    const u = await createVerifiedUser();
    const acc = (await u.session.http.post("/accounts", { name: "Main", initialBalance: 0 })).data;
    const goal = (
      await u.session.http.post("/goals", { name: "Car Insurance", targetAmount: 12000, monthlyContribution: 100 })
    ).data;
    for (const amount of [600, 400]) {
      await rule(u, { type: "expense", amount, account: acc._id, goal: goal._id });
    }
    const [g] = (await u.session.http.get("/goals")).data;
    expect(g).toMatchObject({ fundedMonthly: 1000, fundedByRules: 2, monthsLeft: 12 });
  });

  it("counts a rule paying into a tracked wallet, but not one spending from it", async () => {
    const u = await createVerifiedUser();
    const main = (await u.session.http.post("/accounts", { name: "Main", initialBalance: 100000 })).data;
    const wallet = (await u.session.http.post("/accounts", { name: "RD Wallet", initialBalance: 0 })).data;
    await u.session.http.post("/goals", { name: "Insurance", targetAmount: 12000, linkedAccount: wallet._id });

    // The RD: ₹1,000 a month into the wallet.
    await rule(u, { type: "transfer", amount: 1000, account: main._id, toAccount: wallet._id });
    // A rule that spends FROM the wallet isn't funding — it's spending.
    await rule(u, { type: "expense", amount: 5000, account: wallet._id });

    const [g] = (await u.session.http.get("/goals")).data;
    expect(g).toMatchObject({ fundedMonthly: 1000, fundedByRules: 1 });
  });

  it("says whether the target date will be met", async () => {
    const u = await createVerifiedUser();
    const acc = (await u.session.http.post("/accounts", { name: "Main", initialBalance: 0 })).data;
    const mk = async (name: string, amount: number, targetDate: string) => {
      const goal = (await u.session.http.post("/goals", { name, targetAmount: 12000, targetDate })).data;
      await rule(u, { type: "expense", amount, account: acc._id, goal: goal._id });
    };
    await mk("Comfortable", 2000, daysAhead(400)); // 6 months of funding, a year to go
    await mk("Struggling", 200, daysAhead(60)); // 60 months of funding, 2 months to go

    const goals = (await u.session.http.get("/goals")).data as {
      name: string;
      schedule: string;
      projectedDate: string | null;
    }[];
    expect(goals.find((g) => g.name === "Comfortable")!.schedule).toBe("on_track");
    expect(goals.find((g) => g.name === "Struggling")!.schedule).toBe("behind");
    expect(goals.find((g) => g.name === "Comfortable")!.projectedDate).toBeTruthy();
  });

  it("has no verdict without a target date, or with nothing paying in", async () => {
    const u = await createVerifiedUser();
    await u.session.http.post("/goals", { name: "Someday", targetAmount: 5000, monthlyContribution: 500 });
    const [undated] = (await u.session.http.get("/goals")).data;
    expect(undated.schedule).toBe("unknown");

    await u.session.http.post("/goals", { name: "Unfunded", targetAmount: 5000, targetDate: daysAhead(90) });
    const unfunded = (await u.session.http.get("/goals")).data.find((g: { name: string }) => g.name === "Unfunded");
    expect(unfunded).toMatchObject({ fundedMonthly: 0, schedule: "unknown", projectedDate: null });
  });
});

describe("Goals — the app's own buckets are not somewhere money is set aside", () => {
  it("refuses to track Savings & Deposits", async () => {
    const u = await createVerifiedUser();
    const account = (await u.session.http.post("/accounts", { name: "HDFC", type: "bank" })).data;
    const h = (
      await u.session.http.post("/holdings", {
        name: "SBI FD",
        class: "saving",
        subtype: "fixed_deposit",
        value: 0,
      })
    ).data;
    // Paying in creates the bucket, which holds the principal of EVERY deposit.
    await u.session.http.post(`/holdings/${h._id}/deposit`, { account: account._id, amount: 5000 });
    const bucket = (await u.session.http.get("/accounts")).data.find(
      (a: any) => a.type === "deposits"
    );
    expect(bucket).toBeTruthy();

    // A goal reading it would count every deposit as progress toward one target.
    const res = await u.session.http.post("/goals", {
      name: "Anything",
      targetAmount: 10000,
      linkedAccount: bucket._id,
    });
    expect(res.status).toBe(400);
    expect(res.data.code).toBe("ACCOUNT_SYSTEM_MANAGED");
  });

  it("refuses the other app-managed ledgers too", async () => {
    const u = await createVerifiedUser();
    const account = (await u.session.http.post("/accounts", { name: "HDFC", type: "bank" })).data;
    // Lending, reflected in the ledger, creates Money Lent — a record of someone
    // else's debt rather than money anyone set aside.
    const credit = await u.session.http.post("/credits", {
      person: "Rahul",
      direction: "given",
      amount: 2500,
      account: account._id,
      reflected: true,
    });
    expect(credit.status).toBe(201);
    const lent = (await u.session.http.get("/accounts")).data.find(
      (a: any) => a.type === "receivable"
    );
    expect(lent).toBeTruthy();

    const goal = (
      await u.session.http.post("/goals", { name: "Anything", targetAmount: 10000 })
    ).data;
    const res = await u.session.http.patch(`/goals/${goal._id}`, { linkedAccount: lent._id });
    expect(res.status).toBe(400);
    expect(res.data.code).toBe("ACCOUNT_SYSTEM_MANAGED");
  });

  it("still takes an ordinary account", async () => {
    const u = await createVerifiedUser();
    const account = (await u.session.http.post("/accounts", { name: "Savings", type: "bank" })).data;
    const res = await u.session.http.post("/goals", {
      name: "Emergency fund",
      targetAmount: 100000,
      linkedAccount: account._id,
    });
    expect(res.status).toBe(201);
  });
});
