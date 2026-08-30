const Joi = require("joi");

const registerSchema = Joi.object({
  username: Joi.string()
    .required()
    .min(3)
    .max(32)
    .pattern(/^[a-zA-Z0-9._]{3,32}$/)
    .trim()
    .lowercase()
    .messages({
      "string.empty": "نام کاربری الزامی است",
      "string.min": "نام کاربری باید حداقل 3 کاراکتر باشد",
      "string.max": "نام کاربری نباید بیشتر از 32 کاراکتر باشد",
      "string.pattern.base":
        "نام کاربری فقط می‌تواند شامل حروف انگلیسی، اعداد، نقطه و خط تیره باشد",
      "any.required": "نام کاربری الزامی است",
    }),

  email: Joi.string()
    .required()
    .email(
      process.env.NODE_ENV === "production"
        ? {
            tlds: {
              allow: true,
              deny: ["test", "example", "invalid", "localhost"],
            },
            minDomainSegments: 2,
          }
        : { tlds: { allow: false } },
    )
    .trim()
    .lowercase()
    .max(254)
    .messages({
      "string.email": "ایمیل معتبر نیست (مثال: name@domain.com)",
      "string.empty": "ایمیل الزامی است",
      "string.max": "ایمیل نباید بیشتر از 254 کاراکتر باشد",
      "any.required": "ایمیل الزامی است",
    }),

  password: Joi.string()
    .required()
    .min(8)
    .max(128)
    .pattern(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/,
    )
    .messages({
      "string.empty": "رمز عبور الزامی است",
      "string.min": "رمز عبور باید حداقل 8 کاراکتر باشد",
      "string.max": "رمز عبور نباید بیشتر از 128 کاراکتر باشد",
      "string.pattern.base":
        "رمز عبور باید شامل حروف بزرگ، کوچک، عدد و کاراکتر خاص باشد",
      "any.required": "رمز عبور الزامی است",
    }),

  confirmPassword: Joi.string().required().valid(Joi.ref("password")).messages({
    "any.only": "تکرار رمز عبور با رمز عبور مطابقت ندارد",
    "string.empty": "تکرار رمز عبور الزامی است",
    "any.required": "تکرار رمز عبور الزامی است",
  }),

  clubName: Joi.string().allow("", null).max(24).trim().messages({
    "string.max": "نام باشگاه نباید بیشتر از 24 کاراکتر باشد",
  }),
}).unknown(false);

const loginSchema = Joi.object({
  email: Joi.string()
    .required()
    .email(
      process.env.NODE_ENV === "production"
        ? {
            tlds: {
              allow: true,
              deny: ["test", "example", "invalid", "localhost"],
            },
            minDomainSegments: 2,
          }
        : { tlds: { allow: false } },
    )
    .trim()
    .lowercase()
    .max(254)
    .messages({
      "string.email": "ایمیل معتبر نیست (مثال: name@domain.com)",
      "string.empty": "ایمیل الزامی است",
      "string.max": "ایمیل نباید بیشتر از 254 کاراکتر باشد",
      "any.required": "ایمیل الزامی است",
    }),

  password: Joi.string().required().messages({
    "string.empty": "رمز عبور الزامی است",
    "any.required": "رمز عبور الزامی است",
  }),
}).unknown(false);

const profileUpdateSchema = Joi.object({
  username: Joi.string()
    .min(3)
    .max(32)
    .trim()
    .lowercase()
    .pattern(/^[a-zA-Z0-9.-]{3,32}$/)
    .messages({
      "string.empty": "نام کاربری نمی‌تواند خالی باشد",
      "string.min": "نام کاربری باید حداقل 3 کاراکتر باشد",
      "string.max": "نام کاربری نباید بیشتر از 32 کاراکتر باشد",
      "string.pattern.base":
        "نام کاربری فقط می‌تواند شامل حروف انگلیسی، اعداد، نقطه و خط تیره باشد",
    }),

  email: Joi.string()
    .trim()
    .email(
      process.env.NODE_ENV === "production"
        ? {
            tlds: {
              allow: true,
              deny: ["test", "example", "invalid", "localhost"],
            },
            minDomainSegments: 2,
          }
        : { tlds: { allow: false } },
    )
    .max(254)
    .messages({
      "string.empty": "ایمیل نمی‌تواند خالی باشد",
      "string.email": "ایمیل معتبر نیست (مثال: name@domain.com)",
      "string.max": "ایمیل نباید بیشتر از 254 کاراکتر باشد",
    }),
}).unknown(false);

const checkAvailabilitySchema = Joi.object({
  email: Joi.string()
    .trim()
    .lowercase()
    .email(
      process.env.NODE_ENV === "production"
        ? {
            tlds: {
              allow: true,
              deny: ["test", "example", "invalid", "localhost"],
            },
            minDomainSegments: 2,
          }
        : { tlds: { allow: false } },
    )
    .max(254)
    .messages({
      "string.email": "ایمیل معتبر نیست (مثال: name@domain.com)",
      "string.max": "ایمیل نباید بیشتر از 254 کاراکتر باشد",
    }),

  username: Joi.string()
    .min(3)
    .max(32)
    .trim()
    .lowercase()
    .pattern(/^[a-zA-Z0-9._]{3,32}$/)
    .messages({
      "string.min": "نام کاربری باید حداقل 3 کاراکتر باشد",
      "string.max": "نام کاربری نباید بیشتر از 32 کاراکتر باشد",
      "string.pattern.base":
        "نام کاربری فقط می‌تواند شامل حروف انگلیسی، اعداد، نقطه و خط تیره باشد",
    }),
})
  .or("email", "username")
  .messages({
    "object.missing": "حداقل یکی از پارامترهای email یا username را ارسال کنید",
  })
  .unknown(false);

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required().messages({
    "string.empty": "رمز عبور فعلی را وارد کنید",
    "any.required": "رمز عبور فعلی الزامی است",
  }),

  newPassword: Joi.string()
    .required()
    .min(8)
    .max(128)
    .pattern(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/,
    )
    .messages({
      "string.empty": "رمز عبور جدید را وارد کنید",
      "any.required": "رمز عبور جدید الزامی است",
      "string.min": "رمز عبور جدید باید حداقل 8 کاراکتر باشد",
      "string.max": "رمز عبور جدید نباید بیشتر از 128 کاراکتر باشد",
      "string.pattern.base":
        "رمز عبور باید شامل حروف بزرگ، کوچک، عدد و کاراکتر خاص باشد",
    }),
}).unknown(false);

module.exports = {
  registerSchema,
  loginSchema,
  profileUpdateSchema,
  checkAvailabilitySchema,
  changePasswordSchema,
};
