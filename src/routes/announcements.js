import express from "express";
import Announcement from "../models/Announcement.js";
import Member from "../models/Member.js";
import User from "../models/User.js";
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/AppError.js";
import { assertBelow } from "../services/limitsService.js";
import { liveAfterMutation, emitAnnouncementLive } from "../realtime/live.js";
import validateRequest from "../middleware/validateRequest.js";
import { validateID } from "../validators/mongooseId.js";
import {
  announcementSchema,
  DURATIONS_HOURS,
  DEFAULT_HOURS,
} from "../validators/announcement.js";
import { emitToUser } from "../realtime/socket.js";

const router = express.Router();
router.use(
  liveAfterMutation((req) => emitAnnouncementLive(req.session.user.id)),
);

router.get(
  "/",
  catchAsync(async (req, res) => {
    const userId = req.session.user.id;
    const now = new Date();
    const [items, audience] = await Promise.all([
      Announcement.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(40)
        .lean(),
      Member.countDocuments({ user: userId, account: { $ne: null } }),
    ]);

    res.render("announcements", {
      title: "اعلان‌ها",
      active: "announcements",
      items: items.map((a) => ({
        ...a,
        isActive: new Date(a.expiresAt) > now,
      })),
      audience,
      durations: DURATIONS_HOURS,
      defaultHours: DEFAULT_HOURS,
    });
  }),
);

router.post(
  "/",
  validateRequest(announcementSchema),
  catchAsync(async (req, res) => {
    const userId = req.session.user.id;
    const { title, body, hours } = req.validatedBody;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    assertBelow(
      await Announcement.countDocuments({
        user: userId,
        createdAt: { $gte: since },
      }),
      "announcementsPerDay",
    );

    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
    const announcement = await Announcement.create({
      user: userId,
      title,
      body,
      expiresAt,
    });

    // live push to every member that has an account. The panel itself reads the
    // announcements from the database, so offline members see it on their next visit.
    const owner = await User.findById(userId).select("clubName").lean();
    const accounts = await Member.find({
      user: userId,
      account: { $ne: null },
      status: { $ne: "inactive" },
    })
      .select("account")
      .lean();
    for (const m of accounts) {
      emitToUser(m.account, "announcement", {
        id: String(announcement._id),
        clubName: owner?.clubName || "",
        title,
        body,
        expiresAt,
      });
    }

    res.status(201).json({
      success: true,
      message: `اعلان برای ${accounts.length.toLocaleString("fa-IR-u-nu-latn")} عضو ثبت شد`,
    });
  }),
);

router.delete(
  "/:id",
  catchAsync(async (req, res) => {
    validateID(req.params.id, { message: "شناسه نامعتبر است" });
    const r = await Announcement.deleteOne({
      _id: req.params.id,
      user: req.session.user.id,
    });
    if (r.deletedCount === 0) throw AppError.notFound("اعلان پیدا نشد");
    res.json({ success: true, message: "اعلان حذف شد" });
  }),
);

export default router;
