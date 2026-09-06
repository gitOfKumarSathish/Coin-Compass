import { Schema, model, type InferSchemaType } from "mongoose";

/**
 * In-app notification. Stored structurally (a `type` + `params`) rather than as
 * baked English so the client renders the title/body in the active language,
 * mirroring how server error `code`s are translated. Persists until the user
 * marks it read or clears it.
 */
export const NOTIFICATION_TYPES = [
  "recurring.posted", // an auto-posting rule materialized one or more transactions
  "recurring.ended", // a rule reached its end date and deactivated
  "recurring.due_soon", // an active rule is about to post (within the reminder window)
  "recurring.overdue", // an active rule is past its run date and hasn't posted
  "budget.exceeded", // spend in a budget's period passed its limit
  "balance.low", // a (non-card) account balance went negative
  "goal.cycle_rolled", // a repeating goal finished a cycle and started the next
  "goal.behind", // at its current funding, a goal won't reach its target date
  "goal.achieved", // a goal reached its target
  "deposit.matured", // an FD/RD reached its maturity date or served its full term
] as const;

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    // Interpolation values for the client i18n templates (count, amount, currency,
    // ruleTitle, date, category, account, balance, …). Numbers stay raw so the
    // client can currency-format them with the user's settings.
    params: { type: Schema.Types.Mixed, default: {} },
    // Client-side deep link the row navigates to, e.g. "/recurring", "/budgets".
    link: { type: String, default: null },
    // Optional back-reference for future filtering / navigation.
    recurring: { type: Schema.Types.ObjectId, ref: "RecurringTransaction", default: null },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
    // Idempotency key so a repeated sweep (or boot+hourly cron) never re-creates
    // the same reminder. Null for one-off events that are naturally unique.
    dedupeKey: { type: String, default: null },
  },
  { timestamps: true }
);

// Upsert path for deduped reminders: one row per (user, dedupeKey).
notificationSchema.index({ user: 1, dedupeKey: 1 });
// Fast newest-first listing per user.
notificationSchema.index({ user: 1, createdAt: -1 });

export type NotificationDoc = InferSchemaType<typeof notificationSchema>;
export const Notification = model("Notification", notificationSchema);
