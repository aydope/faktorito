import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { ROLES } from "../config/permissions.js";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "نام کاربری الزامی است"],
      unique: true,
      trim: true,
      minlength: [3, "نام کاربری حداقل 3 کاراکتر باشد"],
      maxlength: [32, "نام کاربری حداکثر 32 کاراکتر باشد"],
      validate: {
        validator: (value) => /^[a-zA-Z0-9_.-]{3,32}$/.test(value),
        message:
          "نام کاربری معتبر نیست (فقط حروف انگلیسی، اعداد، نقطه، خط تیره و زیرخط مجاز است)",
      },
    },

    email: {
      type: String,
      required: [true, "ایمیل الزامی است"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        "ایمیل معتبر نیست",
      ],
    },

    password: {
      type: String,
      required: [true, "رمز عبور الزامی است"],
      minlength: [6, "رمز عبور حداقل 6 کاراکتر باشد"],
      select: false,
      validate: {
        validator: (value) => {
          const hasUpperCase = /[A-Z]/.test(value);
          const hasLowerCase = /[a-z]/.test(value);
          const hasNumbers = /\d/.test(value);
          const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(value);
          return hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
        },
        message:
          "رمز عبور باید شامل حداقل یک حرف بزرگ، یک حرف کوچک، یک عدد و یک کاراکتر خاص باشد",
      },
    },

    role: {
      type: String,
      enum: ROLES,
      default: "owner",
    },

    status: {
      type: String,
      enum: ["active", "suspended", "disabled", "pending_deletion", "deleted"],
      default: "active",
    },

    // ---- e-mail verification ----
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },
    // a new address waits here until its OTP is confirmed
    pendingEmail: { type: String, trim: true, lowercase: true, default: "" },

    // ---- account deletion (request -> staff review -> soft delete) ----
    deletionRequestedAt: { type: Date, default: null },
    deletionReason: { type: String, trim: true, default: "", maxlength: 300 },
    deletedAt: { type: Date, default: null },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Empty for ordinary accounts; filled when a business is created.
    clubName: {
      type: String,
      default: "",
      trim: true,
      maxlength: [24, "نام باشگاه حداکثر 24 کاراکتر باشد"],
    },

    clubPhone: {
      type: String,
      trim: true,
      default: "",
      validate: {
        validator: (value) => value === "" || /^(09[0-9]{2})\d{7}$/.test(value),
        message: "شماره تلفن معتبر نیست",
      },
    },

    clubAddress: {
      type: String,
      trim: true,
      default: "",
      maxlength: [128, "آدرس باشگاه حداکثر 128 کاراکتر باشد"],
    },

    clubEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        "ایمیل معتبر نیست",
      ],
    },

    clubCode: {
      type: String,
      trim: true,
      default: "",
    },

    // legal acceptance (version + time are kept as evidence)
    termsAcceptedAt: { type: Date, default: null },
    termsVersion: { type: String, default: "" },
    businessTermsAcceptedAt: { type: Date, default: null },
    businessTermsVersion: { type: String, default: "" },

    invoiceTheme: {
      type: String,
      enum: ["aurora", "midnight", "mono", "luxe"],
      default: "aurora",
    },

    // Drawn on a canvas: stored as an SVG path made from validated strokes.
    signature: {
      path: { type: String, default: "", maxlength: 60000 },
      color: { type: String, default: "#111827" },
      signerName: { type: String, trim: true, default: "", maxlength: 40 },
      position: {
        type: String,
        enum: ["left", "center", "right"],
        default: "right",
      },
    },

    lastLogin: {
      type: Date,
      default: null,
    },

    loginAttempts: {
      type: Number,
      default: 0,
    },

    lockUntil: {
      type: Date,
      default: null,
    },

    passwordChangedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// email and username are indexed by their "unique: true" above
userSchema.index({ status: 1 });
userSchema.index({ role: 1 });
userSchema.index({ status: 1, deletionRequestedAt: 1 });
userSchema.index({ lockUntil: 1 });

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  this.passwordChangedAt = Date.now();
});

userSchema.pre("findOneAndUpdate", async function () {
  const update = this.getUpdate();
  if (update.password) {
    const salt = await bcrypt.genSalt(12);
    update.password = await bcrypt.hash(update.password, salt);
    update.passwordChangedAt = Date.now();
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 30 * 60 * 1000;

// Atomic updates (no full-document save): avoids race conditions between
// parallel login attempts and avoids re-running password validators on a hash.
userSchema.methods.incrementLoginAttempts = async function () {
  const now = Date.now();

  // Previous lock expired -> start counting from 1 again
  if (this.lockUntil && this.lockUntil.getTime() < now) {
    await this.constructor.updateOne(
      { _id: this._id },
      { $set: { loginAttempts: 1, lockUntil: null } },
    );
    return 1;
  }

  const updated = await this.constructor.findByIdAndUpdate(
    this._id,
    { $inc: { loginAttempts: 1 } },
    { returnDocument: "after", projection: "loginAttempts" },
  );

  const attempts = updated ? updated.loginAttempts : 1;
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    await this.constructor.updateOne(
      { _id: this._id },
      { $set: { lockUntil: new Date(now + LOCK_TIME_MS) } },
    );
  }
  return attempts;
};

userSchema.methods.resetLoginAttempts = async function () {
  await this.constructor.updateOne(
    { _id: this._id },
    { $set: { loginAttempts: 0, lockUntil: null, lastLogin: new Date() } },
  );
};

// NOTE: this used to be `async`, which made `user.isLocked()` always truthy.
userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil.getTime() > Date.now());
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

export default mongoose.model("User", userSchema);
