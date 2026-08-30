const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const User = require("../models/User");
const Invoice = require("../models/Invoice");
const Plan = require("../models/Plan");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { adminOnly, authenticate } = require("../middleware/auth");
const {
  preventSelfModification,
  checkPermission,
} = require("../middleware/auth");
const { validateID } = require("../validators/mongooseId");
const { clearUserSessions } = require("../utils/session");
const { sanitizeBody } = require("../utils/sanitizer");

router.get(
  "/dashboard",
  adminOnly,
  catchAsync(async (req, res) => {
    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      totalInvoices,
      totalPlans,
      revenue,
      recentUsers,
      recentInvoices,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: "active" }),
      User.countDocuments({ status: { $in: ["suspended", "disabled"] } }),

      Invoice.countDocuments(),
      Plan.countDocuments(),

      Invoice.aggregate([
        { $match: { isPaid: true } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]),

      User.find()
        .select("username email clubName role status createdAt")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),

      Invoice.find()
        .select("invoiceNumber member totalAmount isPaid createdAt user")
        .populate("user", "username clubName")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    return res.status(200).render("admin/dashboard", {
      title: "پنل مدیریت",
      totalUsers,
      activeUsers,
      suspendedUsers,
      totalInvoices,
      totalPlans,
      totalRevenue: revenue[0]?.total || 0,
      recentUsers,
      recentInvoices,
      currentUserRole: req.session.user.role,
    });
  }),
);

router.get(
  "/users",
  adminOnly,
  catchAsync(async (req, res) => {
    const { page = 1, limit = 15, search = "", status = "" } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = {};
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { clubName: { $regex: search, $options: "i" } },
      ];
    }

    const [users, totalCount] = await Promise.all([
      User.find(filter)
        .select("username email clubName role status createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      User.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / Number(limit));
    const hasMore = Number(page) < totalPages;

    if (req.headers["x-requested-with"] === "XMLHttpRequest") {
      return res.json({
        success: true,
        data: users,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalCount,
          hasMore,
        },
      });
    }

    res.render("admin/users", {
      title: "مدیریت کاربران",
      users,
      currentUserRole: req.session.user.role,
      pagination: {
        currentPage: Number(page),
        totalPages,
        totalCount,
        hasMore,
      },
      filters: { search, status },
      limit: Number(limit),
    });
  }),
);

router.get(
  "/users/:id",
  adminOnly,
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه کاربر نامعتبر است" });
    const user = await User.findById(req.params.id).lean();

    if (!user) throw AppError.notFound("کاربر مورد نظر پیدا نشد");

    const [invoices, plans] = await Promise.all([
      Invoice.find({ user: user._id })
        .select("invoiceNumber member totalAmount isPaid invoiceDate plan")
        .populate("plan", "name")
        .sort({ createdAt: -1 })
        .lean(),
      Plan.find({ user: user._id })
        .select("name price isActive createdAt")
        .lean(),
    ]);

    res.render("admin/user-detail", {
      title: `کاربر ${user.username}`,
      user,
      invoices,
      plans,
      currentUserRole: req.session.user.role,
    });
  }),
);

router.patch(
  "/users/:id/role",
  adminOnly,
  sanitizeBody,
  preventSelfModification("نمی‌توانید نقش خود را تغییر دهید"),
  checkPermission("admin/users:role"),
  catchAsync(async (req, res) => {
    const { role } = req.body;
    validateID(req.params.id, { message: "شناسه کاربر نامعتبر است" });

    const validRoles = ["user", "admin", "moderator"];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "نقش نامعتبر است",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { role } },
      { new: true },
    ).select("role username");

    const roleLabels = {
      moderator: "مدیر ارشد",
      admin: "ادمین",
      user: "کاربر",
    };

    return res.json({
      success: true,
      message: `نقش کاربر به "${roleLabels[role]}" تغییر کرد`,
      data: { userId: user._id, role: user.role },
    });
  }),
);

router.patch(
  "/users/:id/status",
  adminOnly,
  sanitizeBody,
  preventSelfModification("نمی‌توانید وضعیت خود را تغییر دهید"),
  checkPermission("admin/users:status"),
  catchAsync(async (req, res) => {
    const { status } = req.body;
    validateID(req.params.id, { message: "شناسه کاربر نامعتبر است" });

    const validStatuses = ["active", "suspended", "disabled"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "وضعیت نامعتبر است",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true },
    ).select("status username");

    let sessionsCleared = false;
    if (status === "suspended" || status === "disabled") {
      sessionsCleared = (await clearUserSessions(user._id, user.username)) > 0;
    }

    const statusLabels = {
      active: "فعال",
      suspended: "تعلیق",
      disabled: "غیرفعال",
    };

    return res.json({
      success: true,
      message: `وضعیت کاربر به "${statusLabels[status]}" تغییر کرد${
        sessionsCleared ? " و از تمام دستگاه‌ها خارج شد" : ""
      }`,
      data: { userId: user._id, status: user.status, sessionsCleared },
    });
  }),
);

