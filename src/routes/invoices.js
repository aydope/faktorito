import express from "express";
const router = express.Router();
// update / delete / toggle-payment: refresh the owner's pages and the member's panel
router.use(
  liveAfterMutation(async (req) => {
    const id = req.originalUrl.match(/\/invoices\/([a-f0-9]{24})/i)?.[1];
    const invoice = id
      ? await Invoice.findById(id).select("user memberRef").lean()
      : null;
    const member = invoice?.memberRef
      ? await Member.findById(invoice.memberRef).select("account").lean()
      : null;
    if (invoice) emitInvoiceLive(invoice, member);
    else if (req.session?.user?.id)
      emitInvoiceLive({ user: req.session.user.id }, null); // a deleted invoice: only the owner's pages
  }),
);

import Invoice from "../models/Invoice.js";
import Plan from "../models/Plan.js";
import Member from "../models/Member.js";
import { invoiceSchema, updateInvoiceSchema } from "../validators/invoice.js";
import catchAsync from "../utils/catchAsync.js";
import validateRequest from "../middleware/validateRequest.js";
import AppError from "../utils/AppError.js";
import { authenticate } from "../middleware/auth.js";
import {
  calculateTotals,
  setupPagination,
  buildInvoiceFilter,
} from "../utils/helpers.js";
import { findUserInvoice, findUserPlan } from "../utils/mongoose.js";
import { applyPaymentToMember } from "../services/memberService.js";
import { planSnapshot } from "../services/invoiceService.js";
import { assertBelow, dayAgo } from "../services/limitsService.js";
import { liveAfterMutation, emitInvoiceLive } from "../realtime/live.js";
import {
  announceInvoiceIssued,
  announcePayment,
} from "../services/invoiceNotifier.js";
import { isObjectId } from "../validators/mongooseId.js";
import { toCsv } from "../utils/query.js";

const NO_PLAN_NAME = "فروش متفرقه";

/**
 * Atomically flips an invoice from unpaid to paid (so two parallel requests
 * can't both "pay" it) and then updates the linked member.
 * Returns the updated invoice, or null if it was already paid.
 */
