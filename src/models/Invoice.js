const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "کاربر الزامی است"],
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
    },
    extraItems: [
      {
        type: {
          type: String,
          enum: {
            values: ["cafe", "discount"],
            message: "نوع آیتم باید cafe یا discount باشد",
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
invoiceSchema.index({ invoiceNumber: 1 });

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

// Generate tracking code
invoiceSchema.statics.generateTrackingCode = function () {
  return String(Math.floor(1000 + Math.random() * 9000));
};

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

module.exports = mongoose.model("Invoice", invoiceSchema);
