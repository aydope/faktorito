import mongoose from "mongoose";

/**
 * One document per (user, purpose). The code itself is never stored, only an
 * HMAC of it. `purgeAt` (TTL) outlives the code so the send-rate window can't
 * be reset simply by waiting for the code to expire.
 */
const otpSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  purpose: {
    type: String,
    enum: ["verify", "login", "reset", "email_change"],
    required: true,
  },
  codeHash: { type: String, required: true },
  meta: { type: String, default: "" },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  sendCount: { type: Number, default: 1 },
  windowStartedAt: { type: Date, default: Date.now },
  lastSentAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  purgeAt: { type: Date, required: true },
});

otpSchema.index({ user: 1, purpose: 1 }, { unique: true });
otpSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("Otp", otpSchema);
