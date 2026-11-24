import mongoose from "mongoose";

/**
 * One counter per (kind, calendar day) for budgets shared by the whole
 * service: e-mails sent and accounts registered. An atomic $inc on this
 * document keeps the cap exact across restarts and instances.
 */
const dailyQuotaSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true, enum: ["mail", "signup"] },
    day: { type: String, required: true }, // "2026-10-12" in QUOTA_TIMEZONE
    count: { type: Number, default: 0, min: 0 },
    expireAt: { type: Date, required: true },
  },
  { versionKey: false },
);

dailyQuotaSchema.index({ kind: 1, day: 1 }, { unique: true });
dailyQuotaSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("DailyQuota", dailyQuotaSchema);
