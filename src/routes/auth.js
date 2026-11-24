import express from "express";
import bcrypt from "bcrypt";
import User from "../models/User.js";
import {
  registerSchema,
  loginSchema,
  checkAvailabilitySchema,
  verifyCodeSchema,
  emailOnlySchema,
  loginOtpVerifySchema,
  resetPasswordSchema,
} from "../validators/auth.js";
import catchAsync from "../utils/catchAsync.js";
import validateRequest from "../middleware/validateRequest.js";
import { CURRENT_TERMS_VERSION } from "../config/legal.js";
import { signupQuota } from "../services/dailyQuota.js";
import AppError from "../utils/AppError.js";
import { homeFor } from "../config/permissions.js";
import { verifyOtp, cooldownLeft } from "../services/otpService.js";
import {
  sendOtpEmail,
  maskEmail,
  linkMemberAccounts,
  cancelAccountDeletion,
} from "../services/accountService.js";
import { clearUserSessions } from "../utils/session.js";
import { disconnectUser } from "../realtime/socket.js";

const router = express.Router();

// Short, friendly entry points: /register and /login for everybody
export const aliasRouter = express.Router();
aliasRouter.get("/register", (req, res) => res.redirect(301, "/auth/register"));
aliasRouter.get("/login", (req, res) => res.redirect(301, "/auth/login"));

const PENDING_TTL_MS = 30 * 60 * 1000;

const regenerate = (req) =>
  new Promise((resolve, reject) => {
    req.session.regenerate((err) =>
      err ? reject(AppError.internal("خطا در ایجاد نشست")) : resolve(),
    );
  });

const save = (req) =>
  new Promise((resolve, reject) => {
    req.session.save((err) =>
      err ? reject(AppError.internal("خطا در ذخیره سشن")) : resolve(),
    );
  });

/** Full session, only ever created for verified, active accounts. */
const createUserSession = async (req, user) => {
  const returnTo = req.session?.returnTo;
  await regenerate(req); // prevents session fixation
  req.session.user = {
    id: String(user._id),
    username: user.username,
    email: user.email,
    clubName: user.clubName,
    role: user.role,
  };
  req.session.authAt = Date.now();
  if (returnTo) req.session.returnTo = returnTo;
  await save(req);
};

/**
 * Half-logged-in state (password OK, but e-mail not verified yet / deletion
 * pending). Carries no `user`, so every protected route still says "log in".
 */
const createPendingSession = async (req, user, purpose) => {
  await regenerate(req);
  req.session.pending = { userId: String(user._id), purpose, at: Date.now() };
  await save(req);
};

const getPending = (req, purpose) => {
  const p = req.session?.pending;
  if (!p || p.purpose !== purpose || Date.now() - p.at > PENDING_TTL_MS)
    return null;
  return p;
};

// Only same-site relative redirects (blocks //evil.com and /\evil.com)
const safeRedirect = (target, fallback) =>
  typeof target === "string" &&
  target.startsWith("/") &&
  !target.startsWith("//") &&
  !target.startsWith("/\\")
    ? target
    : fallback;

const finishLogin = async (req, res, user, message = "ورود موفقیت‌آمیز") => {
  const returnTo = req.session?.returnTo;
  // a plain account that was added to a club by e-mail joins it now
  await linkMemberAccounts(user).catch((err) =>
    console.error("link on login failed:", err.message),
  );
  await createUserSession(req, user);
  const home = homeFor(user.role);
  // returnTo is honoured only when it belongs to the user's own panel
  const redirect =
    returnTo && user.role !== "member" && !returnTo.startsWith("/me")
      ? safeRedirect(returnTo, home)
      : home;
  delete req.session.returnTo;
  return res.json({ success: true, message, redirect });
};

// Pre-computed hash keeps timing similar when the e-mail doesn't exist
const DUMMY_HASH = bcrypt.hashSync("faktorito-dummy-password", 12);

