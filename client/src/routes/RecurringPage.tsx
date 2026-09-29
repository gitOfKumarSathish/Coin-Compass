import { useMemo, useState } from "react";
import { format } from "date-fns";
import { motion } from "motion/react";
import {
  AlertTriangle,
  History,
  Landmark,
  MoreVertical,
  Pause,
  Pencil,
  PiggyBank,
  Play,
  Plus,
  Repeat,
  RefreshCw,
  SkipForward,
  Target,
  Trash2,
  TrendingUp,
  UserRound,
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CategoryIcon } from "@/components/common/CategoryIcon";
import { Money } from "@/components/common/Money";
import {
  useDeleteRecurring,
  useRecurring,
  useRunRecurringOne,
  useSkipRecurring,
  useUpdateRecurring,
} from "@/hooks/useRecurring";
import { RecurringFormDialog } from "@/features/recurring/RecurringFormDialog";
import { RecurringOccurrencesDialog } from "@/features/recurring/RecurringOccurrencesDialog";
import { RunDueDialog } from "@/features/recurring/RunDueDialog";
import { isDue, isEnded, monthlyAmount } from "@/lib/recurring";
import { formatMoney } from "@/lib/format";
import { categoryLabel } from "@/lib/i18nLabels";
import { dateFnsLocale } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { Recurring } from "@/lib/types";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";

type OwnershipFilter = "all" | "mine" | "goals" | "assets" | "loans" | "investments";

function matchesOwnership(r: Recurring, filter: OwnershipFilter): boolean {
  if (filter === "all") return true;
  if (filter === "mine") return !r.goal && !r.holding && !r.loan && !r.fund;
  if (filter === "goals") return Boolean(r.goal);
  if (filter === "assets") return Boolean(r.holding);
  if (filter === "loans") return Boolean(r.loan);
  return Boolean(r.fund);
}

/** The color is a quick scan aid; the badge text below carries the meaning. */
function ownershipTone(r: Recurring): string {
  if (r.holding) return "border-l-teal-500";
  if (r.fund) return "border-l-sky-500";
  if (r.goal) return "border-l-violet-500";
  if (r.loan) return "border-l-amber-500";
  return "border-l-slate-400 dark:border-l-slate-500";
}

function refName(ref: Recurring["goal"] | Recurring["loan"] | Recurring["holding"], fallback: string): string {
  return ref && typeof ref === "object" && "name" in ref && ref.name ? ref.name : fallback;
}

function freqLabel(r: Recurring, t: TFunction) {
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.frequency];
  return t(`every.${unit}`, { count: r.interval });
}

/** Human label for a rule — its category (translated), or the note/transfer fallback. */
function ruleName(r: Recurring, t: TFunction) {
  // A deposit rule is named by what it feeds. It carries no category by design
  // — the deposit path discards one — so without this it would show up on the
  // list as an anonymous "Recurring transaction".
  if (r.holding && typeof r.holding === "object" && r.holding.name) return r.holding.name;
  if (r.type === "transfer") return t("txnType.transfer", { ns: "common" });
  return r.category?.name ? categoryLabel(r.category.name) : r.note || t("title.fallback");
}

