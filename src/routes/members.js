import express from "express";
const router = express.Router();
router.use(liveAfterMutation(memberMutationLive)); // open pages refresh after any successful write

import Member from "../models/Member.js";
import Invoice from "../models/Invoice.js";
import Plan from "../models/Plan.js";
import { memberSchema, updateMemberSchema } from "../validators/member.js";
import { validateID } from "../validators/mongooseId.js";
import catchAsync from "../utils/catchAsync.js";
import validateRequest from "../middleware/validateRequest.js";
import AppError from "../utils/AppError.js";
import { LIMITS } from "../config/limits.js";
import { assertBelow, dayAgo } from "../services/limitsService.js";
import { statusTransition } from "../services/freezeService.js";
import { liveAfterMutation, memberMutationLive } from "../realtime/live.js";
import User from "../models/User.js";
import AutoInvoice from "../models/AutoInvoice.js";
import {
  resolveAccountForNewMember,
  announceJoin,
  linkByEmail,
} from "../services/membershipService.js";
import { authenticate } from "../middleware/auth.js";
import {
  asString,
  asEnum,
  escapeRegex,
  parsePagination,
  buildPagination,
  toCsv,
} from "../utils/query.js";

const MAX_MEMBERS = LIMITS.members;
const DAY_MS = 24 * 60 * 60 * 1000;

const FILTERS = [
  "active",
  "expiring",
  "expired",
  "frozen",
  "inactive",
  "deleted",
];

/** Turns ?filter=expiring etc. into a Mongo filter (scoped to the owner). */
const buildMemberFilter = (query, userId) => {
  const filter = { user: userId };
  const now = new Date();
  const soon = new Date(now.getTime() + Member.EXPIRING_SOON_DAYS * DAY_MS);

  const state = asEnum(query.filter, FILTERS);
  if (state === "deleted") {
    // soft-deleted members are hidden everywhere else; this is the trash view
    filter.deletedAt = { $ne: null };
  } else if (state === "active") {
    filter.status = "active";
    filter.$or = [
      { membershipExpiresAt: null },
      { membershipExpiresAt: { $gt: soon } },
    ];
  } else if (state === "expiring") {
    filter.status = "active";
    filter.membershipExpiresAt = { $gte: now, $lte: soon };
  } else if (state === "expired") {
    filter.status = "active";
    filter.membershipExpiresAt = { $lt: now };
  } else if (state === "frozen") {
    filter.status = "frozen";
  } else if (state === "inactive") {
    filter.status = "inactive";
  }

  const search = asString(query.search, 50);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    const searchClause = [{ name: rx }, { phone: rx }, { code: rx }];
    // `$or` may already be used by the "active" filter -> combine with $and
    filter.$and = [{ $or: searchClause }];
  }

  return { filter, search, state };
};

const withState = (member) => ({
  ...member,
  state: Member.computeMembershipState(member),
  daysLeft: member.membershipExpiresAt
    ? Math.ceil(
        (new Date(member.membershipExpiresAt).getTime() - Date.now()) / DAY_MS,
      )
    : null,
});

// ---------- list page ----------
router.get(
  "/",
  authenticate,
  catchAsync(async (req, res) => {
    const userId = req.session.user.id;
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 12,
      maxLimit: 50,
    });
    const { filter, search, state } = buildMemberFilter(req.query, userId);

    const [members, totalCount, totalAll] = await Promise.all([
      Member.find(filter)
        .select("-__v")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Member.countDocuments(filter),
      Member.countDocuments({ user: userId }),
    ]);

    const pagination = buildPagination({ page, limit, totalCount });
    const payload = { members: members.map(withState), pagination };

    if (req.headers["x-requested-with"] === "XMLHttpRequest") {
      return res.json({ success: true, ...payload });
    }

    res.render("members", {
      title: "اعضا",
      active: "members",
      ...payload,
      totalAll,
      maxMembers: MAX_MEMBERS,
      filters: { search, state },
    });
  }),
);

// ---------- autocomplete for the invoice form ----------
router.get(
  "/search",
  authenticate,
  catchAsync(async (req, res) => {
    const q = asString(req.query.q, 50);
    const filter = { user: req.session.user.id, status: { $ne: "inactive" } };

    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ name: rx }, { phone: rx }, { code: rx }];
    }

    const members = await Member.find(filter)
      .select("name phone code membershipExpiresAt status")
      .sort({ name: 1 })
      .limit(8)
      .lean();

    res.json({ success: true, members: members.map(withState) });
  }),
);