const checkDuplicateUser = async (email, username) => {
  const existing = await User.findOne({
    $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }],
  })
    .select("email username")
    .lean();

  if (existing) {
    const errors = {};
    if (existing.email === email.toLowerCase())
      errors.email = "این ایمیل قبلاً ثبت شده است";
    if (existing.username === username.toLowerCase())
      errors.username = "این نام کاربری قبلاً ثبت شده است";
    const err = AppError.conflict("اطلاعات تکراری");
    err.errors = errors;
    throw err;
  }
};

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------
router.get(
  "/register",
  catchAsync(async (req, res) => {
    if (req.session?.user) return res.redirect(homeFor(req.session.user.role));
    // show "full for today" up front instead of after the form is filled in
    const { remaining } = await signupQuota
      .status()
      .catch(() => ({ remaining: 1 }));
    res.render("register", {
      title: "ثبت نام",
      signupFull: remaining <= 0,
      signupMessage: signupQuota.message,
    });
  }),
);

router.post(
  "/register",
  validateRequest(registerSchema),
  catchAsync(async (req, res) => {
    const { username, email, password } = req.validatedBody;

    // duplicates are rejected first so they never use up a slot
    await checkDuplicateUser(email, username);

    const slot = await signupQuota.reserve();
    if (!slot) throw signupQuota.fullError();

    let user;
    try {
      user = await User.create({
        username,
        email,
        password,
        // everybody starts as an ordinary account; a business is created later
        // from the dedicated /gym/create route
        role: "member",
        emailVerified: false,
        termsAcceptedAt: new Date(),
        termsVersion: CURRENT_TERMS_VERSION,
      });
    } catch (err) {
      await signupQuota.release(slot);
      throw err;
    }

    await createPendingSession(req, user, "verify");

    let emailSent = true;
    try {
      await sendOtpEmail(user, "verify");
    } catch (err) {
      emailSent = false;
      console.error("Verification mail failed:", err.message);
    }

    return res.status(201).json({
      success: true,
      message: emailSent
        ? "ثبت‌نام انجام شد. کد تأیید به ایمیل شما ارسال شد"
        : "ثبت‌نام انجام شد اما ارسال ایمیل ناموفق بود. در صفحه‌ی بعد دوباره درخواست کد دهید",
      redirect: "/auth/verify",
    });
  }),
);

// ---------------------------------------------------------------------------
// e-mail verification (OTP)
// ---------------------------------------------------------------------------
router.get(
  "/verify",
  catchAsync(async (req, res) => {
    const pending = getPending(req, "verify");
    if (!pending) return res.redirect("/auth/login");

    const user = await User.findById(pending.userId)
      .select("email username emailVerified role")
      .lean();
    if (!user) return res.redirect("/auth/login");
    if (user.emailVerified) return res.redirect("/auth/login");

    res.render("auth/verify", {
      title: "تأیید ایمیل",
      email: maskEmail(user.email),
      cooldown: await cooldownLeft(user._id, "verify"),
    });
  }),
);

router.post(
  "/verify",
  validateRequest(verifyCodeSchema),
  catchAsync(async (req, res) => {
    const pending = getPending(req, "verify");
    if (!pending)
      throw AppError.unauthorized("نشست منقضی شده است. دوباره وارد شوید");

    await verifyOtp(pending.userId, "verify", req.validatedBody.code);

    const user = await User.findOneAndUpdate(
      { _id: pending.userId, status: "active" },
      { $set: { emailVerified: true, emailVerifiedAt: new Date() } },
      { returnDocument: "after" },
    ).lean();
    if (!user) throw AppError.forbidden("حساب کاربری فعال نیست");

    return finishLogin(req, res, user, "ایمیل شما تأیید شد");
  }),
);

router.post(
  "/verify/resend",
  catchAsync(async (req, res) => {
    const pending = getPending(req, "verify");
    if (!pending)
      throw AppError.unauthorized("نشست منقضی شده است. دوباره وارد شوید");

    const user = await User.findById(pending.userId)
      .select("email username emailVerified")
      .lean();
    if (!user || user.emailVerified)
      throw AppError.badRequest("درخواست نامعتبر است");

    await sendOtpEmail(user, "verify");
    res.json({ success: true, message: "کد جدید ارسال شد", cooldown: 60 });
  }),
);

// ---------------------------------------------------------------------------
// password login
// ---------------------------------------------------------------------------
router.get("/login", (req, res) => {
  if (req.session?.user) return res.redirect(homeFor(req.session.user.role));
  res.render("login", { title: "ورود" });
});

