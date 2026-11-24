import express from "express";
import { toSheet, sampleSheet, makeQr, THEMES } from "../utils/invoiceSheet.js";
import { renderAvatar } from "../utils/avatar.js";
import { getLegal } from "../config/legal.js";
import { LIMITS, LIMIT_LABELS } from "../config/limits.js";
import { safeSignaturePath } from "../utils/signature.js";
const router = express.Router();

import Invoice from "../models/Invoice.js";
import User from "../models/User.js";
import Plan from "../models/Plan.js";
import { planSchema } from "../validators/plan.js";
import { authenticate, ownerArea } from "../middleware/auth.js";
import catchAsync from "../utils/catchAsync.js";
import { sanitizeBody } from "../utils/sanitizer.js";
import { validateID, isObjectId } from "../validators/mongooseId.js";
import { escapeRegex } from "../utils/query.js";
import { generatePublicId } from "../utils/crypto.js";
import { maskPhone } from "../services/memberService.js";
import { getUserInvoiceStats, findUserFromSession } from "../utils/mongoose.js";
import AppError from "../utils/AppError.js";
import { assertBelow, getUsage } from "../services/limitsService.js";
import { settingsSchema } from "../validators/settings.js";
import {
  profileUpdateSchema,
  changePasswordSchema,
} from "../validators/auth.js";
import validateSchema from "../middleware/validateRequest.js";
import { checkDuplicateField } from "../utils/helpers.js";
import checkAccountStatus from "../middleware/checkAccountStatus.js";

router.get(
  "/",
  catchAsync(async (req, res) => {
    const origin = (
      process.env.APP_URL || `${req.protocol}://${req.get("host")}`
    ).replace(/\/+$/, "");
    res.render("index", {
      title: "فاکتوریتو - مدیریت باشگاه",
      // the SAME sheet partial as the real invoice, filled with sample data
      sheet: await sampleSheet({ theme: "aurora", origin }),
      themes: THEMES,
    });
  }),
);

// ---- legal pages: public, no login needed ----
router.get("/terms", (req, res) =>
  res.render("legal/terms", { title: "شرایط استفاده", legal: getLegal() }),
);
router.get("/privacy", (req, res) =>
  res.render("legal/privacy", { title: "حریم خصوصی", legal: getLegal() }),
);
router.get("/terms/business", (req, res) =>
  res.render("legal/business-terms", {
    title: "شرایط ویژه‌ی صاحبان باشگاه",
    legal: getLegal(),
    limits: Object.keys(LIMITS).map((k) => ({
      label: LIMIT_LABELS[k],
      max: LIMITS[k],
    })),
  }),
);

router.use(checkAccountStatus);

router.get(
  "/dashboard",
  ownerArea,
  catchAsync(async (req, res) => {
    const stats = await getUserInvoiceStats(req.session?.user?.id);
    const user = await User.findById(req.session?.user?.id)
      .select("username role")
      .lean();

    res.render("dashboard", {
      title: "داشبورد",
      active: "dashboard",
      user,
      ...stats,
    });
  }),
);

// Public invoices are served from an UNGUESSABLE id (publicId). The Mongo
// ObjectId is predictable (timestamp + counter), so it only works for the
// owner / staff, who are redirected to the public link.
const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{20,40}$/;

router.get(
  "/i/:id",
  catchAsync(async (req, res) => {
    const { id } = req.params;

    if (isObjectId(id)) {
      const sessionUser = req.session?.user;
      if (!sessionUser) throw AppError.notFound("فاکتور پیدا نشد");

      const found = await Invoice.findById(id).select("user publicId").lean();
      if (!found) throw AppError.notFound("فاکتور پیدا نشد");

      const isOwnerOfInvoice = String(found.user) === String(sessionUser.id);
      if (!isOwnerOfInvoice) {
        const viewer = await User.findById(sessionUser.id)
          .select("role")
          .lean();
        if (!viewer || !["admin", "moderator"].includes(viewer.role)) {
          throw AppError.notFound("فاکتور پیدا نشد");
        }
      }

      let publicId = found.publicId;
      if (!publicId) {
        // lazy back-fill for invoices created before publicId existed
        await Invoice.updateOne(
          { _id: id, publicId: { $exists: false } },
          { $set: { publicId: generatePublicId() } },
        );
        publicId = (await Invoice.findById(id).select("publicId").lean())
          .publicId;
      }
      return res.redirect(`/i/${publicId}`);
    }

    if (!PUBLIC_ID_RE.test(id)) throw AppError.notFound("فاکتور پیدا نشد");

    const invoice = await Invoice.findOne({ publicId: id })
      .populate(
        "user",
        "clubName clubPhone clubAddress clubEmail clubCode invoiceTheme signature",
      )
      .lean();

    if (!invoice) throw AppError.notFound("فاکتور پیدا نشد");

    const isOwner = req.session?.user?.id === invoice.user?._id?.toString();

    // Anyone with the link can read it -> hide most of the phone number
    if (!isOwner && invoice.member) {
      invoice.member.phone = maskPhone(invoice.member.phone);
    }

    // QR of the share link. The base comes from APP_URL when configured; the
    // Host header is only a development fallback (it only affects this response).
    const base = (
      process.env.APP_URL || `${req.protocol}://${req.get("host")}`
    ).replace(/\/+$/, "");
    const qrSvg = await makeQr(`${base}/i/${invoice.publicId}`);

    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.render("public-invoice", {
      title: `فاکتور ${invoice.invoiceNumber}`,
      isOwner,
      sheet: toSheet({ invoice, owner: invoice.user, qrSvg }),
    });
  }),
);

