import AutoInvoice from "../models/AutoInvoice.js";
import Member from "../models/Member.js";
import Plan from "../models/Plan.js";
import Invoice from "../models/Invoice.js";
import { issuePlanInvoice } from "../services/invoiceService.js";
import { notifySafe } from "../services/notificationService.js";
import { hasDuration, addDuration } from "../utils/duration.js";
import { LIMITS } from "../config/limits.js";

const MAX_UNPAID = LIMITS.unpaidInvoices;

/**
 * The first due date strictly after `after`, counted from the rule's ANCHOR in
 * whole plan durations (1 Jan monthly -> 1 Feb, 1 Mar ...; a 31st clamps for
 * short months but never drifts). A server that was down for months issues ONE
 * invoice, not a backlog.
 */
export const advanceNext = (anchor, duration, after = new Date()) => {
  if (!hasDuration(duration)) throw new RangeError("plan has no duration");
  for (let k = 1; k <= 2000; k++) {
    const next = addDuration(anchor, {
      unit: duration.unit,
      value: duration.value * k,
    });
    if (next.getTime() > after.getTime()) return next;
  }
  return addDuration(after, duration);
};

const deactivate = (rule, reason) =>
  AutoInvoice.updateOne(
    { _id: rule._id },
    { $set: { active: false, lastError: reason } },
  );

/**
 * Issues the invoice of ONE rule. Safe to call from several instances: the rule
 * is "claimed" by moving nextIssueAt forward with a compare-and-set, so only
 * one caller wins each cycle.
 * Returns "issued" | "skipped" | "stopped" | "lost" | "failed".
 */
export const issueRule = async (
  rule,
  { now = new Date(), force = false } = {},
) => {
  const [plan, member] = await Promise.all([
    Plan.findOne({ _id: rule.plan, user: rule.user }).lean(),
    Member.findOne({ _id: rule.member, user: rule.user }).lean(),
  ]);

  if (!member || member.status === "inactive") {
    await deactivate(rule, "عضو حذف یا غیرفعال شده است");
    return "stopped";
  }
  if (!plan || !plan.isActive) {
    await deactivate(rule, "پلن حذف یا غیرفعال شده است");
    return "stopped";
  }
  const intervalMonths = rule.intervalMonths || 1;
  const duration = { unit: "month", value: intervalMonths };

  // claim this cycle
  const claimed = await AutoInvoice.findOneAndUpdate(
    { _id: rule._id, active: true, nextIssueAt: rule.nextIssueAt },
    {
      $set: {
        // strictly after BOTH now and the current due date: "issue now" on a rule
        // that is not due yet must also consume the upcoming cycle
        nextIssueAt: advanceNext(
          rule.anchorAt || rule.nextIssueAt,
          duration,
          new Date(
            Math.max(now.getTime(), new Date(rule.nextIssueAt).getTime()),
          ),
        ),
      },
    },
    { returnDocument: "before" },
  ).lean();
  if (!claimed) return "lost";

  try {
    // no pile-up: a frozen member or an unpaid previous auto-invoice skips the cycle
    let skip = member.status === "frozen";
    if (!skip && rule.lastInvoice && !force) {
      const prev = await Invoice.findOne({
        _id: rule.lastInvoice,
        user: rule.user,
      })
        .select("isPaid")
        .lean();
      skip = !!prev && !prev.isPaid;
    }
    if (
      !skip &&
      (await Invoice.countDocuments({ user: rule.user, isPaid: false })) >=
        MAX_UNPAID
    )
      skip = true;

    if (skip) {
      await AutoInvoice.updateOne(
        { _id: rule._id },
        { $inc: { skippedCount: 1 } },
      );
      return "skipped";
    }

    const invoice = await issuePlanInvoice({
      ownerId: rule.user,
      member,
      plan,
      periodMonths: intervalMonths,
      note: rule.note || "",
      autoIssued: true,
    });

    await AutoInvoice.updateOne(
      { _id: rule._id },
      {
        $set: { lastIssuedAt: now, lastInvoice: invoice._id, lastError: "" },
        $inc: { issuedCount: 1 },
      },
    );

    notifySafe(rule.user, {
      type: "invoice",
      title: "فاکتور خودکار صادر شد",
      body: `${member.name}, ${invoice.invoiceNumber}`,
      url: `/i/${invoice.publicId}`,
    });
    return "issued";
  } catch (err) {
    console.error("auto invoice failed:", err.message);
    // try again in an hour instead of losing the cycle
    await AutoInvoice.updateOne(
      { _id: rule._id },
      {
        $set: {
          nextIssueAt: new Date(now.getTime() + 60 * 60 * 1000),
          lastError: "صدور فاکتور ناموفق بود. دوباره تلاش می‌شود",
        },
      },
    );
    return "failed";
  }
};

export const runAutoInvoices = async ({
  now = new Date(),
  limit = 200,
} = {}) => {
  const due = await AutoInvoice.find({
    active: true,
    nextIssueAt: { $lte: now },
  })
    .sort({ nextIssueAt: 1 })
    .limit(limit)
    .lean();

  const result = { issued: 0, skipped: 0, stopped: 0, lost: 0, failed: 0 };
  for (const rule of due) {
    const outcome = await issueRule(rule, { now });
    result[outcome]++;
  }
  return result;
};
