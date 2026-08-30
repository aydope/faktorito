const AppError = require("../utils/AppError");

const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = {};
      error.details.forEach((detail) => {
        const key = detail.path.join(".");
        errors[key] = detail.message;
      });

      const appError = AppError.badRequest("داده‌های ارسالی نامعتبر هستند");
      appError.errors = errors;
      return next(appError);
    }

    req.validatedBody = value;
    next();
  };
};

module.exports = validateRequest;
