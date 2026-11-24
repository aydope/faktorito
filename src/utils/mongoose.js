import mongoose from "mongoose";
import Invoice from "../models/Invoice.js";
import User from "../models/User.js";
import Plan from "../models/Plan.js";
import AppError from "../utils/AppError.js";
import { validateID } from "../validators/mongooseId.js";
import { getMemberStats } from "../services/memberService.js";

export const getUserInvoiceStats = async (userId) => {
  validateID(userId, { message: "شناسه کاربر نامعتبر است" });
  // aggregate() doesn't cast strings to ObjectId, find()/count() do
  const ownerId = new mongoose.Types.ObjectId(String(userId));

  const [invoiceCount, paidCount, recentInvoices, revenueAgg, memberStats] =
    await Promise.all([
      Invoice.countDocuments({ user: userId }),
      Invoice.countDocuments({ user: userId, isPaid: true }),
      // `plan` is an embedded snapshot, not a reference -> no populate needed
      Invoice.find({ user: userId })
        .select("invoiceNumber member totalAmount isPaid invoiceDate plan")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Invoice.aggregate([
        { $match: { user: ownerId, isPaid: true } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]),
      getMemberStats(userId),
    ]);

  return {
    invoiceCount,
    paidCount,
    recentInvoices,
    totalRevenue: revenueAgg[0]?.total || 0,
    memberStats,
  };
};

export const findUserFromSession = async (sessionUserId) => {
  if (!sessionUserId) return null;
  validateID(sessionUserId, { message: "شناسه کاربر نامعتبر است" });
  return User.findById(sessionUserId)
    .select(
      "role username email emailVerified clubName clubPhone clubAddress clubEmail clubCode invoiceTheme signature",
    )
    .lean();
};

export const findUserInvoice = async (invoiceId, userId) => {
  validateID(invoiceId, { message: "شناسه فاکتور نامعتبر است" });
  validateID(userId, { message: "شناسه کاربر نامعتبر است" });

  // Scoped by owner in the query itself. A foreign invoice answers 404
  // (not 403) so ids of other accounts can't be probed.
  const invoice = await Invoice.findOne({ _id: invoiceId, user: userId });

  if (!invoice) {
    throw AppError.notFound("فاکتور پیدا نشد");
  }

  return invoice;
};

export const findUserPlan = async (planId, userId) => {
  validateID(planId, { message: "شناسه پلن نامعتبر است" });
  validateID(userId, { message: "شناسه کاربر نامعتبر است" });

  const plan = await Plan.findOne({
    _id: planId,
    user: userId,
    isActive: true,
  });

  if (!plan) {
    throw AppError.notFound("پلن انتخاب شده یافت نشد");
  }

  return plan;
};
