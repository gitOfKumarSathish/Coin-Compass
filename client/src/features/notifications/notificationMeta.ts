import {
  Repeat,
  CircleOff,
  CalendarClock,
  AlertTriangle,
  PiggyBank,
  RefreshCw,
  Target,
  TrendingDown,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import type { TFunction } from "i18next";
import { formatMoney } from "@/lib/format";
import { fmtDate, dateFnsLocale } from "@/lib/dates";
import type { AppNotification, NotificationType } from "@/lib/types";

type Tone = "primary" | "warning" | "expense" | "income";

/** Icon + accent tone for each notification type. */
export const NOTIFICATION_META: Record<NotificationType, { icon: LucideIcon; tone: Tone }> = {
  "recurring.posted": { icon: Repeat, tone: "income" },
  "recurring.ended": { icon: CircleOff, tone: "primary" },
  "recurring.due_soon": { icon: CalendarClock, tone: "primary" },
  "recurring.overdue": { icon: AlertTriangle, tone: "warning" },
  "budget.exceeded": { icon: Target, tone: "expense" },
  "balance.low": { icon: Wallet, tone: "warning" },
  // The goal pair predate this map and never reached it, so both fell through to
  // the generic bell — the icon that says "something happened" about the two
  // notifications with the most to say.
  "goal.cycle_rolled": { icon: RefreshCw, tone: "primary" },
  "goal.behind": { icon: TrendingDown, tone: "warning" },
  "goal.achieved": { icon: Trophy, tone: "income" },
  "deposit.matured": { icon: PiggyBank, tone: "income" },
};

const TONE_CLASS: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
  expense: "bg-expense/10 text-expense",
  income: "bg-income/10 text-income",
};

export function notificationToneClass(type: NotificationType): string {
  return TONE_CLASS[NOTIFICATION_META[type]?.tone ?? "primary"];
}

/**
 * Localized title + body for a notification. Numeric params (amount/spent/balance)
 * are currency-formatted with the user's settings here so the copy matches the
 * rest of the app; the plural `count` drives i18n pluralization on posted.
 */
export function notificationText(
  t: TFunction,
  n: AppNotification
): { title: string; body: string } {
  const p = n.params ?? {};
  const currency = typeof p.currency === "string" ? p.currency : undefined;
  const money = (v: unknown) => (typeof v === "number" ? formatMoney(v, { currency }) : "");
  const params = {
    ...p,
    count: typeof p.count === "number" ? p.count : undefined,
    amount: money(p.amount),
    spent: money(p.spent),
    balance: money(p.balance),
    date: typeof p.date === "string" ? fmtDate(p.date) : "",
  };
  return {
    title: t(`notifications:types.${n.type}.title`),
    body: t(`notifications:types.${n.type}.body`, params),
  };
}

/** Locale-aware "3 hours ago" style timestamp. */
export function relativeTime(iso: string): string {
  return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: dateFnsLocale() });
}