router.post(
  "/login",
  validateRequest(loginSchema),
  catchAsync(async (req, res) => {
    const { email, password } = req.validatedBody;

    const user = await User.findOne({ email }).select(
      "+password +loginAttempts +lockUntil",
    );

    // Locked accounts are rejected BEFORE the password is checked
    if (user && user.isLocked()) {
      const minutes = Math.ceil(
        (user.lockUntil.getTime() - Date.now()) / 60000,
      );
      throw AppError.forbidden(
        `حساب کاربری شما به دلیل تلاش‌های ناموفق قفل شده است. ${minutes} دقیقه دیگر تلاش کنید`,
      );
    }

    const valid = await bcrypt.compare(
      password,
      user ? user.password : DUMMY_HASH,
    );

    if (!user || !valid || user.status === "deleted") {
      if (user && user.status !== "deleted") {
        const attempts = await user.incrementLoginAttempts();
        if (attempts >= 5) {
          throw AppError.forbidden(
            "پس از 5 تلاش ناموفق، حساب کاربری شما به مدت 30 دقیقه قفل می‌شود",
          );
        }
      }
      throw AppError.unauthorized("ایمیل یا رمز عبور اشتباه است");
    }

    // Password is right from here on.
    if (user.status === "pending_deletion") {
      await user.resetLoginAttempts();
      await createPendingSession(req, user, "cancel_deletion");
      return res.json({
        success: true,
        message: "درخواست حذف حساب شما در حال بررسی است",
        redirect: "/auth/cancel-deletion",
      });
    }

    if (user.status !== "active") {
      const messages = {
        suspended: "حساب کاربری شما تعلیق شده است",
        disabled: "حساب کاربری شما غیرفعال شده است",
      };
      throw AppError.forbidden(
        messages[user.status] || "حساب کاربری غیرفعال است",
      );
    }

    await user.resetLoginAttempts();

    // Not verified yet -> the dedicated OTP route (a fresh code is sent)
    if (!user.emailVerified) {
      await createPendingSession(req, user, "verify");
      try {
        await sendOtpEmail(user, "verify");
      } catch (err) {
        if (err.statusCode !== 429)
          console.error("Verification mail failed:", err.message);
      }
      return res.json({
        success: true,
        needsVerification: true,
        message: "ابتدا ایمیل خود را تأیید کنید",
        redirect: "/auth/verify",
      });
    }

    return finishLogin(req, res, user);
  }),
);

// ---------------------------------------------------------------------------
// passwordless login with an e-mailed code
// ---------------------------------------------------------------------------
router.get("/login/otp", (req, res) => {
  if (req.session?.user) return res.redirect(homeFor(req.session.user.role));
  res.render("auth/login-otp", { title: "ورود با کد" });
});

const GENERIC_SENT = "اگر حسابی با این ایمیل وجود داشته باشد، کد ورود ارسال شد";

router.post(
  "/login/otp/request",
  validateRequest(emailOnlySchema),
  catchAsync(async (req, res) => {
    const { email } = req.validatedBody;
    const user = await User.findOne({
      email,
      status: "active",
      emailVerified: true,
    }).select("email username role");

    if (user) {
      try {
        await sendOtpEmail(user, "login");
      } catch (err) {
        // the answer must not reveal whether the account exists
        if (err.statusCode !== 429)
          console.error("Login code mail failed:", err.message);
      }
    }
    res.json({ success: true, message: GENERIC_SENT, cooldown: 60 });
  }),
);

router.post(
  "/login/otp/verify",
  validateRequest(loginOtpVerifySchema),
  catchAsync(async (req, res) => {
    const { email, code } = req.validatedBody;
    const user = await User.findOne({
      email,
      status: "active",
      emailVerified: true,
    });
    if (!user) throw AppError.badRequest("کد نامعتبر یا منقضی شده است");

    await verifyOtp(user._id, "login", code);
    await user.resetLoginAttempts();
    return finishLogin(req, res, user);
  }),
);

// ---------------------------------------------------------------------------
// forgot / reset password
// ---------------------------------------------------------------------------
router.get("/forgot", (req, res) => {
  if (req.session?.user) return res.redirect(homeFor(req.session.user.role));
  res.render("auth/forgot", { title: "فراموشی رمز عبور" });
});