// ---------- CSV export ----------
router.get(
  "/export.csv",
  authenticate,
  catchAsync(async (req, res) => {
    const { filter } = buildMemberFilter(req.query, req.session.user.id);
    const members = await Member.find(filter)
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();

    const stateLabels = {
      none: "بدون اشتراک",
      active: "فعال",
      expiring: "رو به پایان",
      expired: "منقضی",
      frozen: "منجمد",
      inactive: "غیرفعال",
    };

    const csv = toCsv(
      [
        "کد عضویت",
        "نام",
        "تلفن",
        "وضعیت",
        "آخرین پلن",
        "تاریخ پایان",
        "مجموع پرداخت (تومان)",
      ],
      members.map((m) => [
        m.code,
        m.name,
        m.phone,
        stateLabels[Member.computeMembershipState(m)],
        m.lastPlanName,
        m.membershipExpiresAt
          ? new Date(m.membershipExpiresAt).toLocaleDateString(
              "fa-IR-u-nu-latn",
            )
          : "",
        m.totalPaid,
      ]),
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="members.csv"');
    res.send(csv);
  }),
);

// ---------- create ----------
router.post(
  "/",
  authenticate,
  validateRequest(memberSchema),
  catchAsync(async (req, res) => {
    const userId = req.session.user.id;
    const { name, phone = "", email = "", notes = "" } = req.validatedBody;

    assertBelow(await Member.countDocuments({ user: userId }), "members");
    // deleted members count here too, so add -> delete -> add can't dodge the daily cap
    assertBelow(
      await Member.countDocuments({
        user: userId,
        createdAt: { $gte: dayAgo() },
      }).setOptions({ withDeleted: true }),
      "memberAddsPerDay",
    );

    if (phone) {
      const dup = await Member.exists({ user: userId, phone });
      if (dup) {
        const err = AppError.conflict(
          "عضوی با این شماره تلفن قبلاً ثبت شده است",
        );
        err.errors = { phone: "این شماره قبلاً برای عضو دیگری ثبت شده است" };
        throw err;
      }
    }

    // A person who already belongs to another club can't be added (409).
    // An e-mail without an account simply creates a walk-in member.
    const account = await resolveAccountForNewMember(email || "");

    const code = await Member.generateCode(userId);
    let member;
    try {
      member = await Member.create({
        user: userId,
        code,
        name,
        phone: phone || "",
        email: email || "",
        notes: notes || "",
        account: account ? account._id : null,
      });
    } catch (err) {
      // two clubs adding the same person at the same moment: the index decides
      if (err?.code === 11000 && err.keyPattern?.account) {
        const e = AppError.conflict(
          "این کاربر هم‌اکنون عضو یک باشگاه دیگر است",
        );
        e.errors = { email: e.message };
        throw e;
      }
      throw err;
    }

    if (account) {
      const owner = await User.findById(userId).select("clubName").lean();
      announceJoin(member, owner?.clubName);
    }

    res.status(201).json({
      success: true,
      message: account
        ? "عضو ثبت شد و در پنل خودش به‌عنوان عضو باشگاه نمایش داده می‌شود"
        : "عضو جدید با موفقیت ثبت شد",
      linked: !!account,
      member: { _id: member._id, name: member.name, code: member.code },
    });
  }),
);

// ---------- detail page ----------
router.get(
  "/:id",
  authenticate,
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه عضو نامعتبر است" });
    const userId = req.session.user.id;

    const member = await Member.findOne({
      _id: req.params.id,
      user: userId,
    }).lean();
    if (!member) throw AppError.notFound("عضو پیدا نشد");

    const invoices = await Invoice.find({ user: userId, memberRef: member._id })
      .select(
        "invoiceNumber totalAmount isPaid paidAt invoiceDate plan createdAt",
      )
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const [autoRule, plans] = await Promise.all([
      AutoInvoice.findOne({ member: member._id, user: userId })
        .populate("plan", "name price")
        .lean(),
      Plan.find({ user: userId, isActive: true })
        .select("name price")
        .sort({ name: 1 })
        .lean(),
    ]);

    res.render("member-detail", {
      title: member.name,
      active: "members",
      member: withState(member),
      autoRule,
      plans,
      invoices,
      unpaidTotal: invoices
        .filter((i) => !i.isPaid)
        .reduce((sum, i) => sum + i.totalAmount, 0),
    });
  }),
);

