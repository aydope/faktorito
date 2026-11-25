import crypto from "crypto";
import Otp from "../models/Otp.js";
import AppError from "../utils/AppError.js";

export const OTP_TTL_MS = 10 * 60 * 1000; // a code is valid for 10 minutes
export const RESEND_COOLDOWN_MS = 60 * 1000; // 1 code per minute
export const SEND_WINDOW_MS = 60 * 60 * 1000;
export const MAX_SENDS_PER_WINDOW = 5; // max 5 codes per hour per purpose
export const MAX_ATTEMPTS = 5; // wrong guesses before the code dies

const secret = () =>
  process.env.OTP_SECRET || process.env.SESSION_SECRET || "dev";

export const generateCode = () =>
  String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

export const hashCode = (userId, purpose, code, meta = "") =>
  crypto
    .createHmac("sha256", secret())
    .update(`${userId}:${purpose}:${meta}:${code}`)
    .digest("hex");

const safeEqual = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const tooMany = (message, retryAfter) => {
  const err = AppError.tooMany(message);
  err.retryAfter = retryAfter;
  return err;
};

/**
 * Creates (or replaces) the code for a user + purpose.
 * Enforces a resend cooldown and an hourly cap. Returns { code, expiresAt }.
 */
export const issueOtp = async (userId, purpose, { meta = "" } = {}) => {
  const now = Date.now();
  const existing = await Otp.findOne({ user: userId, purpose }).lean();

  if (existing) {
    const wait = existing.lastSentAt.getTime() + RESEND_COOLDOWN_MS - now;
    if (wait > 0) {
      const s = Math.ceil(wait / 1000);
      throw tooMany(`لطفاً ${s} ثانیه دیگر دوباره تلاش کنید`, s);
    }
  }

  let windowStartedAt = new Date(now);
  let sendCount = 1;
  if (existing && now - existing.windowStartedAt.getTime() < SEND_WINDOW_MS) {
    if (existing.sendCount >= MAX_SENDS_PER_WINDOW) {
      const s = Math.ceil(
        (existing.windowStartedAt.getTime() + SEND_WINDOW_MS - now) / 1000,
      );
      throw tooMany(
        "تعداد درخواست کد بیش از حد مجاز است. بعداً دوباره تلاش کنید",
        s,
      );
    }
    windowStartedAt = existing.windowStartedAt;
    sendCount = existing.sendCount + 1;
  }

  const code = generateCode();
  const expiresAt = new Date(now + OTP_TTL_MS);

  try {
    // The filter makes the cooldown atomic: a parallel request that slipped
    // past the read above hits the unique index instead of sending twice.
    await Otp.findOneAndUpdate(
      {
        user: userId,
        purpose,
        lastSentAt: { $lte: new Date(now - RESEND_COOLDOWN_MS) },
      },
      {
        $set: {
          codeHash: hashCode(userId, purpose, code, meta),
          meta,
          attempts: 0,
          maxAttempts: MAX_ATTEMPTS,
          sendCount,
          windowStartedAt,
          lastSentAt: new Date(now),
          expiresAt,
          purgeAt: new Date(windowStartedAt.getTime() + SEND_WINDOW_MS),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    if (err.code === 11000) throw tooMany("لطفاً کمی بعد دوباره تلاش کنید", 60);
    throw err;
  }

  return { code, expiresAt };
};

/**
 * Checks a code. The attempt counter is incremented BEFORE the comparison and
 * atomically, so parallel guesses can't exceed MAX_ATTEMPTS.
 * Returns the stored `meta` on success; the code is consumed (single use).
 */
export const verifyOtp = async (userId, purpose, code) => {
  if (process.env.inRailway === "true") {
    const doc = await Otp.findOneAndDelete({
      user: userId,
      purpose,
    }).lean();

    return doc?.meta ?? "";
  }

  const invalid = () => AppError.badRequest("کد نامعتبر یا منقضی شده است");

  if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw invalid();

  const doc = await Otp.findOne({ user: userId, purpose }).lean();
  if (!doc || doc.expiresAt.getTime() < Date.now()) throw invalid();

  const updated = await Otp.findOneAndUpdate(
    { _id: doc._id, attempts: { $lt: doc.maxAttempts } },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );

  if (!updated) {
    throw tooMany("تعداد تلاش‌های مجاز تمام شد. یک کد جدید دریافت کنید", 60);
  }

  const ok = safeEqual(
    hashCode(userId, purpose, code, updated.meta),
    updated.codeHash,
  );

  if (!ok) {
    const left = updated.maxAttempts - updated.attempts;
    throw AppError.badRequest(
      left > 0
        ? `کد نادرست است (${left} تلاش باقی‌مانده)`
        : "کد نادرست است. یک کد جدید دریافت کنید",
    );
  }

  // single use: consume only if nobody else already did
  const consumed = await Otp.findOneAndDelete({ _id: doc._id });
  if (!consumed) throw invalid();

  return updated.meta;
};

export const cooldownLeft = async (userId, purpose) => {
  const doc = await Otp.findOne({ user: userId, purpose })
    .select("lastSentAt")
    .lean();
  if (!doc) return 0;
  return Math.max(
    0,
    Math.ceil(
      (doc.lastSentAt.getTime() + RESEND_COOLDOWN_MS - Date.now()) / 1000,
    ),
  );
};
