import Joi from "joi";
import { INTERVAL_CHOICES } from "../utils/period.js";

const YEAR_MS = 366 * 24 * 60 * 60 * 1000;

export const autoRuleSchema = Joi.object({
  planId: Joi.string().hex().length(24).required().messages({
    "any.required": "پلن را انتخاب کنید",
    "string.length": "پلن نامعتبر است",
    "string.hex": "پلن نامعتبر است",
  }),
  intervalMonths: Joi.number()
    .valid(...INTERVAL_CHOICES)
    .required()
    .messages({
      "any.required": "بازه‌ی صدور را انتخاب کنید",
      "any.only": "بازه‌ی صدور معتبر نیست",
      "number.base": "بازه‌ی صدور معتبر نیست",
    }),
  // first / next issue date; omitted -> the member's expiry (or now).
  // (checked at request time: Joi.date().max(Date.now()+x) would freeze "now" at boot)
  nextIssueAt: Joi.date()
    .iso()
    .custom((value, helpers) =>
      value.getTime() > Date.now() + YEAR_MS
        ? helpers.error("date.max")
        : value,
    )
    .messages({
      "date.base": "تاریخ صدور نامعتبر است",
      "date.format": "تاریخ صدور نامعتبر است",
      "date.max": "تاریخ صدور حداکثر یک سال بعد می‌تواند باشد",
    }),
  active: Joi.boolean(),
  note: Joi.string().trim().allow("").max(200),
}).unknown(false);

export const autoRulePatchSchema = Joi.object({
  planId: autoRuleSchema.extract("planId").optional(),
  intervalMonths: autoRuleSchema.extract("intervalMonths").optional(),
  nextIssueAt: autoRuleSchema.extract("nextIssueAt"),
  active: Joi.boolean(),
  note: autoRuleSchema.extract("note"),
})
  .min(1)
  .unknown(false);
