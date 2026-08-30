const express = require("express");
const router = express.Router();

const Invoice = require("../models/Invoice");
const Plan = require("../models/Plan");
const { invoiceSchema, updateInvoiceSchema } = require("../validators/invoice");
const catchAsync = require("../utils/catchAsync");
const validateRequest = require("../middleware/validateRequest");
const AppError = require("../utils/AppError");
const { authenticate } = require("../middleware/auth");
const { calculateTotals, setupPagination } = require("../utils/helpers");
const { findUserInvoice, findUserPlan } = require("../utils/mongoose");
const { sanitizeBody } = require("../utils/sanitizer");

router.get(
  "/",
  authenticate,
  catchAsync(async (req, res) => {
    const { invoices, currentPage, totalPages, totalCount, limit } =
      await setupPagination(req, res);

    if (req.headers["x-requested-with"] === "XMLHttpRequest") {
      return res.json({
        success: true,
        invoices,
        pagination: {
          currentPage,
          totalPages,
          totalCount,
          limit,
          hasNext: currentPage < totalPages,
          hasPrev: currentPage > 1,
        },
      });
    }

    res.render("invoices", {
      title: "فاکتورهای من",
      invoices,
      pagination: {
        currentPage,
        totalPages,
        totalCount,
        limit,
        hasNext: currentPage < totalPages,
        hasPrev: currentPage > 1,
      },
    });
  }),
);

router.get(
  "/new",
  authenticate,
  catchAsync(async (req, res) => {
    const plans = await Plan.find({
      user: req.session.user.id,
      isActive: true,
    })
      .select("name price description")
      .sort({ name: 1 })
      .lean();

    res.render("create-invoice", {
      title: "ایجاد فاکتور جدید",
      plans,
    });
  }),
);

router.post(
  "/",
  validateRequest(invoiceSchema),
  sanitizeBody,
  authenticate,
  catchAsync(async (req, res) => {
    const {
      memberName,
      memberPhone = "",
      memberId = "",
      planId,
      cafeItems = [],
      discounts = [],
      note = "",
    } = req.validatedBody;

    const invoicesCount = await Invoice.countDocuments({
      user: req.session.user.id,
      isPaid: false,
    });

    const MAX_INVOICES = 50;

    if (invoicesCount >= MAX_INVOICES) {
      return res.status(400).json({
        success: false,
        message: `حداکثر ${MAX_INVOICES} فاکتور می‌توانید ایجاد کنید`,
        redirect: "/invoices",
      });
    }

    const plan = await findUserPlan(planId, req.session.user.id);

    const { extraItems, totalAmount, extraTotal } = calculateTotals(
      plan.price,
      cafeItems,
      discounts,
    );

    const [invoiceNumber, trackingCode] = await Promise.all([
      Invoice.generateInvoiceNumber(),
      Promise.resolve(Invoice.generateTrackingCode()),
    ]);

    const invoice = await Invoice.create({
      user: req.session.user.id,
      invoiceNumber,
      trackingCode,
      member: {
        name: memberName.trim(),
        phone: memberPhone || "-",
        memberId: memberId || "-",
      },
      plan: {
        name: plan.name,
        price: plan.price,
        description: plan.description || "",
      },
      extraItems,
      note: note.trim(),
      totalAmount,
      extraTotal,
      invoiceDate: new Date().toLocaleDateString("fa-IR-u-nu-latn", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    });

    return res.status(201).json({
      success: true,
      message: "فاکتور با موفقیت ایجاد شد",
      redirect: `/i/${invoice._id}`,
      invoiceId: invoice._id,
    });
  }),
);

router.get(
  "/:id/edit",
  authenticate,
  catchAsync(async (req, res) => {
    const invoice = await findUserInvoice(req.params.id, req.session.user.id);

    const plans = await Plan.find({
      user: req.session.user.id,
      isActive: true,
    })
      .select("name price description")
      .sort({ name: 1 })
      .lean();

    res.render("edit-invoice", {
      title: "ویرایش فاکتور",
      invoice,
      plans,
    });
  }),
);

router.put(
  "/:id",
  validateRequest(updateInvoiceSchema),
  sanitizeBody,
  authenticate,
  catchAsync(async (req, res) => {
    const { memberName, memberPhone, memberId, note, isPaid } =
      req.validatedBody;
    const invoice = await findUserInvoice(req.params.id, req.session.user.id);

    if (invoice.isPaid) {
      throw AppError.badRequest("فاکتور پرداخت شده قابل ویرایش نیست");
    }

    invoice.member.name = memberName;
    invoice.member.phone = memberPhone || "-";
    invoice.member.memberId = memberId || "-";
    invoice.note = note;

    if (isPaid === "true" && !invoice.isPaid) {
      invoice.isPaid = true;
      invoice.paidAt = new Date();
    }

    if (req.body.planId && req.body.planId !== invoice.plan?._id?.toString()) {
      const plan = await findUserPlan(req.body.planId, req.session.user.id);

      invoice.plan = {
        name: plan.name,
        price: plan.price,
        description: plan.description || "",
      };

      invoice.totalAmount = plan.price + (invoice.extraTotal || 0);
    }

    await invoice.save();

    return res.json({
      success: true,
      message: "فاکتور با موفقیت به‌روزرسانی شد",
      redirect: `/i/${invoice._id}`,
    });
  }),
);

router.delete(
  "/:id",
  authenticate,
  catchAsync(async (req, res) => {
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "فاکتور پیدا نشد",
      });
    }

    if (invoice.user.toString() !== req.session.user.id) {
      return res.status(403).json({
        success: false,
        message: "شما دسترسی به این فاکتور را ندارید",
      });
    }

    await Invoice.findByIdAndDelete(req.params.id);

    return res.json({
      success: true,
      message: `فاکتور #${invoice.invoiceNumber} با موفقیت حذف شد`,
    });
  }),
);

router.patch(
  "/:id/toggle-payment",
  authenticate,
  catchAsync(async (req, res) => {
    const invoice = await findUserInvoice(req.params.id, req.session.user.id);

    if (invoice.isPaid) {
      throw AppError.badRequest(
        "این فاکتور قبلاً پرداخت شده و قابل تغییر نیست",
      );
    }

    invoice.isPaid = true;
    invoice.paidAt = new Date();
    await invoice.save();

    return res.json({
      success: true,
      message: "پرداخت با موفقیت تأیید شد",
      isPaid: true,
      paidAt: invoice.paidAt,
    });
  }),
);

module.exports = router;
