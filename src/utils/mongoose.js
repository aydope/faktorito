const Invoice = require("../models/Invoice");
const User = require("../models/User");
const Plan = require("../models/Plan");
const AppError = require("../utils/AppError");
const { validateID } = require("../validators/mongooseId");

exports.getUserInvoiceStats = async (userId) => {
  validateID(userId, { message: "شناسه کاربر نامعتبر است" });

  const [invoiceCount, paidCount, recentInvoices, paidInvoices] =
    await Promise.all([
      Invoice.countDocuments({ user: userId }),
      Invoice.countDocuments({ user: userId, isPaid: true }),
      Invoice.find({ user: userId })
        .select("invoiceNumber member totalAmount isPaid invoiceDate plan")
        .populate("plan", "name")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Invoice.find({ user: userId, isPaid: true }).select("totalAmount").lean(),
    ]);

  const totalRevenue = paidInvoices.reduce(
    (sum, inv) => sum + (inv.totalAmount || 0),
    0,
  );

  return { invoiceCount, paidCount, recentInvoices, totalRevenue };
};

exports.findUserFromSession = async (sessionUserId) => {
  if (!sessionUserId) return null;
  validateID(sessionUserId, { message: "شناسه کاربر نامعتبر است" });
  return User.findById(sessionUserId)
    .select("role clubName clubPhone clubAddress clubEmail clubCode")
    .lean();
};

exports.findUserInvoice = async (invoiceId, userId) => {
  validateID(invoiceId, { message: "شناسه فاکتور نامعتبر است" });
  validateID(userId, { message: "شناسه کاربر نامعتبر است" });

  const invoice = await Invoice.findById(invoiceId);

  if (!invoice) {
    throw AppError.notFound("فاکتور پیدا نشد");
  }

  if (invoice.user.toString() !== userId) {
    throw AppError.forbidden("شما دسترسی به این فاکتور را ندارید");
  }

  return invoice;
};

exports.findUserPlan = async (planId, userId) => {
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
