import helmet from "helmet";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const configureSecurity = (app, { sessionMiddleware } = {}) => {
  app.use(
    helmet({
      hsts:
        process.env.NODE_ENV === "production"
          ? {
              maxAge: 31536000,
              includeSubDomains: true,
              preload: true,
            }
          : false,

      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'",
            "'unsafe-hashes'",
            "https://cdn.tailwindcss.com",
            "https://cdn.jsdelivr.net",
          ],
          scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          styleSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          fontSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"],
          connectSrc: [
            "'self'",
            "https://cdn.jsdelivr.net",
            // Socket.IO (some browsers don't treat 'self' as ws:// / wss://)
            (req) => `${req.secure ? "wss" : "ws"}://${req.headers.host}`,
          ],
          frameSrc: ["'self'"],
          // the theme preview in settings is a same-origin iframe; nobody else may frame us
          frameAncestors: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          // only upgrade to https in production (breaks http://localhost otherwise)
          upgradeInsecureRequests:
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "same-origin" },
      dnsPrefetchControl: { allow: false },
      frameguard: { action: "sameorigin" },
      hidePoweredBy: true,
      hpkp: false,
      ieNoOpen: true,
      noSniff: true,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      xssFilter: false, // legacy X-XSS-Protection is harmful in old browsers; CSP covers this
    }),
  );

  const isLocalOrigin = (origin) =>
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  const corsOptions = {
    origin: (origin, callback) => {
      // Same-origin / server-to-server requests have no Origin header.
      if (!origin) return callback(null, true);

      const allowedOrigins = (process.env.CORS_ORIGIN || "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);

      const isDev = process.env.NODE_ENV !== "production";
      if (allowedOrigins.includes(origin) || (isDev && isLocalOrigin(origin))) {
        return callback(null, true);
      }

      // Not an error: simply don't add CORS headers (browser blocks it).
      return callback(null, false);
    },

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Access-Control-Allow-Origin",
      "X-CSRF-Token",
    ],

    exposedHeaders: [
      "X-Total-Count",
      "X-Pagination-Page",
      "X-Pagination-Limit",
      "Content-Disposition",
    ],

    credentials: true,
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204,
  };

  // CORS
  app.use(cors(corsOptions));

  // Rate limiter
  const rateLimitBridge = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: (req, res) => {
      if (req.method === "GET") {
        if (req.path.startsWith("/i/")) return 50;
        if (req.path.startsWith("/auth/")) return 100;
        if (req.path.startsWith("/admin/")) return 500;
        if (req.path.startsWith("/dashboard")) return 300;
        if (req.path.startsWith("/invoices")) return 500;
        if (req.path.startsWith("/plans")) return 300;
        if (req.path.startsWith("/settings")) return 150;
        if (req.path.startsWith("/profile")) return 150;

        const role = req.session?.user?.role || null;
        if (!role) return 150;
        else if (role === "owner" || role === "member") return 500;
        else if (role === "admin" || role === "moderator") return 800;
        return 200;
      }

      if (req.method === "POST") {
        if (req.path.startsWith("/auth/register")) return 20;
        if (req.path.startsWith("/auth/login")) return 30;
        if (req.path.startsWith("/invoices")) return 100;
        if (req.path.startsWith("/plans")) return 50;
        if (req.path.startsWith("/change-password")) return 10;

        const role = req.session?.user?.role || null;
        if (!role) return 30;
        else if (role === "owner" || role === "member") return 150;
        else if (role === "admin" || role === "moderator") return 300;
        return 50;
      }

      if (req.method === "DELETE") {
        if (req.path.startsWith("/invoices/")) return 50;
        if (req.path.startsWith("/plans/")) return 30;
        if (req.path.startsWith("/admin/users/")) return 50;
        if (req.path.startsWith("/admin/invoices/")) return 80;

        const role = req.session?.user?.role || null;
        if (!role) return 20;
        else if (role === "owner" || role === "member") return 50;
        else if (role === "admin" || role === "moderator") return 150;
        return 30;
      }

      if (req.method === "PATCH" || req.method === "PUT") {
        if (req.path.startsWith("/profile/update")) return 20;
        if (req.path.startsWith("/settings")) return 20;
        if (req.path.startsWith("/invoices/")) return 40;
        if (req.path.includes("/toggle-payment")) return 30;
        if (req.path.startsWith("/plans/")) return 30;
        if (req.path.startsWith("/admin/users/")) return 50;

        const role = req.session?.user?.role || null;
        if (!role) return 20;
        else if (role === "owner" || role === "member") return 60;
        else if (role === "admin" || role === "moderator") return 150;
        return 30;
      }

      if (req.method === "OPTIONS") {
        return 2000;
      }

      return 150;
    },
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => {
      const user = req.session?.user || null;
      if (!user) return ipKeyGenerator(req.ip);
      else return `${user.id}+${ipKeyGenerator(req.ip)}`;
    },
    skip: (req) => {
      return ["127.0.0.1"].includes(req.ip);
    },
    // Count every request (it used to count only failed ones, so floods of
    // successful requests were never limited).
    skipSuccessfulRequests: false,
    handler: (req, res, next, options) => {
      const resetTime = req.rateLimit?.resetTime || Date.now() + 60 * 1000;
      const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
      const safeRetryAfter = Math.max(0, retryAfter);

      if (req.method === "GET") {
        return res.status(429).render("rateLimit", {
          resetTime: resetTime,
          retryAfter: safeRetryAfter,
          redirectTo: req.originalUrl || "/dashboard",
        });
      }

      return res.status(429).json({
        success: false,
        message: "تعداد درخواست‌ها بیش از حد مجاز است",
        retryAfter: safeRetryAfter,
      });
    },
    requestPropertyName: "rateLimit",
  });

  // --- Strict limiters for the endpoints attackers actually target ---
  const jsonLimitHandler = (req, res) =>
    res.status(429).json({
      success: false,
      message: "تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید",
    });

  const ipKey = (req) => ipKeyGenerator(req.ip);

  // Brute force on login: only FAILED attempts count, per IP.
  app.post(
    "/auth/login",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      skipSuccessfulRequests: true,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      keyGenerator: ipKey,
      handler: jsonLimitHandler,
    }),
  );

  // Mass account creation
  app.post(
    "/auth/register",
    rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      keyGenerator: ipKey,
      handler: jsonLimitHandler,
    }),
  );

  // Username/e-mail enumeration through the live availability check
  app.get(
    "/auth/check-availability",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      keyGenerator: ipKey,
      handler: jsonLimitHandler,
    }),
  );

  // OTP endpoints: sending e-mails is expensive and guessable -> tight per-IP caps
  const otpSend = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: ipKey,
    handler: jsonLimitHandler,
  });
  const otpCheck = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: ipKey,
    handler: jsonLimitHandler,
  });
  app.post(
    [
      "/auth/verify/resend",
      "/auth/login/otp/request",
      "/auth/forgot",
      "/account/email",
    ],
    otpSend,
  );
  app.post(
    [
      "/auth/verify",
      "/auth/login/otp/verify",
      "/auth/reset",
      "/account/email/verify",
    ],
    otpCheck,
  );

  // The session must exist before the generic limiter: it keys (and sizes)
  // its buckets by the logged-in user/role. Previously the session was mounted
  // later, so those per-role limits never applied.
  if (sessionMiddleware) app.use(sessionMiddleware);

  app.use(rateLimitBridge);
};

export default configureSecurity;