router.get(
  "/settings",
  ownerArea,
  catchAsync(async (req, res) => {
    const user = await findUserFromSession(req.session.user.id);
    if (!user) throw AppError.notFound("کاربر پیدا نشد");
    res.render("settings", {
      title: "تنظیمات",
      user,
      themes: THEMES,
      avatarHtml: renderAvatar(String(user._id), user.clubName),
      usage: await getUsage(user._id),
      hasSignature: !!safeSignaturePath(user.signature?.path),
    });
  }),
);

router.put(
  "/settings",
  ownerArea,
  validateSchema(settingsSchema),
  sanitizeBody,
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
  ownerArea,
  catchAsync(async (req, res) => {
    const plans = await Plan.find({ user: req.session.user.id })
      .select("name description price isActive createdAt")
      .sort({ createdAt: -1 })
      .lean();

    res.render("plans", {
      title: "مدیریت پلن‌ها",
      active: "plans",
      plans,
    });
  }),
);

router.post(
  "/plans",
  ownerArea,
  validateSchema(planSchema),
  sanitizeBody,
  catchAsync(async (req, res) => {
    const { name, price, description } = req.validatedBody;
    const userId = req.session.user.id;

    assertBelow(await Plan.countDocuments({ user: userId }), "plans");

    const normalizedName = name.trim().replace(/\s+/g, " ");
    const normalizedDesc = description
      ? description.trim().replace(/\s+/g, " ")
      : "";

    // The name used to be interpolated into a RegExp unescaped (regex
    // injection / ReDoS), and the "isNameMatch" check was always false.
    const existingPlan = await Plan.findOne({
      user: userId,
      name: new RegExp(`^${escapeRegex(normalizedName)}$`, "i"),
    }).lean();

    if (existingPlan) {
      const samePrice = existingPlan.price === price;
      return res.status(409).json({
        success: false,
        message: samePrice
          ? "پلنی با همین نام و قیمت قبلا ثبت شده است"
          : "پلنی با همین نام قبلا ثبت شده است",
        validationErrors: {
          name: samePrice
            ? "این نام با همین قیمت قبلا ثبت شده است"
            : "این نام قبلا ثبت شده است",
        },
      });
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
  ownerArea,
  validateSchema(planSchema),
  sanitizeBody,
  catchAsync(async (req, res) => {
    const { id } = req.params;

    validateID(id, { message: "شناسه پلن نامعتبر است" });

    const plan = await Plan.findOneAndUpdate(
      { _id: id, user: req.session.user.id },
      { $set: req.validatedBody },
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
  ownerArea,
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
  ownerArea,
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
      $or: [
        { "plan.planRef": plan._id },
        { "plan.name": plan.name, "plan.price": plan.price },
      ],
    });

    if (isUsed) {
      return res.status(400).json({
        success: false,
        message: "این پلن در فاکتورها استفاده شده و قابل حذف نیست",
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
  authenticate,
  validateSchema(profileUpdateSchema),
  sanitizeBody,
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
  authenticate,
  validateSchema(changePasswordSchema),
  sanitizeBody,
  catchAsync(async (req, res) => {
    const { currentPassword, newPassword } = req.validatedBody;
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

    // Sessions created before this moment are rejected by `authenticate`
    // (passwordChangedAt > authAt); keep the current one alive.
    req.session.authAt = Date.now() + 2000;
    await new Promise((resolve) => req.session.save(resolve));

    res.json({
      success: true,
      message: "رمز عبور با موفقیت تغییر کرد",
    });
  }),
);

export default router;
