import mongoose from "mongoose";
import Member from "../models/Member.js";
import Invoice from "../models/Invoice.js";
import { planDuration, hasDuration } from "../utils/duration.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 09123456789 -> 0912***6789 (used on the public invoice page) */
const maskPhone = (phone) =>
  typeof phone === "string" && /^09\d{9}$/.test(phone)
    ? `${phone.slice(0, 4)}***${phone.slice(7)}`
    : phone;

/**
 * Called exactly once when an invoice flips from unpaid to paid.
 *  - adds the amount to the member's lifetime total
 *  - extends the membership period when the plan has a duration
 */
const applyPaymentToMember = async (invoice) => {
  if (!invoice?.memberRef) return null;

  const member = await Member.findOne({
    _id: invoice.memberRef,
    user: invoice.user,
  });
  if (!member) return null;

  const set = { lastPaymentAt: new Date() };
  const duration = planDuration(invoice.plan);

  if (hasDuration(duration)) {
    const { startsAt, expiresAt } = Member.calculateRenewal(member, duration);
    set.membershipStartsAt = startsAt;
    set.membershipExpiresAt = expiresAt;
    set.lastPlanName = invoice.plan.name;
    // paying for a membership re-activates someone who had left
    if (member.status === "inactive") set.status = "active";
  }

  return Member.findOneAndUpdate(
    { _id: member._id, user: invoice.user },
    { $set: set, $inc: { totalPaid: invoice.totalAmount || 0 } },
    { returnDocument: "after" },
  );
};

/** Numbers for the dashboard widgets. */
const getMemberStats = async (userIdInput) => {
  // aggregate() does NOT cast strings to ObjectId like find() does
  const userId = new mongoose.Types.ObjectId(String(userIdInput));
  const now = new Date();
  const soon = new Date(now.getTime() + Member.EXPIRING_SOON_DAYS * DAY_MS);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalMembers,
    activeMembers,
    expiringMembers,
    expiredMembers,
    attentionList,
    monthRevenueAgg,
    unpaidAgg,
  ] = await Promise.all([
    Member.countDocuments({ user: userId, status: { $ne: "inactive" } }),
    Member.countDocuments({
      user: userId,
      status: "active",
      membershipExpiresAt: { $gte: now },
    }),
    Member.countDocuments({
      user: userId,
      status: "active",
      membershipExpiresAt: { $gte: now, $lte: soon },
    }),
    Member.countDocuments({
      user: userId,
      status: "active",
      membershipExpiresAt: { $lt: now },
    }),
    Member.find({
      user: userId,
      status: "active",
      membershipExpiresAt: {
        $gte: new Date(now.getTime() - 30 * DAY_MS),
        $lte: soon,
      },
    })
      .select("name code phone membershipExpiresAt status")
      .sort({ membershipExpiresAt: 1 })
      .limit(5)
      .lean({ virtuals: true }),
    Invoice.aggregate([
      { $match: { user: userId, isPaid: true, paidAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]),
    Invoice.aggregate([
      { $match: { user: userId, isPaid: false } },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  return {
    totalMembers,
    activeMembers,
    expiringMembers,
    expiredMembers,
    attentionList: attentionList.map((m) => ({
      ...m,
      state: Member.computeMembershipState(m),
    })),
    monthRevenue: monthRevenueAgg[0]?.total || 0,
    unpaidTotal: unpaidAgg[0]?.total || 0,
    unpaidCount: unpaidAgg[0]?.count || 0,
  };
};

export { applyPaymentToMember, getMemberStats, maskPhone };
