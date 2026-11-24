import mongoose from "mongoose";

/** A club announcement, visible to the club's members until `expiresAt` (24h by default). */
const announcementSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 500,
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

announcementSchema.index({ user: 1, expiresAt: -1 });
announcementSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("Announcement", announcementSchema);
