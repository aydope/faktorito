import Member from "../models/Member.js";
import Plan from "../models/Plan.js";
import Invoice from "../models/Invoice.js";
import AutoInvoice from "../models/AutoInvoice.js";
import Announcement from "../models/Announcement.js";
import AppError from "../utils/AppError.js";
import { LIMITS, LIMIT_LABELS, limitMessage } from "../config/limits.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const dayAgo = () => new Date(Date.now() - DAY_MS);

/**
 * How each limit is measured. EVERY key of LIMITS needs a counter here: the
 * settings page lists them all, and a missing one used to crash it (the unit
 * test "every limit has a counter" keeps the two in sync).
 */
export const USAGE_COUNTERS = Object.freeze({
  members: (userId) => Member.countDocuments({ user: userId }),
  plans: (userId) => Plan.countDocuments({ user: userId }),
  invoicesPerDay: (userId, since) =>
    Invoice.countDocuments({ user: userId, createdAt: { $gte: since } }),
  unpaidInvoices: (userId) =>
    Invoice.countDocuments({ user: userId, isPaid: false }),
  autoRules: (userId) =>
    AutoInvoice.countDocuments({ user: userId, active: true }),
  announcementsPerDay: (userId, since) =>
    Announcement.countDocuments({ user: userId, createdAt: { $gte: since } }),
  // deleted members count too: add -> delete -> add must not dodge the cap
  memberAddsPerDay: (userId, since) =>
    Member.countDocuments({
      user: userId,
      createdAt: { $gte: since },
    }).setOptions({ withDeleted: true }),
});

/** Throws a 400 when `used` has reached the limit `key`. */
export const assertBelow = (used, key) => {
  if (!(key in LIMITS)) throw new Error(`unknown limit: ${key}`);
  if (used >= LIMITS[key]) throw AppError.badRequest(limitMessage(key));
};

/** Current usage of every limit (shown in the owner's settings). Never throws on a missing counter. */
export const getUsage = async (userId) => {
  const since = dayAgo();
  const keys = Object.keys(LIMITS);
  const counts = await Promise.all(
    keys.map((k) => (USAGE_COUNTERS[k] ? USAGE_COUNTERS[k](userId, since) : 0)),
  );
  return keys.map((key, i) => ({
    key,
    label: LIMIT_LABELS[key] || key,
    used: counts[i] || 0,
    max: LIMITS[key],
  }));
};
