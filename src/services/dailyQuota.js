import DailyQuota from "../models/DailyQuota.js";
import AppError from "../utils/AppError.js";

/**
 * Hard daily budgets for the whole service (all users together), kept as
 * constants on purpose. They protect the Gmail account used by nodemailer:
 * Google caps what a Gmail account may send per day, and the sign-up cap keeps
 * a burst of registrations from spending the mail budget.
 */
export const DAILY_MAIL_LIMIT = 25 + 1;
export const DAILY_SIGNUP_LIMIT = 25;

export const MAIL_FULL_MESSAGE =
  "ظرفیت ارسال ایمیل امروز تکمیل شده است. لطفاً فردا دوباره تلاش کنید";
export const SIGNUP_FULL_MESSAGE = `ظرفیت ثبت‌نام امروز (${DAILY_SIGNUP_LIMIT} نفر) تکمیل شده است. لطفاً فردا دوباره تلاش کنید`;

const TZ =
  process.env.QUOTA_TIMEZONE ||
  process.env.MAIL_QUOTA_TIMEZONE ||
  "Asia/Tehran";
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day a moment belongs to, e.g. "2026-10-12". */
export const dayKey = (now = new Date(), timeZone = TZ) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

/** Seconds until the next calendar day starts in the quota timezone (for Retry-After). */
export const secondsUntilTomorrow = (now = new Date(), timeZone = TZ) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .reduce((o, p) => ({ ...o, [p.type]: Number(p.value) }), {});
  const elapsed = parts.hour * 3600 + parts.minute * 60 + parts.second;
  return Math.max(1, DAY_MS / 1000 - elapsed);
};

/** MongoDB store for one kind of counter. Each operation is a single atomic statement. */
export const mongoStore = (kind) => ({
  /** Adds one if (and only if) the day is below `limit`. Returns the new count, or null when full. */
  async tryIncrement(day, limit, now = new Date()) {
    try {
      const doc = await DailyQuota.findOneAndUpdate(
        { kind, day, count: { $lt: limit } },
        {
          $inc: { count: 1 },
          $setOnInsert: { expireAt: new Date(now.getTime() + KEEP_MS) },
        },
        { upsert: true, returnDocument: "after" },
      );
      return doc.count;
    } catch (err) {
      // the day's document exists but is at the limit: the upsert tried to insert a second one
      if (err?.code === 11000) return null;
      throw err;
    }
  },
  async decrement(day) {
    await DailyQuota.updateOne(
      { kind, day, count: { $gt: 0 } },
      { $inc: { count: -1 } },
    );
  },
  async used(day) {
    return (
      (await DailyQuota.findOne({ kind, day }).select("count").lean())?.count ||
      0
    );
  },
});

/** The quota rules on top of a store (swappable, so they can be tested without a database). */
export const createQuota = ({
  kind,
  limit,
  message,
  store = mongoStore(kind),
  now = () => new Date(),
}) => ({
  limit,
  message,
  /** Takes one slot of today's budget, or returns null when it is used up. */
  async reserve() {
    const at = now();
    const day = dayKey(at);
    const count = await store.tryIncrement(day, limit, at);
    return count === null ? null : { day, count };
  },
  /** Gives a slot back (the action failed, so it must not eat the budget). */
  async release(slot) {
    if (slot) await store.decrement(slot.day);
  },
  async status() {
    const used = await store.used(dayKey(now()));
    return { used, limit, remaining: Math.max(0, limit - used) };
  },
  /** Cheap check without reserving anything. */
  async assertAvailable() {
    const { remaining } = await this.status();
    if (remaining <= 0) throw this.fullError();
  },
  fullError() {
    const err = new AppError(message, 429, true);
    err.retryAfter = secondsUntilTomorrow(now());
    return err;
  },
});

export const mailQuota = createQuota({
  kind: "mail",
  limit: DAILY_MAIL_LIMIT,
  message: MAIL_FULL_MESSAGE,
});
export const signupQuota = createQuota({
  kind: "signup",
  limit: DAILY_SIGNUP_LIMIT,
  message: SIGNUP_FULL_MESSAGE,
});