router.delete(
  "/users/:id",
  adminOnly,
  preventSelfModification("نمی‌توانید خود را حذف کنید"),
  checkPermission("admin/users:delete"),
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه کاربر نامعتبر است" });
    const user = await User.findById(req.params.id).lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "کاربر پیدا نشد",
      });
    }

    const sessionCollection = mongoose.connection.db.collection("sessions");
    await sessionCollection.deleteMany({
      "session.user.id": user._id.toString(),
    });

    const [deletedInvoices, deletedPlans] = await Promise.all([
      Invoice.deleteMany({ user: user._id }),
      Plan.deleteMany({ user: user._id }),
    ]);

    await User.findByIdAndDelete(user._id);

    res.json({
      success: true,
      message: `کاربر "${user.username}" و تمام داده‌هایش با موفقیت حذف شد`,
      data: {
        deletedUser: user.username,
        deletedInvoices: deletedInvoices.deletedCount,
        deletedPlans: deletedPlans.deletedCount,
      },
    });
  }),
);

router.get(
  "/invoices",
  adminOnly,
  catchAsync(async (req, res) => {
    const { page = 1, limit = 10, status = "", search = "" } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = {};
    if (status === "paid") filter.isPaid = true;
    if (status === "pending") filter.isPaid = false;
    if (search) {
      filter.$or = [
        {
          invoiceNumber: {
            $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            $options: "i",
          },
        },
        {
          "member.name": {
            $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            $options: "i",
          },
        },
      ];
    }

    const [invoices, totalCount] = await Promise.all([
      Invoice.find(filter)
        .select("invoiceNumber member totalAmount isPaid invoiceDate user plan")
        .populate("user", "username email clubName")
        .populate("plan", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Invoice.countDocuments(filter),
    ]);

    const paginationData = {
      currentPage: Number(page),
      totalPages: Math.ceil(totalCount / Number(limit)),
      totalCount,
      limit: Number(limit),
      hasNext: Number(page) < Math.ceil(totalCount / Number(limit)),
      hasPrev: Number(page) > 1,
    };

    if (req.headers["x-requested-with"] === "XMLHttpRequest") {
      return res.json({
        success: true,
        invoices,
        pagination: paginationData,
        filters: { status, search },
      });
    }

    res.render("admin/invoices", {
      title: "مدیریت فاکتورها",
      invoices,
      currentPage: Number(page),
      totalPages: Math.ceil(totalCount / Number(limit)),
      totalCount,
      filters: { status, search },
    });
  }),
);

router.delete(
  "/invoices/:id",
  adminOnly,
  checkPermission("admin/invoices:delete"),
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه فاکتور نامعتبر است" });
    const invoice = await Invoice.findByIdAndDelete(req.params.id)
      .select("invoiceNumber")
      .lean();

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "فاکتور مورد نظر پیدا نشد",
      });
    }

    return res.json({
      success: true,
      message: `فاکتور #${invoice.invoiceNumber} با موفقیت حذف شد`,
    });
  }),
);

router.get(
  "/plans",
  adminOnly,
  catchAsync(async (req, res) => {
    const { page = 1, limit = 10, search = "" } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = {};
    if (search) {
      filter.$or = [
        {
          name: {
            $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            $options: "i",
          },
        },
        {
          description: {
            $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            $options: "i",
          },
        },
      ];
    }

    const [plans, totalCount] = await Promise.all([
      Plan.find(filter)
        .select("name description price isActive createdAt user")
        .populate("user", "username email clubName")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Plan.countDocuments(filter),
    ]);

    const paginationData = {
      currentPage: Number(page),
      totalPages: Math.ceil(totalCount / Number(limit)),
      totalCount,
      limit: Number(limit),
      hasNext: Number(page) < Math.ceil(totalCount / Number(limit)),
      hasPrev: Number(page) > 1,
    };

    if (req.headers["x-requested-with"] === "XMLHttpRequest") {
      return res.json({
        success: true,
        plans,
        pagination: paginationData,
        filters: { search },
      });
    }

    res.render("admin/plans", {
      title: "مدیریت پلن‌ها",
      plans,
      currentPage: Number(page),
      totalPages: Math.ceil(totalCount / Number(limit)),
      totalCount,
      filters: { search },
    });
  }),
);

module.exports = router;
