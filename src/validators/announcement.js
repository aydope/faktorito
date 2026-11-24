import Joi from "joi";

export const DURATIONS_HOURS = [1, 6, 12, 24, 48, 72, 168];
export const DEFAULT_HOURS = 24;

export const announcementSchema = Joi.object({
  title: Joi.string().trim().min(2).max(60).required().messages({
    "string.empty": "عنوان اعلان الزامی است",
    "any.required": "عنوان اعلان الزامی است",
    "string.min": "عنوان باید حداقل 2 کاراکتر باشد",
    "string.max": "عنوان نباید بیشتر از 60 کاراکتر باشد",
  }),
  body: Joi.string().trim().min(2).max(500).required().messages({
    "string.empty": "متن اعلان الزامی است",
    "any.required": "متن اعلان الزامی است",
    "string.min": "متن باید حداقل 2 کاراکتر باشد",
    "string.max": "متن نباید بیشتر از 500 کاراکتر باشد",
  }),
  hours: Joi.number()
    .valid(...DURATIONS_HOURS)
    .default(DEFAULT_HOURS)
    .messages({
      "any.only": "مدت نمایش نامعتبر است",
    }),
}).unknown(false);
