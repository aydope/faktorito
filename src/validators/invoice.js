const Joi = require("joi");

// validation/invoiceValidation.js
const invoiceSchema = Joi.object({
  memberName: Joi.string()
    .required()
    .min(3)
    .max(32)
    .pattern(/^[A-Za-zا-ی\s]+$/)
    .messages({
      "string.empty": "نام عضو الزامی است",
      "string.min": "نام عضو باید حداقل 3 کاراکتر باشد",
      "string.max": "نام عضو نباید بیشتر از 32 کاراکتر باشد",
      "any.required": "نام عضو الزامی است",
      "string.pattern.base":
        "نام عضو فقط میتونه شامل حروف انگلیسی، حروف فارسی و فاصله باشه",
    }),

  memberPhone: Joi.string()
    .allow("", null)
    .pattern(/^09\d{9}$/)
    .messages({
      "string.pattern.base": "شماره تلفن باید با 09 شروع شده و 11 رقم باشد",
    }),

  memberId: Joi.string()
    .allow("", null)
    .max(50)
    .pattern(/^[A-Za-z0-9-]+$/)
    .messages({
      "string.max": "شناسه عضو نباید بیشتر از 50 کاراکتر باشد",
      "string.pattern.base":
        "کد عضو فقط میتونه شامل حروف انگلیسی، اعداد و حروف فارسی باشه",
    }),

  planId: Joi.string().required().messages({
    "any.required": "انتخاب پلن الزامی است",
    "string.empty": "انتخاب پلن الزامی است",
  }),

  cafeItems: Joi.array()
    .items(
      Joi.object({
        name: Joi.string().required().min(1).max(64).trim().messages({
          "string.empty": "نام آیتم الزامی است",
          "string.min": "نام آیتم باید حداقل 1 کاراکتر باشد",
          "string.max": "نام آیتم نباید بیشتر از 64 کاراکتر باشد",
          "any.required": "نام آیتم الزامی است",
        }),
        price: Joi.number().integer().positive().required().messages({
          "number.base": "قیمت آیتم باید عدد باشد",
          "number.integer": "قیمت آیتم باید عدد صحیح باشد",
          "number.positive": "قیمت آیتم باید بیشتر از 0 باشد",
          "any.required": "قیمت آیتم الزامی است",
        }),
      }),
    )
    .default([])
    .messages({
      "array.base": "آیتم‌ها باید به صورت آرایه باشد",
    }),

  discounts: Joi.array()
    .items(
      Joi.object({
        description: Joi.string().required().min(1).max(64).trim().messages({
          "string.empty": "توضیح تخفیف الزامی است",
          "string.min": "توضیح تخفیف باید حداقل 1 کاراکتر باشد",
          "string.max": "توضیح تخفیف نباید بیشتر از 64 کاراکتر باشد",
          "any.required": "توضیح تخفیف الزامی است",
        }),
        type: Joi.string().valid("amount", "percent").required().messages({
          "any.only": "نوع تخفیف باید مبلغ یا درصدی باشد",
          "any.required": "نوع تخفیف الزامی است",
        }),
        value: Joi.number().integer().positive().required().messages({
          "number.base": "مقدار تخفیف باید عدد باشد",
          "number.integer": "مقدار تخفیف باید عدد صحیح باشد",
          "number.positive": "مقدار تخفیف باید بیشتر از 0 باشد",
          "any.required": "مقدار تخفیف الزامی است",
        }),
      }),
    )
    .default([])
    .messages({
      "array.base": "تخفیف‌ها باید به صورت آرایه باشد",
    }),

  note: Joi.string().allow("", null).max(64).trim().messages({
    "string.max": "یادداشت نباید بیشتر از 64 کاراکتر باشد",
  }),
});

const updateInvoiceSchema = Joi.object({
  memberName: Joi.string()
    .trim()
    .min(3)
    .max(32)
    .pattern(/^[A-Za-zا-ی\s]+$/)
    .messages({
      "string.min": "نام عضو باید حداقل 3 کاراکتر باشد",
      "string.max": "نام عضو نباید بیشتر از 32 کاراکتر باشد",
      "string.pattern.base":
        "نام عضو فقط میتونه شامل حروف انگلیسی، حروف فارسی و فاصله باشه",
    }),

  memberPhone: Joi.string()
    .trim()
    .allow("", null)
    .pattern(/^09\d{9}$/)
    .messages({
      "string.pattern.base": "شماره تلفن باید با 09 شروع شده و 11 رقم باشد",
    }),

  memberId: Joi.string()
    .trim()
    .allow("", null)
    .max(50)
    .pattern(/^[A-Za-z0-9-]+$/)
    .messages({
      "string.max": "شناسه عضو نباید بیشتر از 50 کاراکتر باشد",
      "string.pattern.base":
        "کد عضو فقط میتونه شامل حروف انگلیسی، اعداد و حروف فارسی باشه",
    }),

  planId: Joi.string().allow("", null).messages({
    "string.empty": "شناسه پلن نمی‌تواند خالی باشد",
  }),

  note: Joi.string().trim().allow("", null).max(64).messages({
    "string.max": "یادداشت نباید بیشتر از 64 کاراکتر باشد",
  }),

  isPaid: Joi.string().valid("true", "false").messages({
    "any.only": "وضعیت پرداخت باید true یا false باشد",
  }),
}).unknown(false);

module.exports = {
  invoiceSchema,
  updateInvoiceSchema,
};
