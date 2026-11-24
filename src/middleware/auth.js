import AppError from "../utils/AppError.js";
import User from "../models/User.js";
import { validateID } from "../validators/mongooseId.js";
import {
  STAFF_ROLES,
  BUSINESS_ROLES,
  can,
  outranks,
  homeFor,
} from "../config/permissions.js";

export const ACCOUNT_FIELDS =
  "role status username email emailVerified passwordChangedAt";

const clearSession = (req, res) =>
  new Promise((resolve) => {
    if (!req.session) return resolve();
    req.session.destroy((err) => {
      if (err) console.error("Session destroy error:", err);
      res.clearCookie("faktorito.sid");
      resolve();
    });
  });

const STATUS_MESSAGES = {
  suspended: "حساب کاربری شما تعلیق شده است",
  disabled: "حساب کاربری شما غیرفعال شده است",
  pending_deletion: "درخواست حذف حساب شما در حال بررسی است",
  deleted: "این حساب حذف شده است",
};

const wantsHtml = (req) =>
  req.method === "GET" &&
  req.get("x-requested-with") !== "XMLHttpRequest" &&
  req.accepts(["html", "json"]) === "html";

/**
 * Loads the *current* account once per request (role/status in the session can
 * be stale, and checkAccountStatus may already have loaded it), rejects
 * inactive accounts and sessions older than the last password change.
 */
export const loadActiveUser = async (req, res) => {
  if (!req.session?.user) {
    throw AppError.unauthorized("لطفا ابتدا وارد شوید");
  }

  let user = req.account;
  if (!user || String(user._id) !== String(req.session.user.id)) {
    user = await User.findById(req.session.user.id)
      .select(ACCOUNT_FIELDS)
      .lean();
    req.account = user;
  }

  if (!user) {
    await clearSession(req, res);
    throw AppError.unauthorized("کاربر یافت نشد");
  }

  if (user.status !== "active") {
    const message = STATUS_MESSAGES[user.status] || "حساب کاربری غیرفعال است";
    await clearSession(req, res);
    throw AppError.forbidden(message);
  }

  const authAt = req.session.authAt;
  if (
    authAt &&
    user.passwordChangedAt &&
    new Date(user.passwordChangedAt).getTime() > authAt + 1000
  ) {
    await clearSession(req, res);
    throw AppError.unauthorized("رمز عبور تغییر کرده است. دوباره وارد شوید");
  }

  // keep the cached session copy in sync (menus, rate limits use it)
  if (req.session.user.role !== user.role) req.session.user.role = user.role;

  req.user = user;
  return user;
};

export const authenticate = async (req, res, next) => {
  try {
    if (!req.session?.user && wantsHtml(req)) {
      req.session.returnTo = req.originalUrl;
      return res.redirect("/auth/login");
    }
    await loadActiveUser(req, res);
    next();
  } catch (error) {
    next(error);
  }
};

export const requireRole =
  (roles, message = "دسترسی غیرمجاز") =>
  async (req, res, next) => {
    try {
      const user = await loadActiveUser(req, res);
      if (!roles.includes(user.role)) {
        // a normal page visit by the wrong kind of account -> its own panel
        if (wantsHtml(req)) return res.redirect(homeFor(user.role));
        throw AppError.forbidden(message);
      }
      next();
    } catch (error) {
      next(error);
    }
  };

/** Staff panel (admin + moderator). */
export const adminOnly = requireRole(
  STAFF_ROLES,
  "این بخش فقط برای مدیران قابل دسترسی است",
);
/** Business panel (owner, and staff who run their own club). Members -> /me. */
export const ownerArea = requireRole(
  BUSINESS_ROLES,
  "این بخش مخصوص کسب‌وکارهاست",
);
/** Member panel. */
export const memberOnly = requireRole(["member"], "این بخش مخصوص اعضاست");

export const requirePermission =
  (permission, message) => async (req, res, next) => {
    try {
      const user = req.user || (await loadActiveUser(req, res));
      if (!can(user.role, permission)) {
        throw AppError.forbidden(
          message || "شما دسترسی لازم برای این عملیات را ندارید",
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };

/**
 * Permission + hierarchy check against `req.params.id`: the actor must hold the
 * permission AND be strictly senior to the target (no acting on peers/seniors).
 * The loaded target is exposed as `req.targetUser`.
 */
export const guardTarget = (permission) => async (req, res, next) => {
  const isDelete = req.method === "DELETE";

  const fail = (status, message) => {
    if (isDelete) {
      return res.status(status).json({ success: false, message });
    }
    throw new AppError(message, status);
  };

  try {
    const actor = req.user || (await loadActiveUser(req, res));
    if (!actor) return; // loadActiveUser خودش پاسخ داده است

    if (!can(actor.role, permission)) {
      return fail(403, "شما دسترسی لازم برای این عملیات را ندارید");
    }

    try {
      validateID(req.params.id, { message: "شناسه کاربر نامعتبر است" });
    } catch {
      return fail(400, "شناسه کاربر نامعتبر است");
    }

    const target = await User.findById(req.params.id)
      .select("role status username email")
      .lean();
    if (!target) return fail(404, "کاربر پیدا نشد");

    if (!outranks(actor.role, target.role)) {
      return fail(
        403,
        "نمی‌توانید روی کاربری با رتبه برابر یا بالاتر عمل کنید",
      );
    }

    req.targetUser = target;
    next();
  } catch (error) {
    if (isDelete) {
      return res.status(500).json({
        success: false,
        message: "خطای سرور در اعتبارسنجی هدف",
      });
    }
    next(error);
  }
};

export const preventSelfModification = (msg) => (req, res, next) => {
  if (String(req.session.user.id) === String(req.params.id)) {
    return next(
      AppError.badRequest(
        msg || "نمی‌توانید روی حساب خود این عملیات را انجام دهید",
      ),
    );
  }
  next();
};
