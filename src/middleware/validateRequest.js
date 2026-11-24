import AppError from "../utils/AppError.js";
import { JOI_OPTIONS, messageFor } from "../validators/messages.js";

const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, JOI_OPTIONS);

    if (error) {
      const errors = {};
      error.details.forEach((detail) => {
        const key = detail.path.join(".");
        errors[key] = messageFor(detail);
      });

      const appError = AppError.badRequest("داده‌های ارسالی نامعتبر هستند");
      appError.errors = errors;
      return next(appError);
    }

    req.validatedBody = value;
    next();
  };
};

export default validateRequest;
