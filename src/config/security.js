const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const configureSecurity = (app) => {
  app.use(
    helmet({
      hsts:
        process.env.NODE_ENV === "production"
          ? {
              maxAge: 2592000,
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
            "https://cdn.tailwindcss.com",
            "https://cdn.jsdelivr.net",
          ],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          styleSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "same-origin" },
      dnsPrefetchControl: { allow: false },
      frameguard: { action: "deny" },
      hidePoweredBy: true,
      hpkp: false,
      ieNoOpen: true,
      noSniff: true,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      xssFilter: true,
    }),
  );

  const corsOptions = {
    origin: (origin, callback) => {
      if (process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }

      const allowedOrigins = process.env.CORS_ORIGIN?.split(",") || [];

      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked: ${origin}`);
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
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
        if (req.path.startsWith("/i/")) return 500;
        if (req.path.startsWith("/auth/")) return 100;
        if (req.path.startsWith("/admin/")) return 500;
        if (req.path.startsWith("/dashboard")) return 300;
        if (req.path.startsWith("/invoices")) return 500;
        if (req.path.startsWith("/plans")) return 300;
        if (req.path.startsWith("/settings")) return 150;
        if (req.path.startsWith("/profile")) return 150;

        const role = req.session?.user?.role || null;
        if (!role) return 150;
        else if (role === "user") return 500;
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
        else if (role === "user") return 150;
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
        else if (role === "user") return 50;
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
        else if (role === "user") return 60;
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
      if (!user) return rateLimit.ipKeyGenerator(req.ip);
      else return `${user.id}+${rateLimit.ipKeyGenerator(req.ip)}`;
    },
    skip: (req) => {
      return ["127.0.0.1"].includes(req.ip);
    },
    skipSuccessfulRequests: true,
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

  app.use(rateLimitBridge);
};

module.exports = configureSecurity;
