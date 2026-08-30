const AppError = require("../utils/AppError");

const handleCastErrorDB = (err) => {
  const message = `مقدار نامعتبر برای ${err.path}: ${err.value}`;
  return AppError.badRequest(message);
};

const handleDuplicateFieldsDB = (err) => {
  const value = err.errmsg?.match(/(["'])(\\?.)*?\1/)[0] || "نامشخص";
  const message = `مقدار تکراری: ${value}. لطفا مقدار دیگری وارد کنید`;
  return AppError.badRequest(message);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `داده‌های نامعتبر: ${errors.join(". ")}`;
  return AppError.badRequest(message);
};

const handleJWTError = () => {
  return AppError.unauthorized("توکن نامعتبر است. لطفا دوباره وارد شوید");
};
const handleJWTExpiredError = () => {
  return AppError.unauthorized("توکن منقضی شده است. لطفا دوباره وارد شوید");
};

const isAPIRequest = (req) => {
  return (
    req.originalUrl.startsWith("/api") ||
    req.xhr ||
    req.headers["content-type"] === "application/json" ||
    (req.headers["accept"] &&
      req.headers["accept"].includes("application/json"))
  );
};

const sendErrorDev = (err, req, res) => {
  // API
  if (isAPIRequest(req)) {
    return res.status(err.statusCode).json({
      success: false,
      error: err,
      validationErrors: err.errors,
      message: err.message,
      stack: err.stack,
    });
  }
  // Rendered page
  return res.status(err.statusCode).render("error", {
    title: "خطا",
    message: err.message,
    statusCode: err.statusCode,
    isLoggedIn: !!req.session?.user,
  });
};

const sendErrorProd = (err, req, res) => {
  // API
  if (isAPIRequest(req)) {
    if (err.isOperational) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        errors: err.errors || [err.message],
      });
    }
    // Programming or unknown error
    console.error("ERROR 💥", err);
    return res.status(500).json({
      success: false,
      message: "خطایی رخ داده است. لطفا بعدا تلاش کنید",
    });
  }

  // Rendered page
  if (err.isOperational) {
    return res.status(err.statusCode).render("error", {
      title: "خطا",
      message: err.message,
    });
  }
  console.error("ERROR 💥", err);
  return res.status(500).render("error", {
    title: "خطا",
    message: "خطایی رخ داده است. لطفا بعدا تلاش کنید",
  });
};

module.exports = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;

  if (process.env.NODE_ENV === "development") {
    sendErrorDev(err, req, res);
  } else {
    let error = { ...err, message: err.message, name: err.name };

    if (error.name === "CastError") error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === "ValidationError")
      error = handleValidationErrorDB(error);
    if (error.name === "JsonWebTokenError") error = handleJWTError();
    if (error.name === "TokenExpiredError") error = handleJWTExpiredError();

    sendErrorProd(error, req, res);
  }
};