/** Normalized per-month cash-flow across all active rules, for the overview strip. */
function MonthlySummary({ items }: { items: Recurring[] }) {
  const { t } = useTranslation("recurring");
  const { income, expense, saved } = useMemo(() => {
    let income = 0;
    let expense = 0;
    // Deposit instalments leave the account like any other outgoing, so they
    // belong in the total — but they are not spending, and a page whose whole
    // point is that distinction shouldn't bury them in one number.
    let saved = 0;
    for (const r of items) {
      if (!r.active) continue;
      if (r.type === "income") income += monthlyAmount(r);
      else if (r.type === "expense") {
        expense += monthlyAmount(r);
        if (r.holding) saved += monthlyAmount(r);
      }
    }
    return { income, expense, saved };
  }, [items]);

  if (income === 0 && expense === 0) return null;
  const net = income - expense;

  return (
    <Card className="mb-4">
      <CardContent className="grid grid-cols-3 divide-x p-0 text-center">
        <div className="p-3">
          <p className="text-xs text-muted-foreground">{t("summary.income")}</p>
          <p className="mt-0.5 font-semibold tnum text-income">+{formatMoney(income)}</p>
        </div>
        <div className="p-3">
          <p className="text-xs text-muted-foreground">{t("summary.expenses")}</p>
          <p className="mt-0.5 font-semibold tnum text-expense">−{formatMoney(expense)}</p>
          {saved > 0 && (
            <p className="tnum mt-0.5 text-[11px] text-muted-foreground">
              {t("summary.ofWhichSaved", { amount: formatMoney(saved) })}
            </p>
          )}
        </div>
        <div className="p-3">
          <p className="text-xs text-muted-foreground">{t("summary.net")}</p>
          <p
            className={`mt-0.5 font-semibold tnum ${
              net > 0 ? "text-income" : net < 0 ? "text-expense" : "text-muted-foreground"
            }`}
          >
            {formatMoney(net, { signed: true })}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RecurringPage() {
  const { t } = useTranslation("recurring");
  const navigate = useNavigate();
  const { data: items, isLoading } = useRecurring();
  const del = useDeleteRecurring();
  const update = useUpdateRecurring();
  const runOne = useRunRecurringOne();
  const skip = useSkipRecurring();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [historyFor, setHistoryFor] = useState<Recurring | null>(null);
  const [runDueOpen, setRunDueOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Recurring | null>(null);
  const [pausePlanTarget, setPausePlanTarget] = useState<Recurring | null>(null);
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>("all");

  async function confirmDelete(r: Recurring) {
    try {
      await del.mutateAsync(r._id);
      toast.success(t("toast.deleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.deleteFailed"));
      throw e; // keep the confirm dialog open on failure
    }
  }

  const dueCount = useMemo(() => (items ?? []).filter((r) => isDue(r)).length, [items]);
  const visibleItems = useMemo(
    () => (items ?? []).filter((r) => matchesOwnership(r, ownershipFilter)),
    [items, ownershipFilter]
  );
  const ownershipFilters: { value: OwnershipFilter; label: string }[] = [
    { value: "all", label: t("filters.all") },
    { value: "mine", label: t("filters.mine") },
    { value: "goals", label: t("filters.goals") },
    { value: "assets", label: t("filters.assets") },
    { value: "loans", label: t("filters.loans") },
    { value: "investments", label: t("filters.investments") },
  ];

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(r: Recurring) {
    setEditing(r);
    setDialogOpen(true);
  }

  async function runOneNow(r: Recurring) {
    const res = await runOne.mutateAsync(r._id);
    toast.success(
      res.created ? t("toast.posted", { count: res.created }) : t("toast.nothingDueRule")
    );
  }

  async function skipNext(r: Recurring) {
    await skip.mutateAsync(r._id);
    toast.success(t("toast.skipped"));
  }

  function openSavingsPlan(r: Recurring) {
    const holdingId = r.holding && typeof r.holding === "object" ? r.holding._id : r.holding;
    if (!holdingId) return;
    navigate(`/net-worth?tab=assets&holding=${holdingId}`);
  }

  async function confirmPausePlan() {
    if (!pausePlanTarget) return;
    await update.mutateAsync({ id: pausePlanTarget._id, active: false });
    setPausePlanTarget(null);
    toast.success(t("toast.pausedPlan"));
  }

  return (
    <div>
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRunDueOpen(true)} disabled={!items?.length}>
              <RefreshCw /> {t("page.runDue")}
              {dueCount > 0 && (
                <Badge variant="warning" className="ml-1 px-1.5">
                  {dueCount}
                </Badge>
              )}
            </Button>
            <Button onClick={openNew}>
              <Plus /> {t("page.newRule")}
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : items && items.length > 0 ? (
        <>
          <MonthlySummary items={items} />
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar" aria-label={t("filters.label")}>
            {ownershipFilters.map((filter) => (
              <Button
                key={filter.value}
                type="button"
                size="sm"
                variant={ownershipFilter === filter.value ? "secondary" : "outline"}
                className="shrink-0"
                aria-pressed={ownershipFilter === filter.value}
                onClick={() => setOwnershipFilter(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </div>
          <div className="space-y-3">
            {visibleItems.map((r, i) => {
              const overdue = isDue(r) && new Date(r.nextRun) < new Date();
              const ended = isEnded(r);
              // Surface the note so same-category rules stay distinguishable — but not
              // when it's already the title (no category) or just echoes the category.
              const note = r.note?.trim();
              const paysDeposit = Boolean(r.holding);
              const isMine = !r.goal && !r.holding && !r.loan && !r.fund;
              const titleIsNote = r.type !== "transfer" && !r.category?.name;
              const noteEchoesCategory =
                note && r.category?.name && note.toLowerCase() === r.category.name.toLowerCase();
              const detailNote = note && !titleIsNote && !noteEchoesCategory ? note : "";
              return (
              <motion.div
                key={r._id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.04, 0.3) }}
              >
                <Card className={cn("overflow-hidden border-l-4", ownershipTone(r), !r.active && "opacity-70")}>
                  <CardContent className="flex items-center gap-4 p-4">
                    {/* A deposit rule has no category to draw from, and the
                        generic fallback made it look like an uncategorised
                        spend — the one thing it isn't. */}
                    <CategoryIcon
                      icon={paysDeposit ? "piggy-bank" : r.type === "transfer" ? "repeat" : r.category?.icon}
                      color={paysDeposit ? "#14B8A6" : r.type === "transfer" ? "#3B82F6" : r.category?.color}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{ruleName(r, t)}</p>
                        {overdue && <Badge variant="warning">{t("badges.overdue")}</Badge>}
                        {ended && <Badge variant="secondary">{t("badges.ended")}</Badge>}
                        {!r.active && !ended && <Badge variant="secondary">{t("badges.paused")}</Badge>}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {freqLabel(r, t)} · {r.account?.name}
                        {detailNote ? ` · ${detailNote}` : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {isMine && (
                          <Badge variant="secondary" className="gap-1 text-muted-foreground">
                            <UserRound className="h-3 w-3" /> {t("links.mine")}
                          </Badge>
                        )}
                        {r.goal && (
                          <Badge className="gap-1 border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300">
                            <Target className="h-3 w-3" /> {t("links.goal", { name: refName(r.goal, t("links.unnamed")) })}
                          </Badge>
                        )}
                        {r.holding && (
                          <Badge className="gap-1 border-teal-500/20 bg-teal-500/10 text-teal-700 dark:text-teal-300">
                            <PiggyBank className="h-3 w-3" /> {t("links.asset", { name: refName(r.holding, t("links.unnamed")) })}
                          </Badge>
                        )}
                        {r.loan && (
                          <Badge className="gap-1 border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                            <Landmark className="h-3 w-3" /> {t("links.loan", { name: refName(r.loan, t("links.unnamed")) })}
                          </Badge>
                        )}
                        {r.fund && (
                          <Badge className="gap-1 border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300">
                            <TrendingUp className="h-3 w-3" /> {t("links.sip", { name: r.payee || r.fund })}
                          </Badge>
                        )}
                      </div>
                      <p className={`mt-0.5 truncate text-xs ${overdue ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"}`}>
                        {ended
                          ? t("status.ended", { date: format(new Date(r.endDate as string), "dd MMM yyyy", { locale: dateFnsLocale() }) })
                          : !r.active
                            ? t("status.paused")
                            : overdue
                              ? t("status.overdueSince", { date: format(new Date(r.nextRun), "dd MMM yyyy", { locale: dateFnsLocale() }) })
                              : t("status.next", { date: format(new Date(r.nextRun), "dd MMM yyyy", { locale: dateFnsLocale() }) })}
                        {r.active && !overdue && r.endDate
                          ? t("status.endsSuffix", { date: format(new Date(r.endDate), "dd MMM yyyy", { locale: dateFnsLocale() }) })
                          : ""}
                        {r.lastRun ? t("status.lastPostedSuffix", { date: format(new Date(r.lastRun), "dd MMM", { locale: dateFnsLocale() }) }) : ""}
                      </p>
                    </div>
                    <Money amount={r.amount} type={r.type} signed className="text-sm" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={t("page.actionsAria")}>
                          <MoreVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {paysDeposit ? (
                          <DropdownMenuItem onClick={() => openSavingsPlan(r)}>
                            <PiggyBank /> {t("menu.openSavingsPlan")}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => openEdit(r)}>
                            <Pencil /> {t("actions.edit", { ns: "common" })}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => runOneNow(r)} disabled={runOne.isPending}>
                          <Zap /> {t("menu.runNow")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => skipNext(r)} disabled={skip.isPending}>
                          <SkipForward /> {t("menu.skipNext")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => (paysDeposit && r.active ? setPausePlanTarget(r) : update.mutate({ id: r._id, active: !r.active }))}
                        >
                          {r.active ? <Pause /> : <Play />} {r.active ? t("menu.pause") : t("menu.resume")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setHistoryFor(r)}>
                          <History /> {t("menu.viewPosted")}
                        </DropdownMenuItem>
                        {!paysDeposit && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteTarget(r)}
                            >
                              <Trash2 /> {t("actions.delete", { ns: "common" })}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardContent>
                </Card>
              </motion.div>
              );
            })}
            {visibleItems.length === 0 && (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t("filters.empty")}
              </div>
            )}
          </div>
        </>
      ) : (
        <EmptyState
          icon={Repeat}
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Button onClick={openNew}>
              <Plus /> {t("empty.action")}
            </Button>
          }
        />
      )}

      <RunDueDialog open={runDueOpen} onOpenChange={setRunDueOpen} rules={items} />
      <RecurringFormDialog open={dialogOpen} onOpenChange={setDialogOpen} recurring={editing} />
      <RecurringOccurrencesDialog
        open={Boolean(historyFor)}
        onOpenChange={(o) => !o && setHistoryFor(null)}
        recurring={historyFor}
      />
      <Dialog open={Boolean(pausePlanTarget)} onOpenChange={(open) => !open && setPausePlanTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" /> {t("planSafety.pauseTitle")}
            </DialogTitle>
            <DialogDescription>
              {pausePlanTarget && t("planSafety.pauseDescription", { name: ruleName(pausePlanTarget, t) })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPausePlanTarget(null)}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button variant="outline" onClick={confirmPausePlan} disabled={update.isPending}>
              <Pause /> {t("planSafety.pauseConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {deleteTarget && (
        <ConfirmDeleteDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          itemKey="recurring"
          confirmValue={String(deleteTarget.amount)}
          onConfirm={() => confirmDelete(deleteTarget)}
        />
      )}
    </div>
  );
}
