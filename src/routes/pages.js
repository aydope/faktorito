const express = require("express");
const router = express.Router();

const Invoice = require("../models/Invoice");
const User = require("../models/User");
const Plan = require("../models/Plan");
const { planSchema } = require("../validators/plan");
const { authenticate } = require("../middleware/auth");
const catchAsync = require("../utils/catchAsync");
const { sanitizeBody } = require("../utils/sanitizer");
const { validateID } = require("../validators/mongooseId");
const {
  getUserInvoiceStats,
  findUserFromSession,
} = require("../utils/mongoose");
const AppError = require("../utils/AppError");
const { settingsSchema } = require("../validators/settings");
const {
  profileUpdateSchema,
  changePasswordSchema,
} = require("../validators/auth");
const validateSchema = require("../middleware/validateRequest");
const { checkDuplicateField } = require("../utils/helpers");
const checkAccountStatus = require("../middleware/checkAccountStatus");

router.get("/", (req, res) => {
  res.render("index", {
    title: "فاکتوریتو - مدیریت باشگاه",
  });
});

router.use(checkAccountStatus);

router.get(
  "/dashboard",
  authenticate,
  catchAsync(async (req, res) => {
    const stats = await getUserInvoiceStats(req.session?.user?.id);
    const user = await User.findById(req.session?.user?.id)
      .select("username role")
      .lean();

    res.render("dashboard", {
      title: "داشبورد",
      user,
      ...stats,
    });
  }),
);

router.get(
  "/i/:id",
  catchAsync(async (req, res) => {
    const { id } = req.params;
    validateID(id, { message: "شناسه فاکتور نامعتبر است" });

    const invoice = await Invoice.findById(id)
      .populate("user", "clubName clubPhone clubAddress clubEmail clubCode")
      .lean();

    if (!invoice) throw AppError.notFound("فاکتور پیدا نشد");

    const isOwner = req.session?.user?.id === invoice.user?._id?.toString();

    res.render("public-invoice", {
      title: `فاکتور ${invoice.invoiceNumber}`,
      invoice,
      isOwner,
    });
  }),
);

router.get(
  "/settings",
  authenticate,
  catchAsync(async (req, res) => {
    const user = await findUserFromSession(req.session.user.id);
    if (!user) throw AppError.notFound("کاربر پیدا نشد");
    res.render("settings", {
      title: "تنظیمات",
      user,
    });
  }),
);

router.put(
  "/settings",
  validateSchema(settingsSchema),
  sanitizeBody,
  authenticate,
  catchAsync(async (req, res) => {
    const { clubName } = req.validatedBody;

    const user = await User.findByIdAndUpdate(
      req.session.user.id,
      { $set: { ...req.validatedBody } },
      { new: true, runValidators: true },
    ).select("clubName");

    if (clubName) {
      req.session.user.clubName = clubName.trim();
    }

    return res.json({
      success: true,
      message: "تنظیمات با موفقیت ذخیره شد",
      data: { clubName: user.clubName },
    });
  }),
);

router.get(
  "/plans",
  authenticate,
  catchAsync(async (req, res) => {
    const plans = await Plan.find({ user: req.session.user.id })
      .select("name description price isActive createdAt")
      .sort({ createdAt: -1 })
      .lean();

    res.render("plans", {
      title: "مدیریت پلن‌ها",
      plans,
    });
  }),
);

router.post(
  "/plans",
  validateSchema(planSchema),
  sanitizeBody,
  authenticate,
  catchAsync(async (req, res) => {
    const { name, price, description } = req.validatedBody;
    const userId = req.session.user.id;
    const MAX_PLANS = 7;

    const planCount = await Plan.countDocuments({ user: userId });
    if (planCount >= MAX_PLANS) {
      return res.status(400).json({
        success: false,
        message: `حداکثر ${MAX_PLANS} پلن می‌توانید ایجاد کنید`,
      });
    }

    const normalizedName = name.trim().replace(/\s+/g, " ");
    const normalizedDesc = description
      ? description.trim().replace(/\s+/g, " ")
      : "";

    const existingPlan = await Plan.findOne({
      user: userId,
      $or: [
        {
          name: { $regex: new RegExp(`^${normalizedName}$`, "i") },
        },
        {
          name: { $regex: new RegExp(`^${normalizedName}$`, "i") },
          price: price,
        },
      ],
    });

    if (existingPlan) {
      const isNameMatch = /`^${normalizedName}$`/i.test(existingPlan.name);
      const isPriceMatch = existingPlan.price === price;

      if (isNameMatch && isPriceMatch) {
        return res.status(409).json({
          success: false,
          message: "پلنی با همین نام و قیمت قبلا ثبت شده است",
          validationErrors: {
            name: "این نام با همین قیمت قبلا ثبت شده است",
          },
        });
      } else if (isNameMatch) {
        return res.status(409).json({
          success: false,
          message: "پلنی با همین نام قبلا ثبت شده است",
          validationErrors: {
            name: "این نام قبلا ثبت شده است",
          },
        });
      }
    }

    const plan = await Plan.create({
      user: userId,
      name: normalizedName,
      price,
      description: normalizedDesc,
    });

    return res.status(201).json({
      success: true,
      message: "پلن جدید با موفقیت ایجاد شد",
      data: { planId: plan._id },
    });
  }),
);