const markInvoicePaid = async (invoiceId, userId) => {
  const invoice = await Invoice.findOneAndUpdate(
    { _id: invoiceId, user: userId, isPaid: false },
    { $set: { isPaid: true, paidAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!invoice) return null;

  const member = await applyPaymentToMember(invoice);
  announcePayment({ invoice, member }); // fire-and-forget (never blocks the request)
  return invoice;
};

const listPayload = (data) => ({
  currentPage: data.currentPage,
  totalPages: data.totalPages,
  totalCount: data.totalCount,
  limit: data.limit,
  hasNext: data.hasNext,
  hasPrev: data.hasPrev,
});

router.get(
  "/",
  authenticate,
  catchAsync(async (req, res) => {
    const data = await setupPagination(req, res);
    const pagination = listPayload(data);

    if (req.headers["x-requested-with"] === "XMLHttpRequest") {
      return res.json({ success: true, invoices: data.invoices, pagination });
    }

    res.render("invoices", {
      title: "فاکتورهای من",
      invoices: data.invoices,
      pagination,
      filters: data.filters,
    });
  }),
);

router.get(
  "/export.csv",
  authenticate,
  catchAsync(async (req, res) => {
    const { filter } = buildInvoiceFilter(req.query, req.session.user.id);
    const invoices = await Invoice.find(filter)
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();

    const csv = toCsv(
      [
        "شماره فاکتور",
        "تاریخ",
        "نام عضو",
        "تلفن",
        "کد عضو",
        "پلن",
        "مبلغ (تومان)",
        "وضعیت",
        "تاریخ پرداخت",
      ],
      invoices.map((i) => [
        i.invoiceNumber,
        i.invoiceDate,
        i.member?.name,
        i.member?.phone,
        i.member?.memberId,
        i.plan?.name,
        i.totalAmount,
        i.isPaid ? "پرداخت شده" : "در انتظار پرداخت",
        i.paidAt
          ? new Date(i.paidAt).toLocaleDateString("fa-IR-u-nu-latn")
          : "",
      ]),
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="invoices.csv"');
    res.send(csv);
  }),
);

router.get(
  "/new",
  authenticate,
  catchAsync(async (req, res) => {
    const userId = req.session.user.id;

    const plans = await Plan.find({ user: userId, isActive: true })
      .select("name price description")
      .sort({ name: 1 })
      .lean();

    // /invoices/new?member=<id> -> pre-select a member (scoped to the owner)
    let preselectedMember = null;
    const memberParam = req.query.member;
    if (isObjectId(memberParam)) {
      preselectedMember = await Member.findOne({
        _id: memberParam,
        user: userId,
      })
        .select("name phone code")
        .lean();
    }

    res.render("create-invoice", {
      title: "ایجاد فاکتور جدید",
      plans,
      preselectedMember,
    });
  }),
);

router.post(
  "/",
  authenticate,
  validateRequest(invoiceSchema),
  catchAsync(async (req, res) => {
    const userId = req.session.user.id;
    const {
      memberName,
      memberPhone = "",
      memberId = "",
      memberRef,
      saveAsMember,
      planId,
      periodMonths,
      items = [],
      discounts = [],
      note = "",
    } = req.validatedBody;

    assertBelow(
      await Invoice.countDocuments({ user: userId, isPaid: false }),
      "unpaidInvoices",
    );
    assertBelow(
      await Invoice.countDocuments({
        user: userId,
        createdAt: { $gte: dayAgo() },
      }),
      "invoicesPerDay",
    );

    // Plan is optional (a sale of extras only) but the invoice can't be empty
    const plan = planId ? await findUserPlan(planId, userId) : null;
    if (!plan && items.length === 0) {
      throw AppError.badRequest(
        "حداقل یک پلن یا یک آیتم برای فاکتور انتخاب کنید",
      );
    }

    // ---- who is the invoice for? ----
    let member = null;
    if (memberRef) {
      member = await Member.findOne({ _id: memberRef, user: userId });
      if (!member) throw AppError.notFound("عضو انتخاب‌شده پیدا نشد");
    } else if (saveAsMember) {
      // reuse an existing member with the same phone instead of duplicating
      if (memberPhone)
        member = await Member.findOne({ user: userId, phone: memberPhone });

      if (!member) {
        member = await Member.create({
          user: userId,
          code: await Member.generateCode(userId),
          name: memberName.trim(),
          phone: memberPhone || "",
        });
      }
    }

    const { extraItems, totalAmount, extraTotal } = calculateTotals(
      plan ? plan.price : 0,
      items,
      discounts,
    );

    const [invoiceNumber, trackingCode] = await Promise.all([
      Invoice.generateInvoiceNumber(),
      Promise.resolve(Invoice.generateTrackingCode()),
    ]);

    const invoice = await Invoice.create({
      user: userId,
      memberRef: member ? member._id : null,
      invoiceNumber,
      trackingCode,
      member: {
        name: member ? member.name : memberName.trim(),
        phone: (member ? member.phone : memberPhone) || "-",
        memberId: (member ? member.code : memberId) || "-",
      },
      plan: plan
        ? planSnapshot(plan, periodMonths)
        : {
            name: NO_PLAN_NAME,
            price: 0,
            description: "",
            durationUnit: "none",
            durationValue: 0,
            durationDays: 0,
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

    announceInvoiceIssued({ invoice, member });

    return res.status(201).json({
      success: true,
      message: "فاکتور با موفقیت ایجاد شد",
      redirect: `/i/${invoice.publicId}`,
      invoiceId: invoice._id,
    });
  }),
);

router.get(
  "/:id/edit",
  authenticate,
  catchAsync(async (req, res) => {
    const invoice = await findUserInvoice(req.params.id, req.session.user.id);

    const plans = await Plan.find({ user: req.session.user.id, isActive: true })
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
  authenticate,
  validateRequest(updateInvoiceSchema),
  catchAsync(async (req, res) => {
    const userId = req.session.user.id;
    const {
      memberName,
      memberPhone,
      memberId,
      planId,
      periodMonths,
      note,
      isPaid,
    } = req.validatedBody;
    const invoice = await findUserInvoice(req.params.id, userId);

    if (invoice.isPaid) {
      throw AppError.badRequest("فاکتور پرداخت شده قابل ویرایش نیست");
    }

    // Only touch what was actually sent (the old code wrote `undefined`
    // into required fields when a field was omitted).
    if (memberName !== undefined) invoice.member.name = memberName;
    if (memberPhone !== undefined) invoice.member.phone = memberPhone || "-";
    // A linked member's code is system-generated and can't be edited here
    if (memberId !== undefined && !invoice.memberRef) {
      invoice.member.memberId = memberId || "-";
    }
    if (note !== undefined) invoice.note = note || "";

    if (planId && planId !== String(invoice.plan?.planRef || "")) {
      const plan = await findUserPlan(planId, userId);

      // keep the period the invoice already had unless a new one was sent
      const months =
        periodMonths ??
        (invoice.plan?.durationUnit === "month"
          ? invoice.plan.durationValue
          : 0);
      invoice.plan = planSnapshot(plan, months);
      invoice.totalAmount = Math.max(0, plan.price + (invoice.extraTotal || 0));
    } else if (periodMonths !== undefined && invoice.plan?.planRef) {
      invoice.plan.durationUnit = periodMonths > 0 ? "month" : "none";
      invoice.plan.durationValue = periodMonths;
      invoice.plan.durationDays = periodMonths * 30;
    }

    await invoice.save();

    if (isPaid === "true") {
      await markInvoicePaid(invoice._id, userId);
    }

    return res.json({
      success: true,
      message: "فاکتور با موفقیت به‌روزرسانی شد",
      redirect: `/i/${invoice.publicId || invoice._id}`,
    });
  }),
);

router.delete(
  "/:id",
  authenticate,
  catchAsync(async (req, res) => {
    const invoice = await findUserInvoice(req.params.id, req.session.user.id);

    // Paid invoices are financial records and feed the member's totals/expiry
    if (invoice.isPaid) {
      throw AppError.badRequest("فاکتور پرداخت‌شده قابل حذف نیست");
    }

    await Invoice.deleteOne({ _id: invoice._id, user: req.session.user.id });

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
    const userId = req.session.user.id;
    // 404 for foreign/non-existing ids, validates the id format
    const existing = await findUserInvoice(req.params.id, userId);

    const invoice = await markInvoicePaid(existing._id, userId);
    if (!invoice) {
      throw AppError.badRequest(
        "این فاکتور قبلاً پرداخت شده و قابل تغییر نیست",
      );
    }

    return res.json({
      success: true,
      message: "پرداخت با موفقیت تأیید شد",
      isPaid: true,
      paidAt: invoice.paidAt,
    });
  }),
);

export default router;
