import User from "../models/User.js";
import { ACCOUNT_FIELDS } from "./auth.js";

const destroySession = (req, res) =>
  new Promise((resolve) => {
    req.session.destroy((err) => {
      if (err) console.error("Session destroy error:", err);
      res.clearCookie("faktorito.sid");
      resolve();
    });
  });

/**
 * Runs before the guarded routers. Loads the account ONCE and caches it on
 * `req.account`, so `authenticate` doesn't query the same user again.
 */
const checkAccountStatus = async (req, res, next) => {
  try {
    if (!req.session?.user?.id) return next();

    const user = await User.findById(req.session.user.id)
      .select(ACCOUNT_FIELDS)
      .lean();

    if (!user) {
      await destroySession(req, res);
      return res.redirect("/auth/login");
    }

    req.account = user;

    if (["suspended", "disabled"].includes(user.status)) {
      return res.status(403).render("account-status", {
        title: `حساب ${user.status === "suspended" ? "تعلیق" : "غیرفعال"} شده`,
        status: user.status,
        username: user.username,
        isSuspended: user.status === "suspended",
        isDisabled: user.status === "disabled",
      });
    }

    if (["pending_deletion", "deleted"].includes(user.status)) {
      await destroySession(req, res);
      return res.redirect("/auth/login");
    }

    next();
  } catch (error) {
    console.error("checkAccountStatus error:", error);
    next(error);
  }
};

export default checkAccountStatus;
