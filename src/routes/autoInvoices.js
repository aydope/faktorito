import express from "express";
import AutoInvoice from "../models/AutoInvoice.js";
import Member from "../models/Member.js";
import Plan from "../models/Plan.js";
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/AppError.js";
import validateRequest from "../middleware/validateRequest.js";
import { validateID } from "../validators/mongooseId.js";
import {
  autoRuleSchema,
  autoRulePatchSchema,
} from "../validators/autoInvoice.js";
import { periodLabel } from "../utils/period.js";
import { issueRule } from "../jobs/autoInvoices.js";
import { LIMITS } from "../config/limits.js";
import { assertBelow } from "../services/limitsService.js";

const router = express.Router();
const view = (r) => ({
  ...r,
  interval: periodLabel(r.intervalMonths || 1),
});

// ---------- overview page ----------
router.get(
  "/",
  catchAsync(async (req, res) => {
    const rules = await AutoInvoice.find({ user: req.session.user.id })
      .populate("member", "name code status deletedAt")
      .populate("plan", "name price isActive")
      .sort({ nextIssueAt: 1 })
      .limit(LIMITS.autoRules * 3)
      .lean();

    res.render("auto-invoices", {
      title: "صدور خودکار فاکتور",
      active: "auto",
      rules: rules.filter((r) => r.member).map(view),
    });
  }),
);

const loadMemberAndPlan = async (userId, memberId, planId) => {
  const [member, plan] = await Promise.all([
    Member.findOne({ _id: memberId, user: userId }).lean(),
    Plan.findOne({ _id: planId, user: userId }).lean(),
  ]);
  if (!member) throw AppError.notFound("عضو پیدا نشد");
  if (member.status === "inactive")
    throw AppError.badRequest(
      "برای عضو غیرفعال نمی‌توان صدور خودکار تنظیم کرد",
    );
  if (!plan || !plan.isActive)
    throw AppError.badRequest("پلن انتخاب‌شده معتبر یا فعال نیست");
  return { member, plan };
};

// ---------- create / replace the rule of one member ----------
router.put(
  "/member/:memberId",
  validateRequest(autoRuleSchema),
  catchAsync(async (req, res) => {
    validateID(req.params.memberId, { message: "شناسه عضو نامعتبر است" });
    const userId = req.session.user.id;
    const {
      planId,
      intervalMonths,
      nextIssueAt,
      active = true,
      note = "",
    } = req.validatedBody;

    const { member } = await loadMemberAndPlan(
      userId,
      req.params.memberId,
      planId,
    );

    const exists = await AutoInvoice.exists({ member: member._id });
    if (!exists)
      assertBelow(
        await AutoInvoice.countDocuments({ user: userId, active: true }),
        "autoRules",
      );

    const fallbackDate =
      member.membershipExpiresAt &&
      new Date(member.membershipExpiresAt) > new Date()
        ? new Date(member.membershipExpiresAt)
        : new Date();

    const first = nextIssueAt || fallbackDate;
    await AutoInvoice.findOneAndUpdate(
      { member: member._id, user: userId },
      {
        $set: {
          plan: planId,
          intervalMonths,
          nextIssueAt: first,
          anchorAt: first,
          active,
          note,
          lastError: "",
        },
        $setOnInsert: { user: userId, member: member._id },
      },
      { upsert: true, runValidators: true },
    );

    res.json({ success: true, message: "صدور خودکار ذخیره شد" });
  }),
);

// ---------- edit ----------
router.patch(
  "/:id",
  validateRequest(autoRulePatchSchema),
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه نامعتبر است" });
    const userId = req.session.user.id;
    const body = req.validatedBody;

    const rule = await AutoInvoice.findOne({
      _id: req.params.id,
      user: userId,
    }).lean();
    if (!rule) throw AppError.notFound("صدور خودکار پیدا نشد");

    const set = {};
    if (body.planId) {
      await loadMemberAndPlan(userId, rule.member, body.planId);
      set.plan = body.planId;
    }
    if (body.intervalMonths) set.intervalMonths = body.intervalMonths;
    if (body.nextIssueAt) set.nextIssueAt = body.nextIssueAt;
    // a new date or a new interval starts a new schedule
    if (body.nextIssueAt || body.intervalMonths)
      set.anchorAt = body.nextIssueAt || rule.nextIssueAt;
    if (body.note !== undefined) set.note = body.note;
    if (body.active !== undefined) {
      set.active = body.active;
      if (body.active) set.lastError = "";
    }
    if (set.active === true && !set.plan)
      await loadMemberAndPlan(userId, rule.member, rule.plan);

    await AutoInvoice.updateOne(
      { _id: rule._id, user: userId },
      { $set: set },
      { runValidators: true },
    );
    res.json({ success: true, message: "تغییرات ذخیره شد" });
  }),
);

// ---------- issue the invoice right now ----------
router.post(
  "/:id/run",
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه نامعتبر است" });
    const rule = await AutoInvoice.findOne({
      _id: req.params.id,
      user: req.session.user.id,
    }).lean();
    if (!rule) throw AppError.notFound("صدور خودکار پیدا نشد");
    if (!rule.active) throw AppError.badRequest("این صدور خودکار متوقف است");

    const outcome = await issueRule(rule, { force: true });
    const messages = {
      issued: "فاکتور صادر شد",
      skipped: "عضو منجمد است یا سقف فاکتور پرداخت‌نشده پر شده؛ این دوره رد شد",
      stopped: "این صدور خودکار متوقف شد (عضو یا پلن معتبر نیست)",
      lost: "این دوره همین الان صادر شده است",
      failed: "صدور فاکتور ناموفق بود",
    };
    res.status(outcome === "failed" ? 500 : 200).json({
      success: outcome === "issued",
      message: messages[outcome],
      outcome,
    });
  }),
);

// ---------- delete ----------
router.delete(
  "/:id",
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه نامعتبر است" });
    const r = await AutoInvoice.deleteOne({
      _id: req.params.id,
      user: req.session.user.id,
    });
    if (r.deletedCount === 0) throw AppError.notFound("صدور خودکار پیدا نشد");
    res.json({ success: true, message: "صدور خودکار حذف شد" });
  }),
);

export default router;