router.put(
  "/plans/:id",
  validateSchema(planSchema),
  sanitizeBody,
  authenticate,
  catchAsync(async (req, res) => {
    const { id } = req.params;

    validateID(id, { message: "شناسه پلن نامعتبر است" });

    const plan = await Plan.findOneAndUpdate(
      { _id: id, user: req.session.user.id },
      { $set: { ...req.validatedBody } },
      { new: true, runValidators: true },
    );

    if (!plan) throw AppError.notFound("پلن پیدا نشد");

    return res.json({
      success: true,
      message: "پلن با موفقیت به‌روزرسانی شد",
    });
  }),
);

router.patch(
  "/plans/:id/toggle",
  authenticate,
  catchAsync(async (req, res) => {
    const { id } = req.params;

    validateID(id, { message: "شناسه پلن نامعتبر است" });

    const plan = await Plan.findOne({
      _id: id,
      user: req.session.user.id,
    }).select("isActive name");

    if (!plan) throw AppError.notFound("پلن پیدا نشد");

    plan.isActive = !plan.isActive;
    await plan.save();

    return res.json({
      success: true,
      isActive: plan.isActive,
      message: plan.isActive ? "پلن فعال شد" : "پلن غیرفعال شد",
    });
  }),
);

router.delete(
  "/plans/:id",
  authenticate,
  catchAsync(async (req, res) => {
    const { id } = req.params;

    validateID(id, { message: "شناسه پلن نامعتبر است" });

    const plan = await Plan.findOne({
      _id: id,
      user: req.session.user.id,
    })
      .select("name price")
      .lean();

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "پلن پیدا نشد",
      });
    }

    const isUsed = await Invoice.exists({
      user: req.session.user.id,
      "plan.name": plan.name,
      "plan.price": plan.price,
    });

    if (isUsed) {
      return res.status(400).json({
        success: false,
        error: "این پلن در فاکتورها استفاده شده و قابل حذف نیست",
      });
    }

    await Plan.findByIdAndDelete(id);

    return res.json({
      success: true,
      message: "پلن با موفقیت حذف شد",
    });
  }),
);

router.get(
  "/profile",
  authenticate,
  catchAsync(async (req, res) => {
    const user = await User.findById(req.session.user.id).select(
      "-password -__v -loginAttempts -lockUntil",
    );

    if (!user) {
      req.session.destroy((err) => {
        if (err) console.error("Session destroy error:", err);
      });
      return res.redirect("/auth/login");
    }

    res.render("profile", {
      title: "پروفایل کاربری | فاکتوریتو",
      user,
    });
  }),
);

router.put(
  "/profile/update",
  validateSchema(profileUpdateSchema),
  sanitizeBody,
  authenticate,
  catchAsync(async (req, res) => {
    const { username, email } = req.validatedBody;
    const userId = req.session.user.id;

    const user = await User.findById(userId);
    if (!user) throw AppError.notFound("کاربر یافت نشد");

    const validationErrors = {};

    if (username) {
      try {
        await checkDuplicateField("username", username, userId);
      } catch (error) {
        validationErrors.username = error.message;
      }
    }

    if (email) {
      try {
        await checkDuplicateField("email", email, userId);
      } catch (error) {
        validationErrors.email = error.message;
      }
    }

    if (Object.keys(validationErrors).length > 0) {
      return res.status(409).json({
        success: false,
        validationErrors,
      });
    }

    if (!username && !email) {
      return res.status(400).json({
        success: false,
        validationErrors: {
          general: "هیچ تغییری برای اعمال وجود ندارد",
        },
      });
    }

    const updates = {};
    if (username) {
      updates.username = username;
      user.username = updates.username;
      req.session.user.username = updates.username;
    }

    if (email) {
      updates.email = email;
      user.email = updates.email;
      req.session.user.email = updates.email;
    }

    await user.save({ validateModifiedOnly: true });

    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
      }
    });

    res.json({
      success: true,
      message: "اطلاعات با موفقیت به‌روزرسانی شد",
      user: {
        username: user.username,
        email: user.email,
      },
    });
  }),
);

router.post(
  "/change-password",
  validateSchema(changePasswordSchema),
  sanitizeBody,
  authenticate,
  catchAsync(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;

    const user = await User.findById(userId).select("+password");

    if (!user) throw AppError.notFound("کاربر یافت نشد");

    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      throw AppError.unauthorized("رمز عبور فعلی اشتباه است");
    }

    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      throw AppError.badRequest(
        "رمز عبور جدید نمی‌تواند با رمز عبور فعلی یکسان باشد",
      );
    }

    user.password = newPassword;
    await user.save({ validateModifiedOnly: true });

    res.json({
      success: true,
      message: "رمز عبور با موفقیت تغییر کرد",
    });
  }),
);

module.exports = router;
