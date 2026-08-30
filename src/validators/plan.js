const Joi = require("joi");

const planSchema = Joi.object({
  name: Joi.string().required().min(2).max(24).messages({
    "string.empty": "نام پلن الزامی است",
    "any.required": "نام پلن الزامی است",
    "string.min": "نام پلن باید حداقل 2 کاراکتر باشد",
    "string.max": "نام پلن نباید بیشتر از 24 کاراکتر باشد",
  }),

  price: Joi.number().required().min(0).max(100_000_000).messages({
    "number.base": "قیمت باید عدد باشد",
    "any.required": "قیمت الزامی است",
    "number.min": "قیمت نمی‌تواند کمتر از صفر (رایگان) باشد",
    "number.max": "قیمت نمی‌تواند بیشتر از 100 میلیون تومان باشد",
  }),

  description: Joi.string().allow("").max(128).messages({
    "string.max": "توضیحات نباید بیشتر از 128 کاراکتر باشد",
  }),
}).unknown(false);

module.exports = {
  planSchema,
};
