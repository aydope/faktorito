import express from "express";
import { isInAnyClub } from "../services/membershipService.js";
const router = express.Router();

import User from "../models/User.js";
import Invoice from "../models/Invoice.js";
import Plan from "../models/Plan.js";
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/AppError.js";
import {
  adminOnly,
  preventSelfModification,
  guardTarget,
  requirePermission,
} from "../middleware/auth.js";
import { ASSIGNABLE_ROLES, ROLE_LABEL } from "../config/permissions.js";
import {
  softDeleteUser,
  cancelAccountDeletion,
} from "../services/accountService.js";
import { clearUserSessions } from "../utils/session.js";
import { disconnectUser } from "../realtime/socket.js";
import { validateID } from "../validators/mongooseId.js";
import { sanitizeBody } from "../utils/sanitizer.js";
import {
  asString,
  asEnum,
  escapeRegex,
  parsePagination,
} from "../utils/query.js";

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
      pendingDeletions,
    ] = await Promise.all([
      User.countDocuments({ status: { $ne: "deleted" } }),
      User.countDocuments({ status: "active" }),
      User.countDocuments({ status: { $in: ["suspended", "disabled"] } }),

      Invoice.countDocuments(),
      Plan.countDocuments(),

      Invoice.aggregate([
        { $match: { isPaid: true } },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]),

      User.find({ status: { $ne: "deleted" } })
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

      User.countDocuments({ status: "pending_deletion" }),
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
      pendingDeletions,
      currentUserRole: req.session.user.role,
    });
  }),
);

