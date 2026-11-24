import Joi from "joi";
import { normalizeDigits } from "../utils/query.js";

const TERMS_MSG = "برای ساخت باشگاه باید شرایط ویژه‌ی صاحبان باشگاه را بپذیرید";

export const createGymSchema = Joi.object({
  clubName: Joi.string().trim().min(2).max(24).required().messages({
    "string.empty": "نام باشگاه الزامی است",
    "any.required": "نام باشگاه الزامی است",
    "string.min": "نام باشگاه باید حداقل 2 کاراکتر باشد",
    "string.max": "نام باشگاه نباید بیشتر از 24 کاراکتر باشد",
  }),
  clubPhone: Joi.string()
    .trim()
    .allow("", null)
    .custom((v) => normalizeDigits(v))
    .pattern(/^09\d{9}$/)
    .messages({
      "string.pattern.base": "شماره تلفن باید با 09 شروع شده و 11 رقم باشد",
    }),
  clubAddress: Joi.string().trim().allow("", null).max(128).messages({
    "string.max": "آدرس نباید بیشتر از 128 کاراکتر باشد",
  }),
  // only people who open a gym accept the extra terms
  acceptBusinessTerms: Joi.boolean().valid(true).required().messages({
    "any.only": TERMS_MSG,
    "any.required": TERMS_MSG,
    "boolean.base": TERMS_MSG,
  }),
}).unknown(false);
