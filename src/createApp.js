import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import methodOverride from "method-override";
import cookieParser from "cookie-parser";

import authRoutes, { aliasRouter } from "./routes/auth.js";
import reportRoutes from "./routes/reports.js";
import invoiceRoutes from "./routes/invoices.js";
import pageRoutes from "./routes/pages.js";
import adminRoutes from "./routes/admin.js";
import memberRoutes from "./routes/members.js";
import gymRoutes from "./routes/gym.js";
import { enhanceHtml } from "./utils/htmlEnhance.js";
import autoInvoiceRoutes from "./routes/autoInvoices.js";
import announcementRoutes from "./routes/announcements.js";
import brandingRoutes from "./routes/branding.js";
import { meRouter, notificationRouter, accountRouter } from "./routes/panel.js";

import errorHandler from "./middleware/errorHandler.js";
import notFoundHandler from "./middleware/notFound.js";
import requestLogger from "./middleware/requestLogger.js";
import csrfProtection from "./middleware/csrfProtection.js";
import checkAccountStatus from "./middleware/checkAccountStatus.js";
import { authenticate, ownerArea, memberOnly } from "./middleware/auth.js";
import * as db from "./config/database.js";
import configureSecurity from "./config/security.js";
import configureSession from "./config/session.js";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Builds the Express app without starting anything, so it can be tested and so
 * the same session middleware can be shared with Socket.IO.
 */
export const createApp = ({ sessionStore } = {}) => {
  const app = express();
  const IS_PRODUCTION = process.env.NODE_ENV === "production";

  // Must be set BEFORE the rate limiter / session so req.ip and req.protocol
  // are the real client values behind a reverse proxy (Railway, Nginx, ...).
  app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));
  app.set("view engine", "ejs");
  app.set("views", path.join(rootDir, "views"));
  app.set("query parser", "extended");
  app.disable("x-powered-by");
  if (IS_PRODUCTION) app.enable("view cache");

  app.use(compression());

  // cheap endpoints first: no session, no rate-limit bucket, no DB session read
  app.get("/health", (req, res) => {
    res.status(db.isConnected() ? 200 : 503).json({ status: db.getStatus() });
  });

  app.use(
    express.static(path.join(rootDir, "public"), {
      index: false,
      maxAge: IS_PRODUCTION ? "7d" : 0,
      etag: true,
      setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
    }),
  );

  const sessionMiddleware = configureSession({ store: sessionStore });
  // helmet + CORS -> session -> rate limiting (order matters, see security.js)
  configureSecurity(app, { sessionMiddleware });

  // The drawn signature (a list of points) is the only larger JSON body.
  app.use("/settings/branding", express.json({ limit: "96kb" }));
  app.use(express.json({ limit: "10kb" }));
  app.use(
    express.urlencoded({ extended: true, limit: "10kb", parameterLimit: 200 }),
  );
  app.use(cookieParser());
  // Same-origin check for POST/PUT/PATCH/DELETE (CSRF)
  app.use(csrfProtection);
  app.use(methodOverride("_method"));
  app.use(requestLogger);

  // shared accessibility + cookie assets on every rendered page (not the preview iframe)
  app.use((req, res, next) => {
    const render = res.render.bind(res);
    res.render = (view, options, callback) => {
      const done = typeof options === "function" ? options : callback;
      const opts = typeof options === "function" ? undefined : options;
      render(view, opts, (err, html) => {
        if (err) return done ? done(err) : next(err);
        const page = enhanceHtml(html, {
          includeAssets: view !== "invoice-preview",
        });
        return done ? done(null, page) : res.send(page);
      });
    };
    next();
  });

  app.use((req, res, next) => {
    res.locals.user = req.session?.user || null;
    res.locals.path = req.path;
    next();
  });

  const guarded = [checkAccountStatus, authenticate];

  app.use("/", aliasRouter);
  app.use("/auth", authRoutes);
  app.use("/invoices", ...guarded, ownerArea, invoiceRoutes);
  app.use("/members", ...guarded, ownerArea, memberRoutes);
  app.use("/auto-invoices", ...guarded, ownerArea, autoInvoiceRoutes);
  app.use("/reports", ...guarded, ownerArea, reportRoutes);
  app.use("/announcements", ...guarded, ownerArea, announcementRoutes);
  app.use("/gym", ...guarded, memberOnly, gymRoutes);
  app.use("/settings/branding", ...guarded, ownerArea, brandingRoutes);
  app.use("/me", ...guarded, memberOnly, meRouter);
  app.use("/notifications", ...guarded, notificationRouter);
  app.use("/account", ...guarded, accountRouter);
  app.use("/", pageRoutes);
  app.use("/admin", checkAccountStatus, adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, sessionMiddleware };
};