router.get(
  "/users",
  adminOnly,
  catchAsync(async (req, res) => {
    // req.query values are attacker-controlled (the "extended" query parser
    // turns ?status[$ne]=x into an object, ?search into a regex, ?limit=1e9...)
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const status = asEnum(req.query.status, [
      "active",
      "suspended",
      "disabled",
      "pending_deletion",
      "deleted",
    ]);
    const search = asString(req.query.search, 50);

    // soft-deleted accounts only show up when asked for explicitly
    const filter = status ? { status } : { status: { $ne: "deleted" } };
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ username: rx }, { email: rx }, { clubName: rx }];
    }

    const [users, totalCount] = await Promise.all([
      User.find(filter)
        .select("username email clubName role status createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;

    if (req.headers["x-requested-with"] === "XMLHttpRequest") {
      return res.json({
        success: true,
        data: users,
        pagination: {
          currentPage: page,
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
        currentPage: page,
        totalPages,
        totalCount,
        hasMore,
      },
      filters: { search, status },
      limit,
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
  guardTarget("users:role"),
  catchAsync(async (req, res) => {
    const { role } = req.body;

    // "moderator" can never be granted from the UI
    if (!role || !ASSIGNABLE_ROLES.includes(role)) {
      throw AppError.badRequest("نقش نامعتبر است");
    }
    if (["deleted", "pending_deletion"].includes(req.targetUser.status)) {
      throw AppError.badRequest("نقش این حساب قابل تغییر نیست");
    }

    // exclusivity: an account that is a club member can't become an owner, and
    // an owner can't be turned into an ordinary member while still owning a club
    if (role === "owner" && (await isInAnyClub(req.params.id))) {
      throw AppError.conflict(
        "این کاربر عضو یک باشگاه است و نمی‌تواند صاحب کسب‌وکار شود",
      );
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { role } },
      { returnDocument: "after" },
    ).select("role username");

    return res.json({
      success: true,
      message: `نقش کاربر به "${ROLE_LABEL[role]}" تغییر کرد`,
      data: { userId: user._id, role: user.role },
    });
  }),
);

router.patch(
  "/users/:id/status",
  adminOnly,
  sanitizeBody,
  preventSelfModification("نمی‌توانید وضعیت خود را تغییر دهید"),
  guardTarget("users:status"),
  catchAsync(async (req, res) => {
    const { status } = req.body;

    const validStatuses = ["active", "suspended", "disabled"];
    if (!status || !validStatuses.includes(status)) {
      throw AppError.badRequest("وضعیت نامعتبر است");
    }
    if (req.targetUser.status === "deleted") {
      throw AppError.badRequest("حساب حذف‌شده قابل تغییر نیست");
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        $set: { status },
        // re-activating also withdraws a pending deletion request
        ...(status === "active"
          ? { deletionRequestedAt: null, deletionReason: "" }
          : {}),
      },
      { returnDocument: "after" },
    ).select("status username");

    let sessionsCleared = false;
    if (status !== "active") {
      sessionsCleared = (await clearUserSessions(user._id, user.username)) > 0;
      disconnectUser(user._id);
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
  guardTarget("users:delete"),
  catchAsync(async (req, res) => {
    if (req.targetUser.status === "deleted") {
      throw AppError.badRequest("این حساب قبلاً حذف شده است");
    }

    // Soft delete: the account is anonymised and locked; invoices, plans and
    // members stay in the database (financial history).
    const user = await softDeleteUser(req.params.id, req.session.user.id);

    res.json({
      success: true,
      message: `حساب «${user.username}» حذف شد (داده‌های مالی نگه‌داری می‌شوند)`,
      data: { deletedUser: user.username },
    });
  }),
);

// ---- account-deletion requests --------------------------------------------
router.get(
  "/deletion-requests",
  adminOnly,
  requirePermission("deletions:review"),
  catchAsync(async (req, res) => {
    const requests = await User.find({ status: "pending_deletion" })
      .select("username email role clubName deletionRequestedAt deletionReason")
      .sort({ deletionRequestedAt: 1 })
      .limit(100)
      .lean();

    res.render("admin/deletion-requests", {
      title: "درخواست‌های حذف حساب",
      requests,
      currentUserRole: req.session.user.role,
    });
  }),
);

const reviewDeletion = (approve) =>
  catchAsync(async (req, res) => {
    const target = req.targetUser;
    if (target.status !== "pending_deletion") {
      throw AppError.badRequest("این حساب درخواست حذف فعالی ندارد");
    }

    if (approve) {
      await softDeleteUser(req.params.id, req.session.user.id);
    } else {
      await cancelAccountDeletion(req.params.id);
    }

    res.json({
      success: true,
      message: approve ? "حساب حذف شد" : "درخواست رد شد و حساب دوباره فعال شد",
    });
  });

router.post(
  "/deletion-requests/:id/approve",
  adminOnly,
  guardTarget("deletions:review"),
  reviewDeletion(true),
);
router.post(
  "/deletion-requests/:id/reject",
  adminOnly,
  guardTarget("deletions:review"),
  reviewDeletion(false),
);

router.get(
  "/invoices",
  adminOnly,
  catchAsync(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 10,
      maxLimit: 100,
    });
    const status = asEnum(req.query.status, ["paid", "pending"]);
    const search = asString(req.query.search, 50);

    const filter = {};
    if (status === "paid") filter.isPaid = true;
    if (status === "pending") filter.isPaid = false;
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ invoiceNumber: rx }, { "member.name": rx }];
    }

    const [invoices, totalCount] = await Promise.all([
      Invoice.find(filter)
        .select("invoiceNumber member totalAmount isPaid invoiceDate user plan")
        .populate("user", "username email clubName")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Invoice.countDocuments(filter),
    ]);

    const paginationData = {
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
      limit,
      hasNext: page < Math.ceil(totalCount / limit),
      hasPrev: page > 1,
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
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
      filters: { status, search },
    });
  }),
);

router.delete(
  "/invoices/:id",
  adminOnly,
  requirePermission("invoices:delete"),
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه فاکتور نامعتبر است" });
    const invoice = await Invoice.findById(req.params.id)
      .select("invoiceNumber isPaid")
      .lean();

    if (!invoice) throw AppError.notFound("فاکتور مورد نظر پیدا نشد");

    // A paid invoice already fed the member's totals and expiry date
    if (invoice.isPaid) {
      throw AppError.badRequest("فاکتور پرداخت‌شده قابل حذف نیست");
    }

    await Invoice.deleteOne({ _id: invoice._id });

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
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 10,
      maxLimit: 100,
    });
    const search = asString(req.query.search, 50);

    const filter = {};
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: rx }, { description: rx }];
    }

    const [plans, totalCount] = await Promise.all([
      Plan.find(filter)
        .select("name description price isActive createdAt user")
        .populate("user", "username email clubName")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Plan.countDocuments(filter),
    ]);

    const paginationData = {
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
      limit,
      hasNext: page < Math.ceil(totalCount / limit),
      hasPrev: page > 1,
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
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
      filters: { search },
    });
  }),
);

export default router;
