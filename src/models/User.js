const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "نام کاربری الزامی است"],
      unique: true,
      trim: true,
      minlength: [4, "نام کاربری حداقل 4 کاراکتر باشد"],
      maxlength: [32, "نام کاربری حداکثر 32 کاراکتر باشد"],
      validate: {
        validator: (value) => /^[a-zA-Z0-9_.]{3,30}$/.test(value),
        message:
          "نام کاربری معتبر نیست (فقط حروف، اعداد، زیرخط و فاصله مجاز است)",
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
      enum: ["user", "admin", "moderator"],
      default: "user",
    },

    status: {
      type: String,
      enum: ["active", "suspended", "disabled"],
      default: "active",
    },

    clubName: {
      type: String,
      default: "باشگاه من",
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

    logo: {
      type: String,
      default: "",
    },

    signature: {
      data: { type: String, default: "" },
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

userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ status: 1 });
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

userSchema.methods.incrementLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    this.loginAttempts = 1;
    this.lockUntil = null;
  } else {
    this.loginAttempts += 1;
    if (this.loginAttempts >= 5) {
      this.lockUntil = new Date(Date.now() + 30 * 60 * 1000);
    }
  }
  return await this.save();
};

userSchema.methods.resetLoginAttempts = async function () {
  this.loginAttempts = 0;
  this.lockUntil = null;
  this.lastLogin = new Date();
  return await this.save();
};

userSchema.methods.isLocked = async function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("User", userSchema);
