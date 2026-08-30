class AppError extends Error {
  constructor(message, statusCode, isOperational = true, details = null) {
    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "Fail" : "ERROR";
    this.isOperational = isOperational;
    this.details = details;
    this.timestamp = new Date().toISOString();

    if (statusCode === 400) this.type = "BadRequest";
    else if (statusCode === 401) this.type = "Unauthorized";
    else if (statusCode === 403) this.type = "Forbidden";
    else if (statusCode === 404) this.type = "NotFound";
    else if (statusCode === 409) this.type = "Conflict";
    else if (statusCode === 422) this.type = "ValidationError";
    else if (statusCode === 429) this.type = "TooManyRequests";
    else if (statusCode >= 500) this.type = "ServerError";
    else this.type = "UnknownError";

    if (isOperational) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      success: false,
      message: this.message,
      statusCode: this.statusCode,
      status: this.status,
      type: this.type,
      ...(this.details && { details: this.details }),
      ...(process.env.NODE_ENV === "development" && { stack: this.stack }),
    };
  }

  static validation(message, details = null) {
    return new AppError(message, 422, true, details);
  }

  static notFound(message = "منبع مورد نظر یافت نشد") {
    return new AppError(message, 404, true);
  }

  static unauthorized(message = "دسترسی غیرمجاز") {
    return new AppError(message, 401, true);
  }

  static forbidden(message = "شما اجازه دسترسی به این بخش را ندارید") {
    return new AppError(message, 403, true);
  }

  static conflict(message = "اطلاعات تکراری است") {
    return new AppError(message, 409, true);
  }

  static internal(message = "خطای داخلی سرور") {
    return new AppError(message, 500, false);
  }

  static badRequest(message = "درخواست نامعتبر") {
    return new AppError(message, 400, true);
  }
}

module.exports = AppError;
