import mongoose from "mongoose";
import { addDuration } from "../utils/duration.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_DAYS = 7;

const memberSchema = new mongoose.Schema(
  {
    // Owner (the gym account). Every query MUST be scoped by this field.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "کاربر الزامی است"],
      index: true,
    },
    // Human-friendly code, unique per owner (e.g. M-0042). Generated server-side.
    code: {
      type: String,
      required: [true, "کد عضویت الزامی است"],
      trim: true,
    },
    name: {
      type: String,
      required: [true, "نام عضو الزامی است"],
      trim: true,
      minlength: [3, "نام عضو باید حداقل 3 کاراکتر باشد"],
      maxlength: [32, "نام عضو نباید بیشتر از 32 کاراکتر باشد"],
    },
    phone: {
      type: String,
      trim: true,
      default: "",
      validate: {
        validator: (v) => v === "" || /^09\d{9}$/.test(v),
        message: "شماره تلفن باید با 09 شروع شده و 11 رقم باشد",
      },
    },
    // Optional e-mail: when a person registers (and verifies) the same address
    // as a "member" account, the account is linked and sees their invoices.
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      validate: {
        validator: (v) =>
          v === "" ||
          /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v),
        message: "ایمیل معتبر نیست",
      },
    },
    // The member's own login. One account can belong to ONE club at a time:
    // a partial unique index below enforces it even under parallel requests.
    // Leaving a club / being removed sets this back to null.
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // true after the person left (or was unlinked): the e-mail is never
    // auto-linked again until the club re-adds them.
    unlinked: { type: Boolean, default: false },
    leftAt: { type: Date, default: null },

    // Soft delete: members are NEVER removed from the database (invoices,
    // totals and history keep pointing at them). Hidden by default.
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // the expiry date we already sent a reminder for (prevents duplicates)
    lastReminderFor: { type: Date, default: null },

    // active: normal | frozen: membership paused | inactive: left the club
    status: {
      type: String,
      enum: ["active", "frozen", "inactive"],
      default: "active",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: [200, "یادداشت حداکثر 200 کاراکتر است"],
    },

    // Membership period (extended automatically when an invoice is paid)
    lastPlanName: { type: String, default: "" },

    // when a freeze started (the frozen days are added back on unfreeze)
    frozenAt: { type: Date, default: null },
    membershipStartsAt: { type: Date, default: null },
    membershipExpiresAt: { type: Date, default: null },

    // Denormalised money / activity counters (updated when invoices are paid)
    totalPaid: { type: Number, default: 0, min: 0 },
    lastPaymentAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

memberSchema.index({ user: 1, code: 1 }, { unique: true });
memberSchema.index({ user: 1, name: 1 });
memberSchema.index({ user: 1, phone: 1 });
memberSchema.index({ user: 1, membershipExpiresAt: 1 });
memberSchema.index({ email: 1, account: 1 });
memberSchema.index(
  { account: 1 },
  { unique: true, partialFilterExpression: { account: { $type: "objectId" } } },
);
memberSchema.index({ user: 1, deletedAt: 1 });

/**
 * Soft-delete filter: every read/update hides deleted members unless the query
 * already mentions `deletedAt` or opts in with `{ withDeleted: true }`.
 */
export function excludeDeleted() {
  if (this.getOptions?.().withDeleted) return;
  const filter = this.getFilter();
  if (filter.deletedAt !== undefined) return;
  this.where({ deletedAt: null });
}
memberSchema.pre(
  [
    "find",
    "findOne",
    "countDocuments",
    "findOneAndUpdate",
    "updateOne",
    "updateMany",
  ],
  excludeDeleted,
);

memberSchema.virtual("isDeleted").get(function () {
  return !!this.deletedAt;
});

/**
 * Pure helper (easy to unit-test).
 * Returns: "none" | "active" | "expiring" | "expired" | "frozen" | "inactive"
 */
const computeMembershipState = (member, now = Date.now()) => {
  if (!member) return "none";
  if (member.status === "inactive") return "inactive";
  if (member.status === "frozen") return "frozen";
  if (!member.membershipExpiresAt) return "none";

  const expires = new Date(member.membershipExpiresAt).getTime();
  if (expires < now) return "expired";
  if (expires - now <= EXPIRING_SOON_DAYS * DAY_MS) return "expiring";
  return "active";
};

/**
 * Pure helper: given the current expiry and a plan duration, returns the new
 * { startsAt, expiresAt }. A renewal made before expiry stacks on top of the
 * remaining time; a renewal after expiry starts from "now".
 */
const calculateRenewal = (member, duration, now = Date.now()) => {
  const current = member?.membershipExpiresAt
    ? new Date(member.membershipExpiresAt).getTime()
    : 0;
  const stacking = current > now;
  const base = stacking ? current : now;

  return {
    startsAt:
      stacking && member.membershipStartsAt
        ? new Date(member.membershipStartsAt)
        : new Date(now),
    // a number means days; { unit, value } supports calendar months
    expiresAt: addDuration(new Date(base), duration),
  };
};

memberSchema.virtual("membershipState").get(function () {
  return computeMembershipState(this);
});

memberSchema.virtual("daysLeft").get(function () {
  if (!this.membershipExpiresAt) return null;
  return Math.ceil(
    (new Date(this.membershipExpiresAt).getTime() - Date.now()) / DAY_MS,
  );
});

/** Atomic per-owner counter -> "M-0001", "M-0002", ... */
memberSchema.statics.generateCode = async function (userId) {
  const counters = mongoose.connection.db.collection("counters");
  const result = await counters.findOneAndUpdate(
    { _id: `member:${userId}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );

  // driver v5 returned { value }, v6+ returns the document itself
  const seq = result?.value?.seq ?? result?.seq ?? 1;
  return `M-${String(seq).padStart(4, "0")}`;
};

memberSchema.statics.computeMembershipState = computeMembershipState;
memberSchema.statics.calculateRenewal = calculateRenewal;
memberSchema.statics.EXPIRING_SOON_DAYS = EXPIRING_SOON_DAYS;

export default mongoose.model("Member", memberSchema);
