import express from "express";
import User from "../models/User.js";
import catchAsync from "../utils/catchAsync.js";
import validateRequest from "../middleware/validateRequest.js";
import { brandingSchema } from "../validators/branding.js";
import { buildSignaturePath } from "../utils/signature.js";
import { normalizeTheme, sampleSheet } from "../utils/invoiceSheet.js";

const router = express.Router();

// Preview of a theme with THIS owner's name, avatar and signature (sample amounts).
router.get(
  "/preview",
  catchAsync(async (req, res) => {
    const owner = await User.findById(req.session.user.id)
      .select("clubName clubPhone clubAddress signature")
      .lean();
    const origin = (
      process.env.APP_URL || `${req.protocol}://${req.get("host")}`
    ).replace(/\/+$/, "");
    const sheet = await sampleSheet({
      theme: normalizeTheme(req.query.theme),
      owner,
      origin,
    });
    sheet.sample = false; // no hover animation inside the preview frame
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.render("invoice-preview", { title: "پیش‌نمایش فاکتور", sheet });
  }),
);

// Only the caller's own record is touched: the id comes from the session.
router.put(
  "/",
  validateRequest(brandingSchema),
  catchAsync(async (req, res) => {
    const b = req.validatedBody;
    const set = {};

    if (b.removeSignature) set["signature.path"] = "";
    else if (b.strokes) set["signature.path"] = buildSignaturePath(b.strokes);

    if (b.signatureColor) set["signature.color"] = b.signatureColor;
    if (b.invoiceTheme) set.invoiceTheme = b.invoiceTheme;
    if (b.signerName !== undefined) set["signature.signerName"] = b.signerName;
    if (b.signaturePosition) set["signature.position"] = b.signaturePosition;

    if (Object.keys(set).length === 0) {
      return res.json({
        success: true,
        message: "تغییری برای ذخیره وجود ندارد",
      });
    }

    await User.updateOne(
      { _id: req.session.user.id },
      { $set: set },
      { runValidators: true },
    );
    res.json({ success: true, message: "تنظیمات فاکتور ذخیره شد" });
  }),
);

export default router;
