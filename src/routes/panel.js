import express from "express";
import User from "../models/User.js";
import Member from "../models/Member.js";
import Invoice from "../models/Invoice.js";
import Announcement from "../models/Announcement.js";
import { getMembership, leaveClub } from "../services/membershipService.js";
import catchAsync from "../utils/catchAsync.js";
import validateRequest from "../middleware/validateRequest.js";
import {
  deletionSchema,
  emailChangeSchema,
  emailConfirmSchema,
} from "../validators/account.js";
import AppError from "../utils/AppError.js";
import { isObjectId } from "../validators/mongooseId.js";
import {
  listNotifications,
  markRead,
} from "../services/notificationService.js";
import {
  requestAccountDeletion,
  startEmailChange,
  confirmEmailChange,
} from "../services/accountService.js";

// ---------------------------------------------------------------------------
// /me: the panel of an ordinary account (a customer of at most one club)
// ---------------------------------------------------------------------------
export const meRouter = express.Router();

meRouter.get(
  "/",
  catchAsync(async (req, res) => {
    const accountId = req.session.user.id;

    // An ordinary account belongs to at most ONE club (set by the club adding
    // them by e-mail). No club -> the panel offers to create a business.
    const membership = await getMembership(accountId);

    let invoices = [];
    let announcements = [];
    if (membership) {
      [invoices, announcements] = await Promise.all([
        Invoice.find({ memberRef: membership._id })
          .select(
            "invoiceNumber publicId totalAmount isPaid paidAt invoiceDate plan.name createdAt autoIssued",
          )
          .sort({ createdAt: -1 })
          .limit(30)
          .lean(),
        Announcement.find({
          user: membership.user._id,
          expiresAt: { $gt: new Date() },
        })
          .select("title body createdAt expiresAt")
          .sort({ createdAt: -1 })
          .limit(10)
          .lean(),
      ]);
    }

    res.render("me/dashboard", {
      title: "پنل من",
      active: "me",
      membership: membership
        ? {
            ...membership,
            state: Member.computeMembershipState(membership),
            daysLeft: membership.membershipExpiresAt
              ? Math.ceil(
                  (new Date(membership.membershipExpiresAt).getTime() -
                    Date.now()) /
                    86400000,
                )
              : null,
          }
        : null,
      invoices,
      announcements,
      unpaidTotal: invoices
        .filter((i) => !i.isPaid)
        .reduce((sum, i) => sum + i.totalAmount, 0),
    });
  }),
);

// the member leaves the club by themselves (the club may also remove them)
meRouter.post(
  "/leave",
  catchAsync(async (req, res) => {
    await leaveClub(req.session.user.id);
    res.json({
      success: true,
      message: "از باشگاه خارج شدید",
      redirect: "/me",
    });
  }),
);

// ---------------------------------------------------------------------------
// /notifications: list + mark as read (live pushes come through Socket.IO)
// ---------------------------------------------------------------------------
export const notificationRouter = express.Router();

notificationRouter.get(
  "/",
  catchAsync(async (req, res) => {
    const data = await listNotifications(req.session.user.id, 20);
    res.json({ success: true, ...data });
  }),
);

/** `{ ids: [...] }` marks those notifications (what the bell sends once they were actually seen); no ids = all. */
export const parseReadIds = (body) => {
  if (body?.ids === undefined) return null;
  if (
    !Array.isArray(body.ids) ||
    body.ids.length === 0 ||
    body.ids.length > 50 ||
    !body.ids.every((id) => typeof id === "string" && isObjectId(id))
  ) {
    throw AppError.badRequest("فهرست اعلان‌ها نامعتبر است");
  }
  return [...new Set(body.ids)];
};

notificationRouter.post(
  "/read",
  catchAsync(async (req, res) => {
    const { marked, unread } = await markRead(
      req.session.user.id,
      parseReadIds(req.body),
    );
    res.json({ success: true, marked, unread });
  }),
);

notificationRouter.post(
  "/:id/read",
  catchAsync(async (req, res) => {
    if (!isObjectId(req.params.id))
      throw AppError.badRequest("شناسه نامعتبر است");
    const { marked, unread } = await markRead(req.session.user.id, [
      req.params.id,
    ]);
    res.json({ success: true, marked, unread });
  }),
);

// ---------------------------------------------------------------------------
// /account: e-mail change and deletion request (for every account type)
// ---------------------------------------------------------------------------
export const accountRouter = express.Router();

accountRouter.post(
  "/delete-request",
  validateRequest(deletionSchema),
  catchAsync(async (req, res) => {
    const { password, reason = "" } = req.validatedBody;
    const user = await User.findById(req.session.user.id).select(
      "+password +loginAttempts +lockUntil",
    );
    if (!user) throw AppError.notFound("کاربر پیدا نشد");

    if (user.isLocked())
      throw AppError.forbidden("به دلیل تلاش‌های ناموفق موقتاً قفل شده است");
    if (!(await user.comparePassword(password))) {
      await user.incrementLoginAttempts();
      throw AppError.unauthorized("رمز عبور نادرست است");
    }

    await requestAccountDeletion(user, reason);
    req.session.destroy(() => {
      res.clearCookie("faktorito.sid");
      res.json({
        success: true,
        message:
          "درخواست حذف ثبت شد و حساب شما غیرفعال شد. تا زمان بررسی می‌توانید آن را لغو کنید",
        redirect: "/auth/login",
      });
    });
  }),
);

accountRouter.post(
  "/email/change",
  validateRequest(emailChangeSchema),
  catchAsync(async (req, res) => {
    const user = await User.findById(req.session.user.id).select(
      "email username role",
    );
    if (user.email === req.validatedBody.email)
      throw AppError.badRequest("این ایمیل همین حالا برای حساب شما ثبت است");
    await startEmailChange(user, req.validatedBody.email);
    res.json({ success: true, message: "کد تأیید به ایمیل جدید ارسال شد" });
  }),
);

accountRouter.post(
  "/email/confirm",
  validateRequest(emailConfirmSchema),
  catchAsync(async (req, res) => {
    const user = await User.findById(req.session.user.id).select(
      "email username role",
    );
    const email = await confirmEmailChange(user, req.validatedBody.code);
    res.json({ success: true, message: "ایمیل شما تغییر کرد", email });
  }),
);
