import mongoose from "mongoose";

/**
 * Recurring ("auto-issue") rule, set by the owner for ONE member: "issue an
 * invoice for this plan every `intervalMonths` months" (1 = monthly, 3 = every
 * three months ...). Plans themselves have no duration; the interval lives here
 * and also becomes the membership period when the issued invoice is paid.
 * The owner can pause, re-date, change plan/interval, or delete the rule.
 */
const autoInvoiceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      required: true,
    },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    // every how many months an invoice is issued
    intervalMonths: {
      type: Number,
      enum: [1, 2, 3, 4, 6, 12],
      default: 1,
      required: true,
    },
    active: { type: Boolean, default: true },
    nextIssueAt: { type: Date, required: true },
    // first date of the schedule: every due date is anchor + k whole intervals,
    // so a rule that starts on the 31st does not drift to the 28th after February
    anchorAt: { type: Date, default: null },
    note: { type: String, trim: true, default: "", maxlength: 200 },

    lastIssuedAt: { type: Date, default: null },
    lastInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      default: null,
    },
    issuedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    lastError: { type: String, default: "", maxlength: 200 },
  },
  { timestamps: true },
);

// one rule per member
autoInvoiceSchema.index({ member: 1 }, { unique: true });
// the job scans by due date
autoInvoiceSchema.index({ active: 1, nextIssueAt: 1 });

export default mongoose.model("AutoInvoice", autoInvoiceSchema);
