import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["invoice", "payment", "membership", "announcement", "system"],
      default: "system",
    },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, default: "", maxlength: 300 },
    url: { type: String, default: "" },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, readAt: 1 });
// keep 90 days of history
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 3600 },
);

export default mongoose.model("Notification", notificationSchema);