router.post(
  "/forgot",
  validateRequest(emailOnlySchema),
  catchAsync(async (req, res) => {
    const { email } = req.validatedBody;
    const user = await User.findOne({
      email,
      status: { $in: ["active", "pending_deletion"] },
    }).select("email username");

    if (user) {
      try {
        await sendOtpEmail(user, "reset");
      } catch (err) {
        if (err.statusCode !== 429)
          console.error("Reset mail failed:", err.message);
      }
    }
    res.json({
      success: true,
      message: "اگر حسابی با این ایمیل وجود داشته باشد، کد بازیابی ارسال شد",
      redirect: `/auth/reset?email=${encodeURIComponent(email)}`,
    });
  }),
);

router.get("/reset", (req, res) => {
  if (req.session?.user) return res.redirect(homeFor(req.session.user.role));
  const email =
    typeof req.query.email === "string" ? req.query.email.slice(0, 254) : "";
  res.render("auth/reset", { title: "تعیین رمز جدید", email });
});

router.post(
  "/reset",
  validateRequest(resetPasswordSchema),
  catchAsync(async (req, res) => {
    const { email, code, newPassword } = req.validatedBody;
    const user = await User.findOne({
      email,
      status: { $in: ["active", "pending_deletion"] },
    });
    if (!user) throw AppError.badRequest("کد نامعتبر یا منقضی شده است");

    await verifyOtp(user._id, "reset", code);

    // pre-save hook hashes it and bumps passwordChangedAt (kills old sessions)
    user.password = newPassword;
    user.loginAttempts = 0;
    user.lockUntil = null;
    // receiving the code proves the inbox is theirs
    user.emailVerified = true;
    user.emailVerifiedAt = user.emailVerifiedAt || new Date();
    await user.save();

    await clearUserSessions(user._id, user.username);
    disconnectUser(user._id);

    res.json({
      success: true,
      message: "رمز عبور تغییر کرد. وارد شوید",
      redirect: "/auth/login",
    });
  }),
);

// ---------------------------------------------------------------------------
// cancel a pending account-deletion request
// ---------------------------------------------------------------------------
router.get("/cancel-deletion", (req, res) => {
  if (!getPending(req, "cancel_deletion")) return res.redirect("/auth/login");
  res.render("auth/cancel-deletion", { title: "لغو حذف حساب" });
});

router.post(
  "/cancel-deletion",
  catchAsync(async (req, res) => {
    const pending = getPending(req, "cancel_deletion");
    if (!pending)
      throw AppError.unauthorized("نشست منقضی شده است. دوباره وارد شوید");

    await cancelAccountDeletion(pending.userId);
    const user = await User.findOne({
      _id: pending.userId,
      status: "active",
    }).lean();
    if (!user) throw AppError.badRequest("این درخواست دیگر قابل لغو نیست");

    return finishLogin(
      req,
      res,
      user,
      "درخواست حذف لغو شد و حساب شما فعال است",
    );
  }),
);

// ---------------------------------------------------------------------------
router.get("/logout", (req, res) => {
  res.clearCookie("faktorito.sid", {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  req.session.destroy((err) => {
    if (err) console.error("Logout error:", err);
    res.redirect("/auth/login");
  });
});

router.get(
  "/check-availability",
  validateRequest(checkAvailabilitySchema),
  catchAsync(async (req, res) => {
    const { email, username } = req.query;
    if (!email && !username) {
      throw AppError.badRequest(
        "حداقل یکی از پارامترهای email یا username را ارسال کنید",
      );
    }

    const query = [];
    if (typeof email === "string") query.push({ email: email.toLowerCase() });
    if (typeof username === "string")
      query.push({ username: username.toLowerCase() });

    const existing = await User.findOne({ $or: query })
      .select("email username")
      .lean();

    if (existing) {
      const taken = [];
      if (email && existing.email === String(email).toLowerCase())
        taken.push({ field: "email", message: "این ایمیل قبلاً ثبت شده است" });
      if (username && existing.username === String(username).toLowerCase())
        taken.push({
          field: "username",
          message: "این نام کاربری قبلاً ثبت شده است",
        });

      return res.json({
        success: true,
        available: false,
        taken,
        message:
          taken.length > 1
            ? "ایمیل و نام کاربری قبلاً ثبت شده است"
            : taken[0]?.message || "قبلاً ثبت شده است",
      });
    }

    return res.json({
      success: true,
      available: true,
      taken: [],
      message: "در دسترس است",
    });
  }),
);

export default router;
