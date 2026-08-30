const Joi = require("joi");

const settingsSchema = Joi.object({
  clubName: Joi.string().trim().min(1).max(24).messages({
    "string.empty": "نام باشگاه نمی‌تواند خالی باشد",
    "string.min": "نام باشگاه باید حداقل 1 کاراکتر باشد",
    "string.max": "نام باشگاه نباید بیشتر از 24 کاراکتر باشد",
  }),

  clubPhone: Joi.string()
    .trim()
    .allow("", null)
    .pattern(/^09\d{9}$/)
    .messages({
      "string.pattern.base": "شماره تماس نامعتبر است (مثال: 09123456789)",
    }),

  clubEmail: Joi.string()
    .trim()
    .allow("", null)
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
      "string.email": "ایمیل نامعتبر است (مثال: info@club.com)",
      "string.empty": "ایمیل نمی‌تواند خالی باشد",
      "string.max": "ایمیل نباید بیشتر از 254 کاراکتر باشد",
    }),

  clubAddress: Joi.string().trim().allow("", null).max(128).messages({
    "string.max": "آدرس نباید بیشتر از 128 کاراکتر باشد",
  }),

  clubCode: Joi.string()
    .trim()
    .allow("", null)
    .pattern(/^[a-zA-Z0-9ا-ی\-_]{3,30}$/)
    .messages({
      "string.pattern.base":
        "کد باشگاه فقط باید شامل حروف انگلیسی، اعداد و خط تیره باشد (3 تا 30 کاراکتر)",
      "string.empty": "کد باشگاه نمی‌تواند خالی باشد",
    }),
}).unknown(false);

module.exports = { settingsSchema };
