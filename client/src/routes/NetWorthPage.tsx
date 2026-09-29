import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  HandCoins,
  History,
  Landmark,
  MoreVertical,
  Pencil,
  PiggyBank,
  Link2,
  Plus,
  Repeat,
  Target,
  Trash2,
  Undo2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { CategoryIcon } from "@/components/common/CategoryIcon";
import { CountUp } from "@/components/common/CountUp";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CategoryDonut } from "@/features/reports/CategoryDonut";
import { HoldingFormDialog } from "@/features/networth/HoldingFormDialog";
import { DepositDialog, type DepositMode } from "@/features/networth/DepositDialog";
import { AdoptDepositsDialog } from "@/features/networth/AdoptDepositsDialog";
import { LinkRuleDialog } from "@/features/networth/LinkRuleDialog";
import { UndoImportDialog } from "@/features/networth/UndoImportDialog";
import { ruleToCadence } from "@/lib/instalments";
import { NetWorthTrend } from "@/features/networth/NetWorthTrend";
import { useHoldings, useDeleteHolding } from "@/hooks/useHoldings";
import { useLoans } from "@/hooks/useLoans";
import { useAccounts } from "@/hooks/useAccounts";
import { useNetWorthHistory } from "@/hooks/useNetWorth";
import { usePortfolio } from "@/hooks/useStocks";
import { useFundPortfolio } from "@/hooks/useFunds";
import { useByCategory, useSummary } from "@/hooks/useReports";
import { periodRange } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { enumLabel } from "@/lib/i18nLabels";
import { cn } from "@/lib/utils";
import {
  SUBTYPE_META,
  CHART_PALETTE,
  LOAN_TYPE_META,
  SCHEDULABLE_SUBTYPES,
  holdingGrowth,
} from "@/lib/networth";
import type { Account, CategoryDatum, Holding, HoldingClass, Loan, Portfolio } from "@/lib/types";
import { toast } from "sonner";

