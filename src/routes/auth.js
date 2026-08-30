const express = require("express");
const router = express.Router();
const User = require("../models/User");
const {
  registerSchema,
  loginSchema,
  checkAvailabilitySchema,
} = require("../validators/auth");
const catchAsync = require("../utils/catchAsync");
const validateRequest = require("../middleware/validateRequest");
const AppError = require("../utils/AppError");

const createUserSession = (req, user) => {
  req.session.user = {
    id: user._id,
    username: user.username,
    email: user.email,
    clubName: user.clubName,
    role: user.role,
  };

  return new Promise((resolve, reject) => {
    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return reject(AppError.internal("خطا در ذخیره سشن"));
      }
      resolve();
    });
  });
};

const clearUserSession = (req, res) => {
  return new Promise((resolve) => {
    res.clearCookie("faktorito.sid", {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    req.session.destroy((err) => {
      if (err) console.error("Logout error:", err);
      resolve();
    });
  });
};

const checkDuplicateUser = async (email, username) => {
  const existingUser = await User.findOne({
    $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }],
  })
    .select("email username")
    .lean();

  if (existingUser) {
    const errors = {};
    if (existingUser.email === email.toLowerCase()) {
      errors.email = "این ایمیل قبلاً ثبت شده است";
    }
    if (existingUser.username === username.toLowerCase()) {
      errors.username = "این نام کاربری قبلاً ثبت شده است";
    }
    throw AppError.conflict("اطلاعات تکراری", errors);
  }
};

const handleFailedLogin = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    await user.incrementLoginAttempts();
  } catch (error) {
    console.error("Error incrementing login attempts:", error);
  }
};

const handleSuccessfulLogin = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    await user.resetLoginAttempts();
  } catch (error) {
    console.error("Error resetting login attempts:", error);
  }
};

router.get("/register", (req, res) => {
  if (req.session?.user) return res.redirect("/dashboard");

  res.render("register", {
    title: "ثبت نام",
  });
});

router.post(
  "/register",
  validateRequest(registerSchema),
  catchAsync(async (req, res) => {
    const { username, email, password, clubName } = req.validatedBody;

    await checkDuplicateUser(email, username);

    const user = await User.create({
      username,
      email,
      password,
      clubName: clubName?.trim() || "باشگاه من",
    });

    await createUserSession(req, user);

    return res.status(201).json({
      success: true,
      message: "ثبت‌نام با موفقیت انجام شد",
      redirect: "/dashboard",
    });
  }),
);

router.get("/login", (req, res) => {
  if (req.session?.user) return res.redirect("/dashboard");

  res.render("login", {
    title: "ورود",
  });
});

router.post(
  "/login",
  validateRequest(loginSchema),
  catchAsync(async (req, res) => {
    const { email, password } = req.validatedBody;

    const user = await User.findOne({ email })
      .select("+password +loginAttempts +lockUntil")
      .lean();

    if (!user) {
      throw AppError.unauthorized("ایمیل یا رمز عبور اشتباه است");
    }

    const isPasswordValid = await User.prototype.comparePassword.call(
      { password: user.password },
      password,
    );

    if (!isPasswordValid) {
      await handleFailedLogin(user._id);

      const updatedUser = await User.findById(user._id).select(
        "+loginAttempts +lockUntil",
      );

      if (updatedUser && updatedUser.loginAttempts >= 5) {
        throw AppError.forbidden(
          "پس از 5 تلاش ناموفق، حساب کاربری شما به مدت 30 دقیقه قفل می‌شود",
          403,
        );
      }

      throw AppError.unauthorized("ایمیل یا رمز عبور اشتباه است");
    }

    if (user.isLocked && user.isLocked()) {
      const lockTime = user.lockUntil;
      const remainingMinutes = Math.ceil((lockTime - Date.now()) / (60 * 1000));
      throw AppError.forbidden(
        `حساب کاربری شما به دلیل تلاش‌های ناموفق قفل شده است. ${remainingMinutes} دقیقه دیگر تلاش کنید`,
      );
    }

    if (user.status !== "active") {
      const statusMessages = {
        suspended: "حساب کاربری شما تعلیق شده است",
        disabled: "حساب کاربری شما غیرفعال شده است",
      };

      return res.status(403).json({
        success: false,
        errors: [statusMessages[user.status] || "حساب کاربری غیرفعال است"],
      });
    }

    await handleSuccessfulLogin(user._id);

    const sessionUser = {
      _id: user._id,
      username: user.username,
      email: user.email,
      clubName: user.clubName,
      role: user.role,
    };

    await createUserSession(req, sessionUser);

    const redirectUrl = req.session.returnTo || "/dashboard";
    delete req.session.returnTo;

    return res.json({
      success: true,
      message: "ورود موفقیت‌آمیز",
      redirect: redirectUrl,
    });
  }),
);

router.get("/logout", async (req, res) => {
  await clearUserSession(req, res);
  res.redirect("/auth/login");
});

router.get(
  "/check-availability",
  validateRequest(checkAvailabilitySchema),
  catchAsync(async (req, res) => {
    const { email, username } = req.query;

    if (!email && !username) {
      return res.status(400).json({
        success: false,
        message: "حداقل یکی از پارامترهای email یا username را ارسال کنید",
      });
    }

    const query = [];

    if (email) {
      query.push({ email: email.toLowerCase() });
    }

    if (username) {
      query.push({ username: username.toLowerCase() });
    }

    const existingUser = await User.findOne({
      $or: query,
    })
      .select("email username")
      .lean();

    if (existingUser) {
      const taken = [];

      if (email && existingUser.email === email.toLowerCase()) {
        taken.push({
          field: "email",
          message: "این ایمیل قبلاً ثبت شده است",
        });
      }

      if (username && existingUser.username === username.toLowerCase()) {
        taken.push({
          field: "username",
          message: "این نام کاربری قبلاً ثبت شده است",
        });
      }

      return res.status(200).json({
        success: true,
        available: false,
        taken,
        message:
          taken.length > 1
            ? "ایمیل و نام کاربری قبلاً ثبت شده است"
            : taken[0]?.message || "قبلاً ثبت شده است",
      });
    }

    return res.status(200).json({
      success: true,
      available: true,
      taken: [],
      message: "در دسترس است",
    });
  }),
);

module.exports = router;
