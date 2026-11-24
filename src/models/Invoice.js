import mongoose from "mongoose";
import { generatePublicId, generateTrackingCode } from "../utils/crypto.js";

const invoiceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "کاربر الزامی است"],
      index: true,
    },
    // Unguessable id used in the shareable link (/i/<publicId>).
    // (The ObjectId is guessable, so it is never used for public access.)
    publicId: {
      type: String,
      default: generatePublicId,
      unique: true,
      sparse: true,
    },
    // Optional link to a saved member. `member` below stays a snapshot so old
    // invoices keep their original name/phone even if the member is edited.
    memberRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      default: null,
      index: true,
    },
    invoiceNumber: {
      type: String,
      required: [true, "شماره فاکتور الزامی است"],
      unique: true,
    },
    trackingCode: {
      type: String,
      required: [true, "کد پیگیری الزامی است"],
    },
    member: {
      name: {
        type: String,
        required: [true, "نام عضو الزامی است"],
        trim: true,
      },
      phone: {
        type: String,
        default: "-",
        trim: true,
      },
      memberId: {
        type: String,
        default: "-",
        trim: true,
      },
    },
    plan: {
      planRef: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Plan",
        default: null,
      },
      name: {
        type: String,
        required: [true, "نام پلن الزامی است"],
      },
      price: {
        type: Number,
        required: [true, "قیمت پلن الزامی است"],
        min: [0, "قیمت نمی‌تواند منفی باشد"],
      },
      description: {
        type: String,
        default: "",
      },
      // Snapshot of the plan duration (none = does not extend a membership, e.g. a sale of extras only)
      // (no defaults: invoices created before units existed only have durationDays)
      durationUnit: { type: String, enum: ["none", "day", "month"] },
      durationValue: { type: Number, min: 0 },
      durationDays: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    // true when an auto-issue rule created this invoice (shown in the member panel)
    autoIssued: { type: Boolean, default: false },
    extraItems: [
      {
        type: {
          type: String,
          enum: {
            values: ["item", "discount"],
            message: "نوع آیتم باید item یا discount باشد",
          },
          required: true,
        },
        name: {
          type: String,
          required: [true, "نام آیتم الزامی است"],
          trim: true,
          minlength: [1, "نام آیتم باید حداقل 1 کاراکتر باشد"],
          maxlength: [64, "نام آیتم نباید بیشتر از 64 کاراکتر باشد"],
        },
        price: {
          type: Number,
          required: [true, "قیمت آیتم الزامی است"],
          validate: {
            validator: function (v) {
              return Number.isInteger(v);
            },
            message: "قیمت آیتم باید عدد صحیح و بیشتر از 0 باشد",
          },
        },
      },
    ],
    note: {
      type: String,
      default: "",
      trim: true,
      maxlength: [64, "یادداشت حداکثر 64 کاراکتر است"],
    },
    totalAmount: {
      type: Number,
      required: [true, "مبلغ کل الزامی است"],
      min: [0, "مبلغ نمی‌تواند منفی باشد"],
    },
    extraTotal: {
      type: Number,
      default: 0,
    },
    isPaid: {
      type: Boolean,
      default: false,
    },
    paidAt: Date,
    invoiceDate: {
      type: String,
      required: [true, "تاریخ فاکتور الزامی است"],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes
invoiceSchema.index({ user: 1, createdAt: -1 });
invoiceSchema.index({ user: 1, isPaid: 1 });
invoiceSchema.index({ user: 1, memberRef: 1, createdAt: -1 });
invoiceSchema.index({ user: 1, paidAt: -1 });

// Generate invoice number
invoiceSchema.statics.generateInvoiceNumber = async function () {
  const db = mongoose.connection.db;
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const counter = await db.collection("counters").findOneAndUpdate(
      { _id: "invoiceNumber" },
      { $inc: { seq: 1 } },
      {
        upsert: true,
        returnDocument: "after",
      },
    );

    let seq = 1;
    if (counter && counter.value && counter.value.seq) {
      seq = counter.value.seq;
    } else if (counter && counter.seq) {
      seq = counter.seq;
    }

    const invoiceNumber = `F-${String(seq).padStart(6, "0")}`;

    const existing = await this.findOne({ invoiceNumber }).lean();
    if (!existing) {
      return invoiceNumber;
    }

    await new Promise((resolve) => setTimeout(resolve, Math.random() * 50));
  }

  return `F-${Date.now()}`;
};

// Generate tracking code (CSPRNG)
invoiceSchema.statics.generateTrackingCode = generateTrackingCode;

// Virtual: formatted total
invoiceSchema.virtual("formattedTotal").get(function () {
  return this.totalAmount.toLocaleString("fa-IR-u-nu-latn") + " تومان";
});

// Virtual: payment status text
invoiceSchema.virtual("paymentStatus").get(function () {
  return this.isPaid ? "پرداخت شده" : "در انتظار پرداخت";
});

// Check if payment can be changed
invoiceSchema.methods.canTogglePayment = function () {
  return !this.isPaid;
};

// Toggle payment safely
invoiceSchema.methods.togglePayment = function () {
  if (this.isPaid) {
    throw new Error("این فاکتور قبلا پرداخت شده است");
  }
  this.isPaid = true;
  this.paidAt = new Date();
  return this.save();
};

export default mongoose.model("Invoice", invoiceSchema);
