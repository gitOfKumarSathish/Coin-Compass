import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AmountInput } from "@/components/common/AmountInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccounts } from "@/hooks/useAccounts";
import { fundingAccounts } from "@/lib/accounts";
import { dateFnsLocale } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { CADENCES, lastInstalment, type CadenceKey } from "@/lib/instalments";
import { cn } from "@/lib/utils";

/** Select needs a non-empty value for "decide later". */
const NO_PAYOUT = "__none__";

/**
 * The standing order that feeds a deposit, asked for on the deposit itself.
 *
 * Everything here is something the user has an opinion about: how much, from
 * where, how often, starting when. The recurring rule this builds also has a
 * type, a category and a destination account — all three are overridden when the
 * instalment posts, so asking for them would be asking for a decision with no
 * consequence. That was the old flow, and it read as three screens of noise.
 */

/** dd MMM yyyy, in the user's language — the same shape the Recurring page uses. */
const fmt = (iso: string) => format(new Date(iso), "dd MMM yyyy", { locale: dateFnsLocale() });

/** Terms people actually take, as one-tap chips. Any number is still allowed. */
const TERM_PRESETS = [6, 12, 24, 36];

export interface InstalmentState {
  on: boolean;
  amount: string;
  account: string;
  cadence: CadenceKey;
  startDate: string;
  /** How many instalments in all. Required for an RD — that's what an RD is. */
  termCount: string;
  /** Where the maturity payout lands. */
  payoutAccount: string;
}

export function InstalmentFields({
  state,
  onChange,
  /** The deposit's maturity date, used when there is no fixed term. */
  maturityDate,
  /** When the schedule already exists, the date the next instalment is due. */
  nextRun,
  /** Whether a standing order makes sense here at all — an FD is a lump sum. */
  schedulable = true,
  /** A recurring deposit runs for an agreed number of payments; others needn't. */
  needsTerm = false,
  /** An RD is a savings plan, so its automatic instalment is required. */
  required = false,
  /** Deposits that mature, and so have a payout to send somewhere. */
  matures = false,
}: {
  state: InstalmentState;
  onChange: (next: InstalmentState) => void;
  maturityDate?: string;
  nextRun?: string | null;
  schedulable?: boolean;
  needsTerm?: boolean;
  required?: boolean;
  matures?: boolean;
}) {
  const { t } = useTranslation("wealth");
  const { data: accounts } = useAccounts();
  const options = fundingAccounts(accounts);
  const set = (patch: Partial<InstalmentState>) => onChange({ ...state, ...patch });

  const accountName = options.find((a) => a._id === state.account)?.name;
  const amountNum = Number(state.amount) || 0;
  const term = Number(state.termCount) || 0;
  const scheduleEnabled = required || state.on;
  // The last instalment, so the form can say when this finishes rather than
  // leaving the user to count twelve months forward in their head.
  const lastDue = term > 0 && state.startDate ? lastInstalment(state.startDate, state.cadence, term) : null;

  const payoutField = matures ? (
    <div className="space-y-1.5">
      <Label>{t("instalment.payoutTo")}</Label>
      <Select
        value={state.payoutAccount || NO_PAYOUT}
        onValueChange={(v) => set({ payoutAccount: v === NO_PAYOUT ? "" : v })}
      >
        <SelectTrigger id="inst-payout">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_PAYOUT}>{t("instalment.payoutLater")}</SelectItem>
          {options.map((a) => (
            <SelectItem key={a._id} value={a._id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ) : null;

  // A lump-sum deposit has no schedule to describe, but it still matures, and
  // where the payout lands is worth settling now rather than at the counter.
  if (!schedulable) {
    return payoutField && <div className="rounded-lg border p-3">{payoutField}</div>;
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("instalment.title")}</p>
          <p className="text-xs text-muted-foreground">{t("instalment.subtitle")}</p>
        </div>
        {!required && (
          <Switch
            checked={state.on}
            onCheckedChange={(on) => set({ on })}
            aria-label={t("instalment.title")}
          />
        )}
      </div>

      {scheduleEnabled && (
        <div className="space-y-3 border-t pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inst-amount">{t("instalment.amount")}</Label>
              <AmountInput
                id="inst-amount"
                value={state.amount}
                onChange={(v) => set({ amount: v })}
                placeholder="1,000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("instalment.from")}</Label>
              <Select value={state.account} onValueChange={(v) => set({ account: v })}>
                <SelectTrigger id="inst-account">
                  <SelectValue placeholder={t("instalment.pickAccount")} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((a) => (
                    <SelectItem key={a._id} value={a._id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("instalment.every")}</Label>
              <Select
                value={state.cadence}
                onValueChange={(v) => set({ cadence: v as CadenceKey })}
              >
                <SelectTrigger id="inst-cadence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CADENCES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {t(`instalment.cadence.${c.key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inst-start">{t("instalment.starting")}</Label>
              <Input
                id="inst-start"
                type="date"
                value={state.startDate}
                onChange={(e) => set({ startDate: e.target.value })}
              />
            </div>
          </div>

          {needsTerm && (
            <div className="space-y-1.5">
              <Label htmlFor="inst-term">{t("instalment.term")}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="inst-term"
                  inputMode="numeric"
                  className="w-24"
                  value={state.termCount}
                  onChange={(e) => set({ termCount: e.target.value.replace(/[^0-9]/g, "") })}
                  placeholder="12"
                />
                {/* Starting points, not rules — banks offer whatever they offer. */}
                {TERM_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => set({ termCount: String(n) })}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-accent",
                      Number(state.termCount) === n && "border-primary bg-primary/10 text-primary"
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t("instalment.termHint")}</p>
            </div>
          )}

          {payoutField}

          {/* An RD with a term already has a target, deadline, and progress.
              The app presents that one plan in Goals automatically. */}
          {needsTerm && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-sm font-medium">{t("instalment.goalCreated")}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {term > 0 && amountNum > 0
                  ? t("instalment.goalCreatedDetail", {
                      target: formatMoney(term * amountNum),
                      date: lastDue ? fmt(lastDue.toISOString()) : "",
                    })
                  : t("instalment.goalCreatedHint")}
              </p>
            </div>
          )}

          {/* What will actually happen, in a sentence — because the mechanism
              (a transfer into an app-managed bucket) is not worth explaining,
              but the outcome is. */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {accountName && Number(state.amount) > 0
              ? t("instalment.preview", {
                  amount: formatMoney(Number(state.amount)),
                  account: accountName,
                  every: t(`instalment.cadenceLower.${state.cadence}`),
                })
              : t("instalment.previewIncomplete")}
            {term > 0 && amountNum > 0
              ? ` ${t("instalment.termTotal", {
                  count: term,
                  total: formatMoney(term * amountNum),
                  date: lastDue ? fmt(lastDue.toISOString()) : "",
                })}`
              : maturityDate
                ? ` ${t("instalment.until", { date: fmt(maturityDate) })}`
                : ""}
          </p>
          {nextRun && (
            <p className="text-xs text-muted-foreground">
              {t("instalment.nextDue", { date: fmt(nextRun) })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
