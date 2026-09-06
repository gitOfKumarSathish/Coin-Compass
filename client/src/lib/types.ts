export type TxnType = "income" | "expense" | "transfer";
export type CategoryType = "income" | "expense";
// "receivable"/"payable"/"securities"/"deposits" are auto-managed buckets the app
// creates (Money Lent, Money Owed, Stock Investments, Savings & Deposits); the
// rest a user makes by hand.
export type AccountType =
  | "cash"
  | "bank"
  | "card"
  | "wallet"
  | "upi"
  | "savings"
  | "demat"
  | "receivable"
  | "payable"
  | "securities"
  | "deposits";

/** Account types a user can create. The system buckets are never offered. */
export const CREATABLE_ACCOUNT_TYPES = [
  "cash",
  "bank",
  "card",
  "wallet",
  "upi",
  "savings",
  "demat",
] as const satisfies readonly AccountType[];
export type BudgetPeriod = "weekly" | "monthly" | "yearly";
export type Frequency = "daily" | "weekly" | "monthly" | "yearly";
export type PeriodKey = "week" | "month" | "year";

export interface AccountStats {
  income: number;
  expense: number;
  transferIn: number;
  transferOut: number;
  balance: number;
  initialBalance: number;
}

export interface Account {
  _id: string;
  name: string;
  type: AccountType;
  initialBalance: number;
  currency: string;
  color: string;
  icon: string;
  includeInTotal: boolean;
  archived: boolean;
  order: number;
  balance?: number;
  stats?: AccountStats | null;
  createdAt?: string;
  updatedAt?: string;
}