// ---------- update ----------
router.put(
  "/:id",
  authenticate,
  validateRequest(updateMemberSchema),
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه عضو نامعتبر است" });
    const userId = req.session.user.id;
    const { name, phone, email, notes, status } = req.validatedBody;

    const update = {};
    if (name !== undefined) update.name = name;
    if (notes !== undefined) update.notes = notes || "";
    // The e-mail is only a contact detail once a member has an account:
    // changing it never moves the member to a different account.
    if (email !== undefined) update.email = email || "";
    if (status !== undefined) {
      update.status = status;
      // gym: freezing starts a clock, unfreezing adds the frozen days back
      const current = await Member.findOne({ _id: req.params.id, user: userId })
        .select("status frozenAt membershipExpiresAt")
        .lean();
      Object.assign(update, statusTransition(current, status));
    }
    if (phone !== undefined) {
      update.phone = phone || "";
      if (phone) {
        const dup = await Member.exists({
          user: userId,
          phone,
          _id: { $ne: req.params.id },
        });
        if (dup) {
          const err = AppError.conflict(
            "عضوی با این شماره تلفن قبلاً ثبت شده است",
          );
          err.errors = { phone: "این شماره قبلاً برای عضو دیگری ثبت شده است" };
          throw err;
        }
      }
    }

    if (Object.keys(update).length === 0) {
      throw AppError.badRequest("هیچ تغییری برای اعمال وجود ندارد");
    }

    const member = await Member.findOneAndUpdate(
      { _id: req.params.id, user: userId },
      { $set: update },
      { returnDocument: "after", runValidators: true },
    );
    if (!member) throw AppError.notFound("عضو پیدا نشد");

    let note = "";
    if (email !== undefined && member.email && !member.account) {
      const owner = await User.findById(userId).select("clubName").lean();
      const result = await linkByEmail(member, owner?.clubName);
      if (result === "busy")
        note =
          " (این ایمیل متعلق به کاربری است که عضو باشگاه دیگری است و متصل نشد)";
    }

    res.json({ success: true, message: `اطلاعات عضو به‌روزرسانی شد${note}` });
  }),
);

// ---------- delete (SOFT: the document stays in the database) ----------
router.delete(
  "/:id",
  authenticate,
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه عضو نامعتبر است" });
    const userId = req.session.user.id;

    // the soft-delete query hook already ignores members that are deleted
    const member = await Member.findOneAndUpdate(
      { _id: req.params.id, user: userId },
      // deleting a member also frees their account: they can join another club
      {
        $set: {
          deletedAt: new Date(),
          deletedBy: userId,
          account: null,
          unlinked: true,
        },
      },
      { returnDocument: "before", projection: "name" },
    ).lean();
    if (!member) throw AppError.notFound("عضو پیدا نشد");
    await AutoInvoice.updateMany(
      { member: member._id, user: userId },
      { $set: { active: false } },
    );

    res.json({
      success: true,
      message: `عضو «${member.name}» به سطل بازیافت منتقل شد`,
    });
  }),
);

// ---------- restore ----------
router.post(
  "/:id/restore",
  authenticate,
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه عضو نامعتبر است" });
    const userId = req.session.user.id;

    // mentioning `deletedAt` in the filter opts out of the soft-delete hook
    const member = await Member.findOneAndUpdate(
      { _id: req.params.id, user: userId, deletedAt: { $ne: null } },
      { $set: { deletedAt: null, deletedBy: null, unlinked: false } },
      { returnDocument: "after" },
    );
    if (!member) throw AppError.notFound("عضو حذف‌شده‌ای پیدا نشد");

    // re-link only if that person is still free (they may have joined another club)
    let note = "";
    if (member.email && !member.account) {
      const owner = await User.findById(userId).select("clubName").lean();
      if ((await linkByEmail(member, owner?.clubName)) === "busy")
        note = " (حساب او اکنون عضو باشگاه دیگری است و متصل نشد)";
    }
    res.json({
      success: true,
      message: `عضو «${member.name}» بازگردانی شد${note}`,
    });
  }),
);

// ---------- gym: freeze / unfreeze ----------
router.post(
  "/:id/freeze",
  authenticate,
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه عضو نامعتبر است" });
    const member = await Member.findOneAndUpdate(
      { _id: req.params.id, user: req.session.user.id, status: "active" },
      { $set: { status: "frozen", frozenAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!member) throw AppError.badRequest("فقط عضو فعال را می‌توان منجمد کرد");
    res.json({
      success: true,
      message:
        "اشتراک منجمد شد؛ روزهای انجماد هنگام رفع انجماد به اشتراک اضافه می‌شود",
    });
  }),
);

router.post(
  "/:id/unfreeze",
  authenticate,
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه عضو نامعتبر است" });
    const userId = req.session.user.id;
    const current = await Member.findOne({
      _id: req.params.id,
      user: userId,
      status: "frozen",
    })
      .select("status frozenAt membershipExpiresAt")
      .lean();
    if (!current) throw AppError.badRequest("این عضو منجمد نیست");

    const set = { status: "active", ...statusTransition(current, "active") };
    // the filter on status makes a double click harmless: only one request wins
    const member = await Member.findOneAndUpdate(
      { _id: req.params.id, user: userId, status: "frozen" },
      { $set: set },
      { returnDocument: "after" },
    );
    if (!member) throw AppError.conflict("وضعیت عضو هم‌اکنون تغییر کرده است");
    res.json({
      success: true,
      message: "انجماد برداشته شد و روزهای انجماد به اشتراک اضافه شد",
    });
  }),
);

export default router;
