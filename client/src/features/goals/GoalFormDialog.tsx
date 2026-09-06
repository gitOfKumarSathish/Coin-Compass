import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/common/AmountInput";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/common/ColorPicker";
import { IconPicker } from "@/components/common/IconPicker";
import { RecordMeta } from "@/components/common/RecordMeta";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateGoal, useUpdateGoal, useGoals } from "@/hooks/useGoals";
import { useAccounts } from "@/hooks/useAccounts";
import { fundingAccounts } from "@/lib/accounts";
import { useHoldings } from "@/hooks/useHoldings";
import { useCanSeeWealth } from "@/hooks/useAuth";
import { useSettings } from "@/hooks/useSettings";
import { GOAL_REPEATS, type Goal, type GoalRepeat, type RefLite } from "@/lib/types";

function refId(v: RefLite | string | null | undefined): string {
  return typeof v === "string" ? v : v?._id ?? "";
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  goal?: Goal | null;
}

/** Sentinel for "no wallet" — Radix Select can't hold an empty string value. */
const NO_ACCOUNT = "__none__";

export function GoalFormDialog({ open, onOpenChange, goal }: Props) {
  const { t } = useTranslation("planning");
  const { data: settings } = useSettings();
  const { data: accounts } = useAccounts();
  // Behind the wealth lock, so an everyday session simply sees no deposits to
  // link rather than a request that 403s.
  const canSeeWealth = useCanSeeWealth();
  const { data: holdings } = useHoldings({ enabled: canSeeWealth });
  const { data: goals } = useGoals();
  const create = useCreateGoal();
  const update = useUpdateGoal();
  const isEdit = Boolean(goal);

  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [savedAmount, setSavedAmount] = useState("0");
  const [monthlyContribution, setMonthlyContribution] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [color, setColor] = useState("#6366F1");
  const [icon, setIcon] = useState("goal");
  const [linkedAccount, setLinkedAccount] = useState(NO_ACCOUNT);
  const [linkedHolding, setLinkedHolding] = useState(NO_ACCOUNT);
  const [repeat, setRepeat] = useState<GoalRepeat>("none");
  const trackingAccount = linkedAccount !== NO_ACCOUNT;
  const trackingHolding = linkedHolding !== NO_ACCOUNT;
  // Either source supplies the saved figure, so the manual field goes away.
  const linked = trackingAccount || trackingHolding;

  useEffect(() => {
    if (!open) return;
    setName(goal?.name ?? "");
    setTargetAmount(goal ? String(goal.targetAmount) : "");
    setSavedAmount(String(goal?.savedAmount ?? 0));
    setMonthlyContribution(goal?.monthlyContribution ? String(goal.monthlyContribution) : "");
    setTargetDate(goal?.targetDate ? goal.targetDate.slice(0, 10) : "");
    setColor(goal?.color ?? "#6366F1");
    setIcon(goal?.icon ?? "goal");
    setLinkedAccount(refId(goal?.linkedAccount) || NO_ACCOUNT);
    setLinkedHolding(refId(goal?.linkedHolding) || NO_ACCOUNT);
    setRepeat(goal?.repeat ?? "none");
  }, [open, goal]);

  /** Which wallet each OTHER goal already tracks — one account funds one goal. */
  const takenBy = new Map<string, string>();
  /** And the same for deposits, for the same reason. */
  const depositTakenBy = new Map<string, string>();
  for (const g of goals ?? []) {
    if (g._id === goal?._id) continue;
    const id = refId(g.linkedAccount);
    if (id) takenBy.set(id, g.name);
    const hid = refId(g.linkedHolding);
    if (hid) depositTakenBy.set(hid, g.name);
  }

  /**
   * Deposits a goal can read. Stocks and funds are valued from their lots by
   * their own pages, so a goal reading one would be reading a market price
   * rather than money someone set aside.
   */
  // The app's own buckets aren't places money is set aside — Savings & Deposits
  // holds every deposit's principal at once — and the API refuses them.
  const payFrom = fundingAccounts(accounts);

  const linkableHoldings = (holdings ?? []).filter(
    (h) => h.subtype !== "stocks" && h.subtype !== "mutual_funds"
  );

  async function submit() {
    if (!name.trim()) return toast.error(t("goalForm.enterName"));
    const target = Number(targetAmount) || 0;
    if (target <= 0) return toast.error(t("goalForm.enterTarget"));

    const payload = {
      name: name.trim(),
      targetAmount: target,
      // A tracked wallet supplies the saved figure; sending one would be ignored.
      savedAmount: linked ? undefined : Number(savedAmount) || 0,
      linkedAccount: trackingAccount ? linkedAccount : null,
      linkedHolding: trackingHolding ? linkedHolding : null,
      repeat,
      monthlyContribution: Number(monthlyContribution) || 0,
      targetDate: targetDate ? new Date(targetDate).toISOString() : null,
      color,
      icon,
      currency: settings?.baseCurrency ?? "INR",
    };
    try {
      if (isEdit && goal) {
        await update.mutateAsync({ id: goal._id, ...payload });
        toast.success(t("goalForm.updated"));
      } else {
        await create.mutateAsync(payload);
        toast.success(t("goalForm.created"));
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("goalForm.saveFailed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("goalForm.editTitle") : t("goalForm.newTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">{t("labels.name", { ns: "common" })}</Label>
            <Input
              id="goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("goalForm.namePlaceholder")}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="goal-target">{t("goalForm.targetAmount")}</Label>
              <AmountInput
                id="goal-target"
                value={targetAmount}
                onChange={setTargetAmount}
                placeholder="80,000"
              />
            </div>
            {/* A tracked wallet supplies this figure, so editing it by hand would
                only be overwritten by the next balance read. */}
            {!linked && (
              <div className="space-y-1.5">
                <Label htmlFor="goal-saved">{t("goalForm.savedSoFar")}</Label>
                <AmountInput
                  id="goal-saved"
                  value={savedAmount}
                  onChange={setSavedAmount}
                />
              </div>
            )}
          </div>

          {/* Track a wallet: progress becomes that account's live balance, so
              every deposit counts without recording anything on the goal. */}
          <div className="space-y-1.5">
            <Label htmlFor="goal-account">{t("goalForm.trackAccount")}</Label>
            <Select
              value={linkedAccount}
              onValueChange={(v) => {
                setLinkedAccount(v);
                if (v !== NO_ACCOUNT) setLinkedHolding(NO_ACCOUNT);
              }}
            >
              <SelectTrigger id="goal-account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ACCOUNT}>{t("goalForm.noAccount")}</SelectItem>
                {payFrom.map((a) => (
                  <SelectItem key={a._id} value={a._id} disabled={takenBy.has(a._id)}>
                    {takenBy.has(a._id)
                      ? t("goalForm.accountTaken", { name: a.name, goal: takenBy.get(a._id) })
                      : a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {linked ? t("goalForm.trackAccountOnHint") : t("goalForm.trackAccountHint")}
            </p>
          </div>
          {/* Track a deposit instead: an RD already has a target, a deadline and
              progress, and plenty of people were running one as a plain goal
              long before the deposit could hold it. Linking hands the arithmetic
              over without them having to start again. */}
          {linkableHoldings.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="goal-holding">{t("goalForm.trackDeposit")}</Label>
              <Select
                value={linkedHolding}
                onValueChange={(v) => {
                  setLinkedHolding(v);
                  // One source only — two would be two answers to one question.
                  if (v !== NO_ACCOUNT) setLinkedAccount(NO_ACCOUNT);
                }}
              >
                <SelectTrigger id="goal-holding">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACCOUNT}>{t("goalForm.noDeposit")}</SelectItem>
                  {linkableHoldings.map((h) => (
                    <SelectItem key={h._id} value={h._id} disabled={depositTakenBy.has(h._id)}>
                      {depositTakenBy.has(h._id)
                        ? t("goalForm.depositTaken", { name: h.name, goal: depositTakenBy.get(h._id) })
                        : h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {trackingHolding ? t("goalForm.trackDepositOnHint") : t("goalForm.trackDepositHint")}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="goal-monthly">{t("goalForm.monthlySaving")}</Label>
              <AmountInput
                id="goal-monthly"
                value={monthlyContribution}
                onChange={setMonthlyContribution}
                placeholder={t("labels.optional", { ns: "common" })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-date">{t("goalForm.targetDate")}</Label>
              <Input
                id="goal-date"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
          </div>

          {/* One-time goals finish. A repeating one is a sinking fund: it starts
              again on its due date, which is why the date matters here. */}
          <div className="space-y-1.5">
            <Label htmlFor="goal-repeat">{t("goalForm.repeat")}</Label>
            <Select value={repeat} onValueChange={(v) => setRepeat(v as GoalRepeat)}>
              <SelectTrigger id="goal-repeat">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOAL_REPEATS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`goalForm.repeats.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {repeat === "none"
                ? t("goalForm.repeatHintNone")
                : targetDate
                  ? t("goalForm.repeatHint")
                  : t("goalForm.repeatNeedsDate")}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("goalForm.monthlyHint")}
          </p>
          <div className="space-y-1.5">
            <Label>{t("labels.color", { ns: "common" })}</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("labels.icon", { ns: "common" })}</Label>
            <IconPicker value={icon} color={color} onChange={setIcon} />
          </div>
          {isEdit && goal && <RecordMeta createdAt={goal.createdAt} updatedAt={goal.updatedAt} />}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <Button onClick={submit} disabled={create.isPending || update.isPending}>
            {isEdit ? t("actions.save", { ns: "common" }) : t("actions.create", { ns: "common" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