/** A saved "quick add": a partial transaction logged in one tap, price editable. */
export interface Template {
  _id: string;
  name: string;
  type: "income" | "expense";
  amount: number;
  account?: RefLite | string | null;
  category?: RefLite | string | null;
  note: string;
  tags: string[];
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Payload for creating/updating a template (ids as strings). */
export interface TemplateInput {
  name: string;
  type: "income" | "expense";
  amount: number;
  account: string | null;
  category: string | null;
  note: string;
  tags: string[];
}

export interface Category {
  _id: string;
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
  parent?: string | null;
  /** Reporting rollup bucket (see lib/categoryGroups.ts). null = ungrouped. */
  group?: string | null;
  order: number;
  isDefault?: boolean;
  /** When true, picking this category auto-enables the transaction's one-off toggle. */
  oneoffDefault?: boolean;
  // Recent (last-90-day) transaction count, supplied by GET /categories, used to
  // surface "frequently used" categories in the picker. Absent on writes.
  usageCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface RefLite {
  _id: string;
  name: string;
  color?: string;
  icon?: string;
  type?: string;
  currency?: string;
}

export interface Transaction {
  _id: string;
  type: TxnType;
  amount: number;
  account: RefLite | string;
  toAccount?: RefLite | string | null;
  category?: RefLite | string | null;
  date: string;
  note: string;
  payee: string;
  tags: string[];
  /** Irregular / one-off spend (AC service, repairs) — kept out of the typical monthly run-rate. */
  oneoff?: boolean;
  currency: string;
  /** Set when the transaction was auto-posted by a recurring rule. */
  recurring?: string | null;
  /** When set, this transaction is a repayment that reduces the loan's balance. */
  loan?: RefLite | string | null;
  /** When set, this transaction's amount was contributed to a savings goal. */
  goal?: RefLite | string | null;
  /** How much of this transaction was applied to the goal (for exact reversal). */
  goalContribution?: number;
  /** When set, this leg paid into — or took money out of — a savings deposit
   *  (RD/FD). It is a transfer, not a spend: see the server's depositService. */
  holding?: HoldingRef | string | null;
  /** The signed change this leg made to the deposit's value (for exact reversal):
   *  positive paying in, negative taking out, zero on the interest leg. */
  holdingContribution?: number;
  /** When set, this transaction is the reflected side of a Credit entry (money to/from a person).
   *  `split` on the credit means the credit is one person's share of a shared bill. */
  credit?: { _id: string; person: string; direction: CreditDirection; split?: string | null } | string | null;
  /** Set on the expense leg carrying YOUR share of a shared bill. Participants'
   *  legs reach the split through `credit.split` instead — see splitIdOf(). */
  split?: { _id: string; description: string; totalAmount: number; yourShare: number } | string | null;
  /** Set when the transaction is in the "Recently deleted" trash (soft-deleted). */
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TransactionPage {
  items: Transaction[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasMore: boolean;
}

export interface Budget {
  _id: string;
  category?: RefLite | null;
  amount: number;
  period: BudgetPeriod;
  startDate: string;
  currency: string;
  spent: number;
  remaining: number;
  percent: number;
  over: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Recurring {
  _id: string;
  type: TxnType;
  amount: number;
  account: RefLite;
  toAccount?: RefLite | null;
  category?: RefLite | null;
  note: string;
  payee: string;
  tags: string[];
  currency: string;
  loan?: RefLite | null;
  /** When set, each posted occurrence adds its amount to this savings goal. */
  goal?: RefLite | null;
  /** A SIP: AMFI scheme code whose units each occurrence buys at the day's NAV. */
  fund?: string | null;
  fundFolio?: string;
  /** An RD instalment: the deposit each occurrence pays into. */
  holding?: RefLite | string | null;
  frequency: Frequency;
  interval: number;
  startDate: string;
  nextRun: string;
  endDate?: string | null;
  lastRun?: string | null;
  active: boolean;
  /** Next few scheduled run dates (ISO), computed server-side. */
  upcoming?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export const GOAL_REPEATS = ["none", "monthly", "quarterly", "yearly"] as const;
export type GoalRepeat = (typeof GOAL_REPEATS)[number];

export interface Goal {
  _id: string;
  name: string;
  targetAmount: number;
  /** For a linked goal this is the wallet's live balance, resolved server-side. */
  savedAmount: number;
  /** The account this goal tracks, if any — progress then follows its balance. */
  linkedAccount?: RefLite | string | null;
  /** The deposit this goal tracks, if any — progress is then what it holds. */
  linkedHolding?: RefLite | string | null;
  targetDate?: string | null;
  monthlyContribution: number;
  color: string;
  icon: string;
  currency: string;
  achievedAt?: string | null;
  /** "none" for a one-time goal; anything else restarts it each cycle. */
  repeat: GoalRepeat;
  /** Which run of a repeating goal is in progress (1-based). */
  cycleCount: number;
  /** Finished cycles, oldest first. */
  cycles: { index: number; targetAmount: number; savedAmount: number; closedAt: string }[];
  // computed server-side
  remaining: number;
  percent: number;
  complete: boolean;
  monthsLeft: number | null;
  /** Monthly inflow from the recurring rules paying in (or the planned figure). */
  fundedMonthly: number;
  /** How many active rules that came from — 0 when it's the planned figure. */
  fundedByRules: number;
  /** When it should be reached at that rate, ISO, or null if nothing is paying in. */
  projectedDate: string | null;
  schedule: "on_track" | "behind" | "unknown";
  createdAt?: string;
  updatedAt?: string;
}

export type HoldingClass = "saving" | "investment";
export type HoldingSubtype =
  | "fixed_deposit"
  | "recurring_deposit"
  | "emergency_fund"
  | "retirement_fund"
  | "stocks"
  | "mutual_funds"
  | "real_estate"
  | "bonds"
  | "gold";

/** The slice of a Holding a populated transaction carries. */
export interface HoldingRef {
  _id: string;
  name: string;
  class: HoldingClass;
  subtype: HoldingSubtype;
  provider?: string;
}

export interface Holding {
  _id: string;
  name: string;
  class: HoldingClass;
  subtype: HoldingSubtype;
  value: number;
  provider: string;
  note: string;
  currency: string;
  // Optional deposit/growth details (see holdingGrowth in lib/networth).
  investedAmount?: number | null;
  startDate?: string | null;
  maturityDate?: string | null;
  interestRate?: number | null;
  maturityValue?: number | null;
  /**
   * How many instalments a recurring deposit runs for — the term agreed with the
   * bank. It sets both the progress bar's denominator and the date the schedule
   * stops.
   */
  termCount?: number | null;
  /** Where the maturity payout lands, chosen when the deposit is set up. */
  payoutAccount?: RefLite | string | null;
  /**
   * Instalments actually paid in so far, inlined by the API. `imported` counts
   * the ones rewritten from past expenses — the only ones an undo can put back.
   */
  paid?: { count: number; total: number; imported: number };
  /** Whether a Goal is tracking this deposit's progress. */
  trackedAsGoal?: boolean;
  /**
   * The standing order feeding this deposit, inlined by the API. Editing it on
   * the holding is the whole point: a recurring deposit is one fact, so it is
   * described in one place rather than assembled from a rule elsewhere.
   */
  instalment?: HoldingInstalment | null;
  createdAt?: string;
  updatedAt?: string;
}

/** The funding rule as the holding sees it — a recurring rule, minus the parts
 *  the deposit path overrides (type, category, destination account). */
export interface HoldingInstalment {
  _id: string;
  amount: number;
  account: RefLite;
  frequency: Frequency;
  interval: number;
  startDate: string;
  nextRun: string;
  endDate?: string | null;
  active: boolean;
}

/** What the holding form sends back to set or change that schedule. */
export interface HoldingInstalmentInput {
  amount: number;
  account: string;
  frequency: Frequency;
  interval: number;
  startDate: string;
  endDate?: string | null;
}

export type LoanType = "home" | "personal" | "car" | "education" | "gold" | "business" | "other";
export type LoanStatus = "active" | "closed";

export interface Loan {
  _id: string;
  name: string;
  lender: string;
  type: LoanType;
  principal: number;
  outstanding: number;
  roi: number;
  emi: number;
  foreclosureChargePct: number;
  interestPaid: number;
  chargesPaid: number;
  /** Total tenure in months; endDate is derived from startDate + this. */
  tenureMonths?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  status: LoanStatus;
  note: string;
  currency: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Which way money moved, across both sides of an informal debt:
 *   given / received — the asset side ("Money Lent"): they owe you
 *   borrowed / repaid — the liability side ("Money Owed"): you owe them
 */
export const CREDIT_DIRECTIONS = ["given", "received", "borrowed", "repaid"] as const;
export type CreditDirection = (typeof CREDIT_DIRECTIONS)[number];

/** Whether a direction belongs to the "Money Lent" side rather than "Money Owed". */
export function isReceivableSide(d: CreditDirection): boolean {
  return d === "given" || d === "received";
}

export const PERSON_RELATIONS = ["family", "friend", "colleague", "other"] as const;
export type PersonRelation = (typeof PERSON_RELATIONS)[number];

/**
 * Someone you lend to, borrow from, or split bills with — a record with an id,
 * so renaming them updates every past entry and two spellings of one name can't
 * drift into two balances.
 */
export interface Person {
  _id: string;
  name: string;
  /** Normalised name used for matching — see personKey on the server. */
  key: string;
  relation: PersonRelation;
  createdAt?: string;
  updatedAt?: string;
}

/** Payment channels — how the money moved (the app/instrument), a record label
 *  distinct from the account whose balance actually changes. */
export const CREDIT_METHODS = [
  "Cash", "GPay", "PhonePe", "Paytm", "UPI", "Net Banking",
  "Debit Card", "Credit Card", "Cheque", "Bank Transfer", "Other",
] as const;
export type CreditMethod = (typeof CREDIT_METHODS)[number];

/** An informal IOU with a friend/family member; optionally linked to a real
 *  Transaction (see `reflected`) so it also moves an account balance. */
export interface Credit {
  _id: string;
  person: string;
  direction: CreditDirection;
  amount: number;
  date: string;
  /** How the money moved (GPay/PhonePe/…) — a label, not a balance. */
  method: string;
  /** The account whose balance moves — only set when reflected. */
  account?: RefLite | string | null;
  /** On `borrowed`: the expense category, set when they paid for something you
   *  consumed rather than handing you cash. */
  category?: RefLite | string | null;
  note: string;
  reflected: boolean;
  transaction?: string | null;
  /** The Person this entry belongs to. Null on entries predating the People
   *  registry, or whose person was force-deleted — `person` is the fallback. */
  personRef?: string | null;
  /** Set when this credit is one person's share of a shared bill (see Split). */
  split?: string | null;
  /** On a repayment: the individual lend it settles. Null = a general payment
   *  that pays down the person's open lends oldest-first. */
  settles?: string | null;
  /** How much of THIS lend is still owed — served by /credits/summary, which
   *  allocates repayments across a person's entries. Null on repayments, which
   *  are money already moved rather than something outstanding. */
  outstanding?: number | null;
  /** Whether this lend is fully repaid. Null on repayments. */
  settled?: boolean | null;
  createdAt?: string;
  updatedAt?: string;
}

/** One participant of a shared bill: what they owed for it, and what they still
 *  owe overall (their share minus anything they've since paid back). */
export interface SplitParticipant {
  person: string;
  /** The Person record behind this share, when it's linked to one. */
  personId?: string | null;
  /** This person's share of THIS bill. */
  amount: number;
  /** The Credit id backing the share. */
  credit: string;
  /** What they still owe ON THIS BILL — not their overall balance, which would
   *  leak an unrelated bill's figure into this row. */
  outstanding: number;
  /** True once this share is fully paid. */
  settled?: boolean;
}

/**
 * A bill you paid that several people shared. Only `yourShare` is ever your own
 * spending; the rest is a receivable that settles through the Credits flow.
 */
export interface Split {
  _id: string;
  description: string;
  totalAmount: number;
  yourShare: number;
  date: string;
  account?: RefLite | string | null;
  category?: RefLite | string | null;
  method: string;
  note: string;
  /** Set when a FRIEND paid this bill — you owe them your share, and nobody owes you. */
  paidBy?: string;
  /** The expense leg for your share; null when you paid purely for others. */
  expenseTransaction?: string | null;
  participants: SplitParticipant[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A named set of people you regularly split with. Purely a shortcut over People:
 * picking a group adds its members as ordinary participants, and no balance is
 * ever held against a group.
 */
export interface PersonGroup {
  _id: string;
  name: string;
  members: Person[];
  createdAt?: string;
  updatedAt?: string;
}

/** One person's running ledger: net > 0 means they owe you, net < 0 means you owe them. */
export interface CreditPersonSummary {
  /** The Person's current name where there is one, so a rename shows everywhere. */
  person: string;
  /** Null only for entries not yet linked to a Person record. */
  personId: string | null;
  relation: PersonRelation | null;
  given: number;
  received: number;
  borrowed: number;
  repaid: number;
  net: number;
  entries: Credit[];
}

export type Metal = "gold" | "silver";

export interface MetalPrice {
  metal: Metal;
  currency: string;
  date: string; // YYYY-MM-DD (IST)
  pricePerOunce: number;
  pricePerGram24k: number;
  pricePerGram22k: number;
  pricePerGram18k: number;
  prevClose: number;
  change: number;
  changePct: number;
  source: string;
  fetchedAt: string;
  // Actual GRT counter rate (gold only); 0 when unavailable → fall back to
  // spot + premium on the client.
  retail22k?: number;
  retail24k?: number;
  retail18k?: number;
  retailSource?: string;
}

export interface MetalsLatest {
  configured: boolean;
  gold: MetalPrice | null;
  silver: MetalPrice | null;
}

export type ViewMode = "user" | "superadmin";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
  emailVerified: boolean;
  /** ISO date the account was created (for "member since"). */
  createdAt: string | null;
  /** True for password accounts; false for OAuth-only sign-ins. */
  hasPassword: boolean;
  /** Whether two-factor authentication is enabled on this account. */
  twoFactorEnabled: boolean;
  /** Current view mode; `superadmin` may see the wealth (Net Worth) section. */
  mode: ViewMode;
  /** Whether the wealth lock is turned on for this account. */
  wealthLockEnabled: boolean;
}

/** The second factors offered at login. Backup codes are always accepted as a fallback. */
export type TwoFactorMethod = "totp" | "email" | "backup";

/**
 * Result of a password sign-in: either a full session (`user`) or a 2FA
 * challenge (`requires2fa`) that must be completed before a session is issued.
 */
export type LoginResult =
  | { requires2fa: false; user: AuthUser }
  | { requires2fa: true; methods: TwoFactorMethod[] };

/** The in-progress 2FA challenge, fetched by the verify screen from the pending cookie. */
export interface TwoFactorPending {
  email: string;
  methods: TwoFactorMethod[];
}

/** Current 2FA configuration for the signed-in account (Settings). */
export interface TwoFactorStatus {
  enabled: boolean;
  emailFallback: boolean;
  backupCodesRemaining: number;
}

/** Enrollment payload: what to show the user to scan/enter into their authenticator. */
export interface TwoFactorSetup {
  otpauthUrl: string;
  qrDataUrl: string;
  secret: string;
}

export interface OAuthProviders {
  google: boolean;
  github: boolean;
  microsoft: boolean;
  apple: boolean;
}

export interface ImportResult {
  total: number;
  imported: number;
  failed: { row: number; error: string }[];
  createdCategories: string[];
  createdAccounts: string[];
}

export interface CurrencyConfig {
  code: string;
  symbol: string;
  name: string;
  rateToBase: number;
}

export interface Settings {
  _id: string;
  name: string;
  description?: string;
  baseCurrency: string;
  theme: "light" | "dark" | "system";
  locale: string;
  language: "en" | "ta";
  currencies: CurrencyConfig[];
  pinEnabled: boolean;
  emailReports: boolean;
  wealthLockEnabled: boolean;
}

export interface Summary {
  income: number;
  expense: number;
  net: number;
  incomeCount: number;
  expenseCount: number;
  /** Portion of income / expense flagged irregular / one-off. */
  oneoffIncome: number;
  oneoffExpense: number;
  /** Expense minus savings deposits and debt principal — the true cost of living. */
  consumption: number;
  /** The part of `expense` that stayed yours: deposits + principal repaid. */
  nonConsumption: number;
  netWorth: number;
  byCurrency: Record<string, number>;
  range: { start: string; end: string };
}

export interface NetWorthSnapshot {
  date: string; // YYYY-MM-DD (IST)
  netWorth: number;
  assets: number;
  liabilities: number;
  accountsTotal: number;
  holdingsTotal: number;
  saving: number;
  investment: number;
  /** Market value of stock lots. Already counted inside `investment`. */
  stocksTotal: number;
  currency: string;
}

export interface CategoryDatum {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string;
  /** Rollup bucket of the row's category; null for ungrouped and uncategorized. */
  group?: string | null;
  total: number;
  count: number;
  percent: number;
}

export interface TrendDatum {
  bucket: string;
  income: number;
  expense: number;
  net: number;
}

export interface AccountDatum {
  _id: string;
  name: string;
  color: string;
  income: number;
  expense: number;
  /** Transfers from another of your accounts into this one. */
  transferIn: number;
  /** Transfers out of this one into another of your accounts. */
  transferOut: number;
}

export interface InsightsMetric {
  current: number;
  previous: number;
  delta: number;
  /** % change vs previous; null when there's no baseline (previous was 0). */
  pct: number | null;
}

export interface CategoryMover {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string;
  current: number;
  previous: number;
  delta: number;
  pct: number | null;
}

export interface TopExpense {
  _id: string;
  amount: number;
  note: string;
  payee: string;
  date: string;
  category: { name: string; color: string; icon: string } | null;
  account: { name: string; color: string } | null;
}

export interface InsightsPace {
  isCurrent: boolean;
  daysElapsed: number;
  daysInPeriod: number;
  avgPerDay: number;
  projected: number;
  previousToDate: number;
}

export interface InsightsReport {
  period: PeriodKey;
  current: { start: string; end: string };
  previous: { start: string; end: string };
  expense: InsightsMetric;
  income: InsightsMetric;
  net: InsightsMetric;
  savingsRate: { current: number | null; previous: number | null };
  pace: InsightsPace;
  movers: CategoryMover[];
  topExpenses: TopExpense[];
  hasData: boolean;
}

export interface Dashboard {
  period: PeriodKey;
  range: { start: string; end: string };
  summary: Summary;
  accounts: Account[];
  byCategory: CategoryDatum[];
  trend: TrendDatum[];
  recent: Transaction[];
  budgets: (Budget & { spent: number; percent: number; over: boolean })[];
  upcoming: Recurring[];
}

export type NotificationType =
  | "recurring.posted"
  | "recurring.ended"
  | "recurring.due_soon"
  | "recurring.overdue"
  | "budget.exceeded"
  | "balance.low"
  | "goal.cycle_rolled"
  | "goal.behind"
  | "goal.achieved"
  | "deposit.matured";

export interface AppNotification {
  _id: string;
  type: NotificationType;
  /** Interpolation values for the i18n title/body templates (amounts stay raw). */
  params: Record<string, unknown>;
  link: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: AppNotification[];
  unread: number;
}

// ---- Stocks (demat holdings, priced from the global daily snapshots) ----

export type StockExchange = "NSE" | "BSE";
export type GainType = "STCG" | "LTCG";

/** A search result from the symbol picker — the only way a symbol is chosen. */
export interface InstrumentHit {
  symbol: string; // "RELIANCE.NS"
  ticker: string; // "RELIANCE"
  exchange: StockExchange;
  shortName: string;
  longName: string;
  sector: string;
  industry: string;
}

/** One purchase. Positions are per-lot so buy dates survive for LTCG and FIFO. */
export interface StockLot {
  _id: string;
  qty: number;
  qtyRemaining: number;
  buyPrice: number;
  buyDate: string;
  fees: number;
  note: string;
  /** Whole days until this lot turns long-term; 0 once it already has. */
  daysToLongTerm: number;
  longTerm: boolean;
}

export interface StockPosition {
  symbol: string;
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  qty: number;
  avgCost: number;
  investedCost: number;
  /** null when nothing has been priced yet; the position then shows at cost. */
  price: number | null;
  priceDate: string | null;
  /** True when the price is carried forward (weekend, holiday, failed fetch). */
  stale: boolean;
  dayChange: number;
  dayChangePct: number;
  marketValue: number;
  unrealized: number;
  unrealizedPct: number;
  week52High: number;
  week52Low: number;
  allocationPct: number;
  lots: StockLot[];
}

export interface PortfolioTotals {
  marketValue: number;
  investedCost: number;
  unrealized: number;
  unrealizedPct: number;
  dayChange: number;
  realizedPL: number;
  realizedShortTerm: number;
  realizedLongTerm: number;
}

export interface Portfolio {
  /** False when the live feed is switched off server-side (STOCKS_ENABLED). */
  configured: boolean;
  positions: StockPosition[];
  totals: PortfolioTotals;
  pricedAt: string | null;
  anyStale: boolean;
}

export interface StockSaleAllocation {
  lot: string;
  qty: number;
  costBasis: number;
  buyDate: string;
  gainType: GainType;
}

export interface StockSale {
  _id: string;
  symbol: string;
  ticker: string;
  name: string;
  qty: number;
  sellPrice: number;
  sellDate: string;
  fees: number;
  note: string;
  allocations: StockSaleAllocation[];
  realizedPL: number;
  realizedShortTerm: number;
  realizedLongTerm: number;
}

/**
 * A split or bonus that has happened since you bought, and isn't reflected in
 * your lots yet. Offered for confirmation rather than applied automatically —
 * the market price adjusts instantly, so an unapplied split reads as a sudden
 * loss, but silently multiplying a share count is worse than a questionable
 * number. `ratio` is how many shares each old share became.
 */
export interface PendingSplit {
  symbol: string;
  ticker: string;
  name: string;
  date: string;
  ratio: number;
  label: string;
  lots: number;
  qtyBefore: number;
  qtyAfter: number;
}

// ---- Mutual funds ----

/** One scheme from the cached AMFI universe, as the search returns it. */
export interface FundHit {
  schemeCode: string;
  name: string;
  fundHouse: string;
  /** "Direct" | "Regular" | "" */
  plan: string;
  /** "Growth" | "IDCW" | "" */
  option: string;
  category: string;
  kind: string;
  nav: number;
  navDate: string | null;
}

export interface FundLotView {
  id: string;
  units: number;
  unitsRemaining: number;
  buyNav: number;
  buyDate: string;
  fees: number;
  folio: string;
  /** True when a SIP rule bought this installment rather than a person. */
  sip: boolean;
  daysToLongTerm: number;
}

export interface FundPosition {
  schemeCode: string;
  name: string;
  fundHouse: string;
  plan: string;
  option: string;
  kind: string;
  folios: string[];
  units: number;
  avgNav: number;
  invested: number;
  nav: number;
  navDate: string | null;
  marketValue: number;
  unrealizedPL: number;
  unrealizedPct: number;
  shortTermUnits: number;
  daysToLongTerm: number | null;
  lots: FundLotView[];
}

export interface FundPortfolio {
  positions: FundPosition[];
  invested: number;
  marketValue: number;
  unrealizedPL: number;
  unrealizedPct: number;
  realizedPL: number;
  /** True when a holding has no published NAV — value falls back to cost. */
  stale: boolean;
}

export interface FundRedemptionRow {
  _id: string;
  schemeCode: string;
  units: number;
  sellNav: number;
  sellDate: string;
  fees: number;
  realizedPL: number;
  note?: string;
}
