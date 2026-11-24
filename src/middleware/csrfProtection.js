import AppError from "../utils/AppError.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection for cookie-session apps without touching every form:
 * state-changing requests must come from the same origin.
 *
 *  - Browsers always send `Sec-Fetch-Site` (modern) and/or `Origin` on
 *    cross-site POST/PUT/PATCH/DELETE requests, and JS on another site cannot
 *    forge them.
 *  - Extra allowed origins can be listed in CORS_ORIGIN (comma separated).
 */
const csrfProtection = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    // same-site (sub-domain) is not trusted either
    return next(AppError.forbidden("درخواست از مبدأ نامعتبر ارسال شد"));
  }

  const origin = req.get("origin");
  if (origin) {
    const allowed = new Set(
      (process.env.CORS_ORIGIN || "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    );
    allowed.add(`${req.protocol}://${req.get("host")}`);

    if (!allowed.has(origin)) {
      return next(AppError.forbidden("درخواست از مبدأ نامعتبر ارسال شد"));
    }
  }

  next();
};

export default csrfProtection;