/** Group a class's holdings into donut data by subtype. */
function holdingsToData(list: Holding[]): CategoryDatum[] {
  const total = list.reduce((s, h) => s + h.value, 0);
  const bySub = new Map<string, { value: number; count: number }>();
  for (const h of list) {
    const cur = bySub.get(h.subtype) ?? { value: 0, count: 0 };
    cur.value += h.value;
    cur.count += 1;
    bySub.set(h.subtype, cur);
  }
  return [...bySub.entries()]
    .map(([sub, v]) => {
      const meta = SUBTYPE_META[sub as keyof typeof SUBTYPE_META];
      return {
        categoryId: sub,
        name: enumLabel("holding", sub),
        color: meta.color,
        icon: meta.icon,
        total: v.value,
        count: v.count,
        percent: total > 0 ? Math.round((v.value / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Whether money can be paid into this holding from the ledger. Stocks and mutual
 * funds are valued from their lots, so their cash movements belong to the Stocks
 * and Funds pages — paying in here would count the same money twice. Everything
 * else (deposits, gold, property) carries its own value and can take a deposit.
 */
function takesDeposits(h: Holding): boolean {
  return h.subtype !== "stocks" && h.subtype !== "mutual_funds";
}

export default function NetWorthPage() {
  const { t, i18n } = useTranslation("wealth");
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: holdings, isLoading: holdingsLoading } = useHoldings();
  const { data: loans } = useLoans();
  const { data: accounts } = useAccounts();
  const { data: portfolio } = usePortfolio();
  const history = useNetWorthHistory();

  const monthRange = useMemo(() => {
    const { start, end } = periodRange("month", new Date());
    return { from: start.toISOString(), to: end.toISOString() };
  }, []);
  const summary = useSummary(monthRange);
  const expenseCats = useByCategory({ ...monthRange, type: "expense" });

  const includedAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.includeInTotal && !a.archived),
    [accounts]
  );
  const activeLoans = useMemo(() => (loans ?? []).filter((l) => l.status === "active"), [loans]);

  // Stock lots are valued at market and folded into `investment`, exactly as
  // computeNetWorthBreakdown does server-side. The two computations are separate
  // by design (this one is instant, that one is the snapshot), so they have to be
  // changed together or the cards and the trend's newest point drift apart.
  const stocksTotal = portfolio?.totals.marketValue ?? 0;
  const { data: fundPortfolio } = useFundPortfolio();
  const fundsTotal = fundPortfolio?.marketValue ?? 0;

  const totals = useMemo(() => {
    const saving = (holdings ?? []).filter((h) => h.class === "saving").reduce((s, h) => s + h.value, 0);
    const investment =
      (holdings ?? []).filter((h) => h.class === "investment").reduce((s, h) => s + h.value, 0) +
      stocksTotal +
      fundsTotal;
    const accountsTotal = includedAccounts.reduce((s, a) => s + (a.balance ?? 0), 0);
    const holdingsTotal = saving + investment;
    const assets = accountsTotal + holdingsTotal;
    const liabilities = activeLoans.reduce((s, l) => s + l.outstanding, 0);
    return { saving, investment, accountsTotal, holdingsTotal, assets, liabilities, netWorth: assets - liabilities };
  }, [holdings, includedAccounts, activeLoans, stocksTotal, fundsTotal]);

  const expenditure = summary.data?.expense ?? 0;

  const overviewData: CategoryDatum[] = useMemo(() => {
    const items = [
      { categoryId: "expenditure", name: t("overview.expenditure"), color: "#EF4444", icon: "receipt", total: expenditure },
      { categoryId: "saving", name: t("overview.saving"), color: "#10B981", icon: "piggy-bank", total: totals.saving },
      { categoryId: "investment", name: t("overview.investment"), color: "#6366F1", icon: "trending-up", total: totals.investment },
    ].filter((d) => d.total > 0);
    const sum = items.reduce((s, d) => s + d.total, 0);
    return items.map((d) => ({ ...d, count: 0, percent: sum > 0 ? Math.round((d.total / sum) * 100) : 0 }));
  }, [expenditure, totals.saving, totals.investment, t]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-derive translated slice labels on language switch
  const savingData = useMemo(() => holdingsToData((holdings ?? []).filter((h) => h.class === "saving")), [holdings, i18n.language]);
  const investmentData = useMemo(
    () => {
      const list = (holdings ?? []).filter((h) => h.class === "investment");
      // The stock portfolio enters the donut as one synthetic "stocks" holding.
      // holdingsToData reads only subtype and value, and SUBTYPE_META already
      // defines a stocks slice — so equity gets its colour and icon for free.
      // Funds join the same way — SUBTYPE_META already has a mutual_funds slice,
      // so they get their colour and icon for free.
      const withEquity = stocksTotal > 0 ? [...list, { subtype: "stocks", value: stocksTotal } as Holding] : list;
      return holdingsToData(
        fundsTotal > 0
          ? [...withEquity, { subtype: "mutual_funds", value: fundsTotal } as Holding]
          : withEquity
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-derive translated slice labels on language switch
    [holdings, stocksTotal, fundsTotal, i18n.language]
  );

  const negative = totals.netWorth < 0;
  const selectedTab = ["overview", "assets", "liabilities"].includes(searchParams.get("tab") ?? "")
    ? (searchParams.get("tab") as "overview" | "assets" | "liabilities")
    : "overview";
  function selectTab(tab: string) {
    const next = new URLSearchParams(searchParams);
    if (tab === "overview") next.delete("tab");
    else next.set("tab", tab);
    setSearchParams(next);
  }
  // A one-line read of what the number means, so a negative figure isn't left unexplained.
  const netWorthNote = negative
    ? t("summary.noteNegative")
    : totals.assets === 0 && totals.liabilities === 0
      ? t("summary.noteEmpty")
      : totals.liabilities === 0
        ? t("summary.noteDebtFree")
        : t("summary.notePositive");

  return (
    <div>
      <PageHeader title={t("netWorth.title")} description={t("netWorth.description")} />

      {/* summary */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="surface-gradient">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{t("summary.netWorth")}</p>
              <span
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
                  negative ? "bg-expense/10 text-expense" : "bg-income/10 text-income"
                }`}
              >
                {negative ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
              </span>
            </div>
            <CountUp
              value={totals.netWorth}
              id="nw-networth"
              className={`tnum block text-3xl font-extrabold ${negative ? "text-expense" : "text-income"}`}
            />
            <p className="mt-1 text-xs text-muted-foreground">{netWorthNote}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{t("summary.totalAssets")}</p>
              <Link
                to="/accounts"
                className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
              >
                {t("summary.accounts")} <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <CountUp value={totals.assets} id="nw-assets" className="tnum block text-2xl font-bold text-income" />
            <div className="mt-2 space-y-1 text-xs">
              <MiniRow label={t("summary.accounts")} value={formatMoney(totals.accountsTotal)} />
              <MiniRow
                label={t("summary.holdings")}
                value={totals.holdingsTotal > 0 ? formatMoney(totals.holdingsTotal) : t("summary.noneYet")}
                muted={totals.holdingsTotal === 0}
              />
              {/* Stocks are already inside the holdings figure above; called out
                  separately because they're the one line that moves daily. */}
              {stocksTotal > 0 && <MiniRow label={t("summary.stocks")} value={formatMoney(stocksTotal)} />}
              {fundsTotal > 0 && <MiniRow label={t("summary.funds")} value={formatMoney(fundsTotal)} />}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{t("summary.totalLiabilities")}</p>
              {activeLoans.length > 0 && (
                <Link
                  to="/loans"
                  className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                >
                  {t("summary.loans")} <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
            <CountUp value={totals.liabilities} id="nw-liabilities" className="tnum block text-2xl font-bold text-expense" />
            <p className="mt-1 text-xs text-muted-foreground">
              {activeLoans.length > 0
                ? t("summary.outstandingAcross", { count: activeLoans.length })
                : t("summary.noActiveLoans")}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={selectedTab} onValueChange={selectTab}>
        <TabsList className="mb-5">
          <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          <TabsTrigger value="assets">{t("tabs.assets")}</TabsTrigger>
          <TabsTrigger value="liabilities">{t("tabs.liabilities")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-4">
            <NetWorthTrend data={history.data} loading={history.isLoading} />
            <OverviewTab
              overviewData={overviewData}
              savingData={savingData}
              investmentData={investmentData}
              expenseCats={expenseCats.data ?? []}
              expenditure={expenditure}
              savingTotal={totals.saving}
              investmentTotal={totals.investment}
              loading={holdingsLoading || summary.isLoading}
            />
          </div>
        </TabsContent>

        <TabsContent value="assets">
          <AssetsTab
            holdings={holdings}
            accounts={includedAccounts}
            portfolio={portfolio}
            loading={holdingsLoading}
          />
        </TabsContent>

        <TabsContent value="liabilities">
          <LiabilitiesTab loans={activeLoans} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MiniRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tnum font-medium ${muted ? "text-muted-foreground" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

/**
 * The standing order feeding this deposit, said plainly on the card.
 *
 * Without it the automation is invisible: the value goes up each month and you
 * have to go looking on the Recurring page to find out why, or whether it is
 * still running at all.
 */
function InstalmentLine({ holding, onPayout }: { holding: Holding; onPayout: () => void }) {
  const { t } = useTranslation("wealth");
  const inst = holding.instalment;
  if (!inst) return null;

  const term = holding.termCount ?? 0;
  const paid = holding.paid?.count ?? 0;
  const done = term > 0 && paid >= term;

  // Just how much and how often. The card is a third of a row wide — roughly
  // twenty-odd characters before it truncates — so the funding account and the
  // next due date are left to the form and the Recurring page, which have room
  // to show them whole. A line that ends in "· next …" tells nobody anything.
  return (
    <div className="mt-1 space-y-1">
      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
        <Repeat className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {t("instalment.onCard", {
            amount: formatMoney(inst.amount),
            every: t(`instalment.cadenceAdverb.${ruleToCadence(inst.frequency, inst.interval)}`),
          })}
          {!inst.active && !done && ` · ${t("instalment.cardPaused")}`}
        </span>
      </p>
      {/* A term turns a standing order into something with an end you can see
          coming: 4 of 12 paid says both how far along and how much is left. */}
      {term > 0 && (
        <div className="space-y-1">
          <Progress value={Math.min(100, (paid / term) * 100)} className="h-1" />
          {done ? (
            // The last instalment is in, so the only thing left to do is take the
            // money out — said here rather than left in a menu, because nothing
            // else on the page will tell you the deposit is finished.
            <p className="tnum flex flex-wrap items-center gap-x-1.5 text-[11px]">
              <span className="text-income">{t("instalment.termProgress", { paid, count: term })}</span>
              <button
                type="button"
                onClick={onPayout}
                className="font-medium text-primary hover:underline"
              >
                {t("instalment.payOut")}
              </button>
            </p>
          ) : (
            <p className="tnum truncate text-[11px] text-muted-foreground">
              {t("instalment.termProgress", { paid, count: term })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Gain + time-to-maturity line for deposit-style holdings; renders nothing for bare ones. */
function HoldingGrowthLine({ holding }: { holding: Holding }) {
  const { t } = useTranslation("wealth");
  const g = useMemo(
    () =>
      holdingGrowth(
        {
          invested: holding.investedAmount,
          maturityValue: holding.maturityValue,
          rate: holding.interestRate,
          startDate: holding.startDate,
          maturityDate: holding.maturityDate,
        },
        new Date()
      ),
    [holding]
  );

  const invested = holding.investedAmount ?? null;
  if (g.gain == null && g.progressPct == null) return null;

  return (
    <div className="mt-1 space-y-1">
      {g.gain != null && invested != null && (
        <p className="truncate text-xs">
          <span className="text-muted-foreground">{t("growth.invested", { amount: formatMoney(invested) })}</span>
          <span className={g.gain >= 0 ? "text-income" : "text-expense"}>
            {g.gain >= 0 ? "+" : "−"}
            {formatMoney(Math.abs(g.gain))}
            {g.gainPct != null ? ` (${Math.round(g.gainPct)}%)` : ""}
          </span>
        </p>
      )}
      {g.progressPct != null && (
        <div className="flex items-center gap-1.5">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-income" style={{ width: `${g.progressPct}%` }} />
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            {g.progressPct >= 100 ? t("growth.matured") : `${Math.round(g.progressPct)}%`}
          </span>
        </div>
      )}
    </div>
  );
}

// ---- Overview tab ----

function OverviewTab({
  overviewData,
  savingData,
  investmentData,
  expenseCats,
  expenditure,
  savingTotal,
  investmentTotal,
  loading,
}: {
  overviewData: CategoryDatum[];
  savingData: CategoryDatum[];
  investmentData: CategoryDatum[];
  expenseCats: CategoryDatum[];
  expenditure: number;
  savingTotal: number;
  investmentTotal: number;
  loading: boolean;
}) {
  const { t } = useTranslation("wealth");
  if (loading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (!overviewData.length) {
    return (
      <EmptyState
        icon={PiggyBank}
        title={t("overview.emptyTitle")}
        description={t("overview.emptyDesc")}
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{t("overview.moneyMap")}</CardTitle>
        </CardHeader>
        <CardContent>
          <CategoryDonut
            data={overviewData}
            total={expenditure + savingTotal + investmentTotal}
            centerLabel={t("labels.total", { ns: "common" })}
            wideLegend
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("overview.moneyMapNote")}
          </p>
        </CardContent>
      </Card>

      <DonutCard title={t("overview.expenditureBreakdown")} data={expenseCats} centerLabel={t("overview.spent")} empty={t("overview.noSpending")} />
      <DonutCard title={t("overview.savingBreakdown")} data={savingData} centerLabel={t("overview.saved")} empty={t("overview.noSavings")} />
      <DonutCard
        title={t("overview.investmentBreakdown")}
        data={investmentData}
        centerLabel={t("overview.invested")}
        empty={t("overview.noInvestments")}
      />
    </div>
  );
}

function DonutCard({
  title,
  data,
  centerLabel,
  empty,
}: {
  title: string;
  data: CategoryDatum[];
  centerLabel: string;
  empty: string;
}) {
  const total = data.reduce((s, d) => s + d.total, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length ? (
          <CategoryDonut data={data} total={total} centerLabel={centerLabel} />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">{empty}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Assets tab ----

function AssetsTab({
  holdings,
  accounts,
  portfolio,
  loading,
}: {
  holdings: Holding[] | undefined;
  accounts: Account[];
  portfolio: Portfolio | undefined;
  loading: boolean;
}) {
  const { t } = useTranslation("wealth");
  const [searchParams, setSearchParams] = useSearchParams();
  const del = useDeleteHolding();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Holding | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Holding | null>(null);
  const [depositTarget, setDepositTarget] = useState<{ holding: Holding; mode: DepositMode } | null>(null);
  const [adoptTarget, setAdoptTarget] = useState<Holding | null>(null);
  const [linkTarget, setLinkTarget] = useState<Holding | null>(null);
  const [undoTarget, setUndoTarget] = useState<Holding | null>(null);
  const [highlightedHoldingId, setHighlightedHoldingId] = useState<string | null>(null);

  // A linked rule lands on its plan card, not directly in an edit dialog. This
  // keeps navigation predictable and leaves edits as an explicit user action.
  useEffect(() => {
    const holdingId = searchParams.get("holding");
    if (!holdingId || !holdings) return;
    const holding = holdings.find((item) => item._id === holdingId);
    if (!holding) return;
    setHighlightedHoldingId(holding._id);
    const next = new URLSearchParams(searchParams);
    next.delete("holding");
    setSearchParams(next, { replace: true });
  }, [holdings, searchParams, setSearchParams]);

  useEffect(() => {
    if (!highlightedHoldingId) return;
    document.getElementById(`holding-${highlightedHoldingId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedHoldingId]);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  async function confirmDelete(h: Holding) {
    try {
      await del.mutateAsync(h._id);
      toast.success(t("assets.deleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.failed"));
      throw e; // keep the dialog open on failure
    }
  }

  const groups: { cls: HoldingClass; items: Holding[] }[] = [
    { cls: "saving", items: (holdings ?? []).filter((h) => h.class === "saving") },
    { cls: "investment", items: (holdings ?? []).filter((h) => h.class === "investment") },
  ];
  const accountsTotal = accounts.reduce((s, a) => s + (a.balance ?? 0), 0);
  const hasHoldings = Boolean(holdings && holdings.length > 0);
  const positions = portfolio?.positions ?? [];

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={openNew}>
          <Plus /> {t("assets.add")}
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (
        <div className="space-y-6">
          {/* Cash accounts — these count toward assets, so surface them here too. */}
          <div>
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{t("assets.cashAccounts")}</h3>
                <Link to="/accounts" className="text-xs font-medium text-primary hover:underline">
                  {t("assets.manage")}
                </Link>
              </div>
              <span className="tnum text-sm text-muted-foreground">{formatMoney(accountsTotal)}</span>
            </div>
            {accounts.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {accounts.map((a) => (
                  <Link key={a._id} to={`/accounts/${a._id}`} className="block">
                    <Card className="transition-colors hover:bg-accent">
                      <CardContent className="flex items-center gap-3 p-4">
                        <CategoryIcon icon={a.icon} color={a.color} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{a.name}</p>
                          <p className="truncate text-xs capitalize text-muted-foreground">{enumLabel("account", a.type)}</p>
                        </div>
                        <span className="tnum text-sm font-semibold">{formatMoney(a.balance ?? 0)}</span>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="px-1 text-sm text-muted-foreground">{t("assets.noAccounts")}</p>
            )}
          </div>

          {/* Stocks — market-priced, so they live on their own page; this is a
              read-only summary so the assets view is complete without it. */}
          {positions.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{t("assets.stocks")}</h3>
                  <Link to="/stocks" className="text-xs font-medium text-primary hover:underline">
                    {t("assets.manage")}
                  </Link>
                </div>
                <span className="tnum text-sm text-muted-foreground">
                  {formatMoney(portfolio?.totals.marketValue ?? 0)}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {positions.map((p) => (
                  <Link key={p.symbol} to="/stocks" className="block">
                    <Card className="transition-colors hover:bg-accent">
                      <CardContent className="flex items-center gap-3 p-4">
                        <CategoryIcon
                          icon={SUBTYPE_META.stocks.icon}
                          color={SUBTYPE_META.stocks.color}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p.ticker}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {t("assets.stockQty", { qty: p.qty })}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="tnum block text-sm font-semibold">
                            {formatMoney(p.marketValue)}
                          </span>
                          <span
                            className={`tnum text-[11px] ${p.unrealized >= 0 ? "text-income" : "text-expense"}`}
                          >
                            {p.unrealized >= 0 ? "+" : "−"}
                            {formatMoney(Math.abs(p.unrealized))}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Holdings — savings & investments */}
          {hasHoldings ? (
            groups.map(
              ({ cls, items }) =>
                items.length > 0 && (
                  <div key={cls}>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <h3 className="text-sm font-semibold">{enumLabel("holdingClass", cls)}</h3>
                      <span className="tnum text-sm text-muted-foreground">
                        {formatMoney(items.reduce((s, h) => s + h.value, 0))}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((h, i) => (
                        <motion.div
                          key={h._id}
                          id={`holding-${h._id}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.2) }}
                        >
                          <Card className={cn(highlightedHoldingId === h._id && "ring-2 ring-primary ring-offset-2 ring-offset-background")}>
                            <CardContent className="flex items-center gap-3 p-4">
                              <CategoryIcon
                                icon={SUBTYPE_META[h.subtype].icon}
                                color={SUBTYPE_META[h.subtype].color}
                                size="md"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{h.name}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {enumLabel("holding", h.subtype)}
                                  {h.provider ? ` · ${h.provider}` : ""}
                                </p>
                                <HoldingGrowthLine holding={h} />
                                {h.subtype === "recurring_deposit" && h.trackedAsGoal && (
                                  <Link
                                    to="/goals"
                                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                                  >
                                    <Target className="h-3 w-3" /> {t("instalment.trackedInGoals")}
                                  </Link>
                                )}
                                <InstalmentLine
                                  holding={h}
                                  onPayout={() => setDepositTarget({ holding: h, mode: "out" })}
                                />
                              </div>
                              <span className="tnum text-sm font-semibold">{formatMoney(h.value)}</span>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon-sm" aria-label={t("assets.actionsAria")}>
                                    <MoreVertical />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {takesDeposits(h) && (
                                    <>
                                      <DropdownMenuItem
                                        onClick={() => setDepositTarget({ holding: h, mode: "in" })}
                                      >
                                        <ArrowDownLeft /> {t("deposit.payIn")}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => setDepositTarget({ holding: h, mode: "out" })}
                                      >
                                        <ArrowUpRight /> {t("deposit.withdraw")}
                                      </DropdownMenuItem>
                                      {/* Only when there's nothing to conflict
                                          with — one rule per deposit. */}
                                      {!h.instalment && SCHEDULABLE_SUBTYPES.includes(h.subtype) && (
                                        <DropdownMenuItem onClick={() => setLinkTarget(h)}>
                                          <Link2 /> {t("linkRule.action")}
                                        </DropdownMenuItem>
                                      )}
                                      {h.subtype === "recurring_deposit" && h.instalment && h.termCount && !h.trackedAsGoal && (
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setEditing(h);
                                            setOpen(true);
                                          }}
                                        >
                                          <Target /> {t("instalment.setUpGoal")}
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem onClick={() => setAdoptTarget(h)}>
                                        <History /> {t("adopt.action")}
                                      </DropdownMenuItem>
                                      {/* Only where there is something to take
                                          back — deposits recorded as deposits
                                          from the start have no prior state. */}
                                      {(h.paid?.imported ?? 0) > 0 && (
                                        <DropdownMenuItem onClick={() => setUndoTarget(h)}>
                                          <Undo2 /> {t("undoImport.action")}
                                        </DropdownMenuItem>
                                      )}
                                    </>
                                  )}
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setEditing(h);
                                      setOpen(true);
                                    }}
                                  >
                                    <Pencil /> {t("actions.edit", { ns: "common" })}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setDeleteTarget(h)}
                                  >
                                    <Trash2 /> {t("actions.delete", { ns: "common" })}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </CardContent>
                          </Card>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )
            )
          ) : (
            <EmptyState
              icon={Landmark}
              title={t("assets.emptyTitle")}
              description={t("assets.emptyDesc")}
              action={
                <Button onClick={openNew}>
                  <Plus /> {t("assets.addHolding")}
                </Button>
              }
            />
          )}
        </div>
      )}

      <HoldingFormDialog open={open} onOpenChange={setOpen} holding={editing} />

      <DepositDialog
        holding={depositTarget?.holding ?? null}
        mode={depositTarget?.mode ?? "in"}
        onClose={() => setDepositTarget(null)}
      />
      <AdoptDepositsDialog holding={adoptTarget} onClose={() => setAdoptTarget(null)} />
      <LinkRuleDialog
        holding={linkTarget}
        onClose={() => setLinkTarget(null)}
        // Linking claims the schedule; the payments it already posted are still
        // expenses until they're imported, so offer that straight away.
        onLinked={(h) => setAdoptTarget(h)}
      />
      <UndoImportDialog holding={undoTarget} onClose={() => setUndoTarget(null)} />

      {deleteTarget && (
        <ConfirmDeleteDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          itemKey="holding"
          confirmValue={deleteTarget.name}
          onConfirm={() => confirmDelete(deleteTarget)}
        />
      )}
    </div>
  );
}

// ---- Liabilities tab ----

function LiabilitiesTab({ loans }: { loans: Loan[] }) {
  const { t } = useTranslation("wealth");
  if (!loans.length) {
    return (
      <EmptyState
        icon={HandCoins}
        title={t("liabilities.emptyTitle")}
        description={t("liabilities.emptyDesc")}
        action={
          <Button asChild>
            <Link to="/loans">
              <Plus /> {t("liabilities.addLoan")}
            </Link>
          </Button>
        }
      />
    );
  }

  const total = loans.reduce((s, l) => s + l.outstanding, 0);
  const byOutstanding = [...loans].sort((a, b) => b.outstanding - a.outstanding);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" asChild>
          <Link to="/loans">
            <HandCoins /> {t("liabilities.manageLoans")}
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("liabilities.outstandingByLoan")}</CardTitle>
          <CardDescription>{t("liabilities.shareDesc", { total: formatMoney(total) })}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3.5">
            {byOutstanding.map((l, i) => {
              const share = total > 0 ? (l.outstanding / total) * 100 : 0;
              const color = CHART_PALETTE[i % CHART_PALETTE.length];
              return (
                <li key={l._id} className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    <CategoryIcon icon={LOAN_TYPE_META[l.type].icon} color={color} size="sm" />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{l.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {enumLabel("loan", l.type)}
                        {l.lender ? ` · ${l.lender}` : ""}
                      </span>
                    </div>
                    <span className="tnum shrink-0 text-xs text-muted-foreground">{Math.round(share)}%</span>
                    <span className="tnum shrink-0 font-semibold">{formatMoney(l.outstanding)}</span>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="h-2 w-full cursor-default overflow-hidden rounded-full bg-secondary"
                        role="progressbar"
                        aria-valuenow={Math.round(share)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={t("liabilities.shareAria", { name: l.name, pct: Math.round(share) })}
                      >
                        <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: color }} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">
                      <p className="font-medium">{l.name}</p>
                      <p className="tnum text-background/80">
                        {t("liabilities.tooltipShare", { amount: formatMoney(l.outstanding), pct: share.toFixed(1), total: formatMoney(total) })}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
