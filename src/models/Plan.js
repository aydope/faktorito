const mongoose = require("mongoose");

const planSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "کاربر الزامی است"],
      index: true,
    },
    name: {
      type: String,
      required: [true, "نام پلن الزامی است"],
      trim: true,
      maxlength: [24, "نام پلن حداکثر 24 کاراکتر است"],
    },
    price: {
      type: Number,
      required: [true, "قیمت الزامی است"],
      min: [0, "قیمت نمی‌تواند منفی باشد"],
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: [128, "توضیحات حداکثر 128 کاراکتر است"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

planSchema.index({ user: 1, isActive: 1 });

planSchema.virtual("formattedPrice").get(function () {
  return this.price.toLocaleString("fa-IR-u-nu-latn") + " تومان";
});

module.exports = mongoose.model("Plan", planSchema);
