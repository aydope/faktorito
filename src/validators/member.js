import Joi from "joi";
import { normalizeDigits } from "../utils/query.js";

const name = Joi.string()
  .trim()
  .min(3)
  .max(32)
  .pattern(/^[A-Za-zا-ی\u200c\s]+$/)
  .messages({
    "string.empty": "نام عضو الزامی است",
    "string.min": "نام عضو باید حداقل 3 کاراکتر باشد",
    "string.max": "نام عضو نباید بیشتر از 32 کاراکتر باشد",
    "string.pattern.base":
      "نام عضو فقط می‌تواند شامل حروف انگلیسی، حروف فارسی و فاصله باشد",
    "any.required": "نام عضو الزامی است",
  });

const phone = Joi.string()
  .trim()
  .allow("", null)
  .custom((value) => normalizeDigits(value))
  .pattern(/^09\d{9}$/)
  .messages({
    "string.pattern.base": "شماره تلفن باید با 09 شروع شده و 11 رقم باشد",
  });

const email = Joi.string()
  .trim()
  .lowercase()
  .allow("", null)
  .email({ tlds: { allow: false } })
  .max(254)
  .messages({ "string.email": "ایمیل نامعتبر است" });

const notes = Joi.string().trim().allow("", null).max(200).messages({
  "string.max": "یادداشت نباید بیشتر از 200 کاراکتر باشد",
});

const memberSchema = Joi.object({
  name: name.required(),
  phone,
  email,
  notes,
}).unknown(false);

const updateMemberSchema = Joi.object({
  name,
  phone,
  email,
  notes,
  status: Joi.string().valid("active", "frozen", "inactive").messages({
    "any.only": "وضعیت عضو نامعتبر است",
  }),
}).unknown(false);

export { memberSchema, updateMemberSchema };
