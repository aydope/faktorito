import Joi from "joi";

export const deletionSchema = Joi.object({
  password: Joi.string()
    .required()
    .messages({ "any.required": "رمز عبور الزامی است" }),
  reason: Joi.string().trim().allow("").max(300),
}).unknown(false);

export const emailChangeSchema = Joi.object({
  email: Joi.string()
    .trim()
    .lowercase()
    .email({ tlds: { allow: false } })
    .max(254)
    .required()
    .messages({
      "any.required": "ایمیل الزامی است",
      "string.empty": "ایمیل الزامی است",
      "string.email": "ایمیل معتبر نیست",
    }),
}).unknown(false);

export const emailConfirmSchema = Joi.object({
  code: Joi.string()
    .pattern(/^\d{6}$/)
    .required()
    .messages({
      "any.required": "کد را وارد کنید",
      "string.empty": "کد را وارد کنید",
      "string.pattern.base": "کد باید 6 رقم باشد",
    }),
}).unknown(false);
