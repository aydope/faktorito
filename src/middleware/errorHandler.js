import crypto from "node:crypto";
import AppError from "../utils/AppError.js";
import { homeFor } from "../config/permissions.js";

/**
 * What the visitor may see: a status code, a short safe message and, for server
 * errors, a tracking code. NEVER the error object, its message or its stack
 * (EJS/Mongo errors contain file paths and queries), not even in development.
 * The full details go to the server log under the same tracking code.
 */

const FIELD_LABELS = {
  username: "نام کاربری",
  email: "ایمیل",
  invoiceNumber: "شماره فاکتور",
  code: "کد عضویت",
  phone: "شماره تلفن",
};

// safe, generic wording per status code
const MESSAGES = {
  400: "درخواست نامعتبر است",
  401: "برای ادامه باید وارد شوید",
  403: "شما اجازه دسترسی به این بخش را ندارید",
  404: "صفحه‌ی مورد نظر پیدا نشد",
  405: "این درخواست در این مسیر مجاز نیست",
  409: "اطلاعات تکراری یا متناقض است",
  413: "حجم داده‌های ارسالی بیش از حد مجاز است",
  415: "نوع داده‌ی ارسالی پشتیبانی نمی‌شود",
  422: "داده‌های ارسالی نامعتبر است",
  429: "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید",
  500: "مشکلی از سمت ما پیش آمد. این خطا ثبت شد و بررسی می‌شود",
  503: "سرویس موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید",
};
const messageFor = (status) =>
  MESSAGES[status] || (status >= 500 ? MESSAGES[500] : MESSAGES[400]);

const DB_DOWN = new Set([
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoServerSelectionError",
  "MongooseServerSelectionError",
]);

/** Turns anything thrown into { statusCode, message, errors, operational } with a SAFE message. */
export const normalizeError = (err) => {
  if (err instanceof AppError) {
    // a developer-written message is only shown when the error is an expected one (4xx)
    return {
      statusCode: err.statusCode,
      message: err.isOperational ? err.message : messageFor(err.statusCode),
      errors: err.isOperational ? err.errors : undefined,
      operational: err.isOperational,
      retryAfter: err.retryAfter,
    };
  }

  if (err?.name === "CastError") {
    return {
      statusCode: 400,
      message: `مقدار نامعتبر برای ${String(err.path || "ورودی").slice(0, 40)}`,
      operational: true,
    };
  }

  if (err?.code === 11000) {
    // never echo the duplicate value back (information leak)
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    return {
      statusCode: 409,
      message: `${FIELD_LABELS[field] || "مقدار"} تکراری است. لطفا مقدار دیگری وارد کنید`,
      operational: true,
    };
  }

  if (err?.name === "ValidationError" && err.errors) {
    const errors = {};
    for (const [path, el] of Object.entries(err.errors))
      errors[path] = el.message;
    return {
      statusCode: 400,
      message: `داده‌های نامعتبر: ${Object.values(errors).join(". ")}`,
      errors,
      operational: true,
    };
  }

  // the database is down / unreachable: tell the visitor to retry, not what failed
  if (
    DB_DOWN.has(err?.name) ||
    /buffering timed out/i.test(err?.message || "")
  ) {
    return {
      statusCode: 503,
      message: messageFor(503),
      operational: true,
      retryAfter: 30,
    };
  }

  // body-parser and other http-errors: use OUR wording for that status
  const status = Number(err?.statusCode ?? err?.status);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return {
      statusCode: status,
      message: messageFor(status),
      operational: true,
    };
  }

  return { statusCode: 500, message: messageFor(500), operational: false };
};

const isAPIRequest = (req) =>
  req.originalUrl.startsWith("/api") ||
  req.xhr ||
  (req.headers["content-type"] || "").includes("application/json") ||
  req.accepts(["html", "json"]) === "json";

const newErrorId = () => crypto.randomBytes(4).toString("hex").toUpperCase();

const logError = ({ errorId, req, statusCode, err }) => {
  const who = req.session?.user?.id ? ` user=${req.session.user.id}` : "";
  const body = err?.stack || err?.message || String(err);
  console.error(
    `ERROR [${errorId}] ${req.method} ${req.originalUrl.split("?")[0]} -> ${statusCode}${who}\n${body}`,
  );
};

/** Last line of defence: a template that prints a stack trace (old copies of the page did) is cleaned before it is sent. */
export const stripStackBlocks = (html) =>
  String(html).replace(
    /<pre[^>]*class=["'][^"']*\bstack\b[^"']*["'][^>]*>[\s\S]*?<\/pre>/gi,
    "",
  );

const errorHandler = (err, req, res, next) => {
  // the response already started: all we can do is let Express close the connection
  if (res.headersSent) return next(err);

  const info = normalizeError(err);
  const statusCode =
    info.statusCode >= 400 && info.statusCode <= 599 ? info.statusCode : 500;
  const message = info.message;

  // server errors (and anything unexpected) get a reference to quote; the details stay in the log
  const errorId = statusCode >= 500 || !info.operational ? newErrorId() : null;
  if (errorId) logError({ errorId, req, statusCode, err });

  if (info.retryAfter) res.setHeader("Retry-After", String(info.retryAfter));

  if (isAPIRequest(req)) {
    return res.status(statusCode).json({
      success: false,
      message,
      errors: info.errors || [message],
      ...(info.errors ? { validationErrors: info.errors } : {}),
      ...(info.retryAfter ? { retryAfter: info.retryAfter } : {}),
      ...(errorId ? { errorId } : {}),
    });
  }

  const sessionUser = req.session?.user;
  const locals = {
    title: "خطا",
    statusCode,
    message,
    errorId,
    retryAfter: info.retryAfter || null,
    isLoggedIn: !!sessionUser,
    homeHref: sessionUser ? homeFor(sessionUser.role) : "/",
    // never real data: an older copy of the view that still reads these prints nothing
    stack: "",
    isDevelopment: false,
  };

  // like the original project: 404 has its own view file (it shows the same page)
  res
    .status(statusCode)
    .render(statusCode === 404 ? "404" : "error", locals, (renderErr, html) => {
      if (renderErr) {
        // the error page itself failed: plain text, still without internals
        logError({
          errorId: errorId || newErrorId(),
          req,
          statusCode,
          err: renderErr,
        });
        return res
          .type("text/plain; charset=utf-8")
          .send(`${statusCode} - ${message}`);
      }
      res.send(stripStackBlocks(html));
    });
};

export default errorHandler;
