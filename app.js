require("dotenv").config();

const express = require("express");
const path = require("path");
const methodOverride = require("method-override");
const cookieParser = require("cookie-parser");

const authRoutes = require("./src/routes/auth");
const invoiceRoutes = require("./src/routes/invoices");
const pageRoutes = require("./src/routes/pages");
const adminRoutes = require("./src/routes/admin");

const errorHandler = require("./src/middleware/errorHandler");
const notFoundHandler = require("./src/middleware/notFound");
const requestLogger = require("./src/middleware/requestLogger");
const db = require("./src/config/database");
const configureSecurity = require("./src/config/security");
const configureSession = require("./src/config/session");
const setupGracefulShutdown = require("./src/utils/gracefulShutdown");
const checkAccountStatus = require("./src/middleware/checkAccountStatus");

const app = express();

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

configureSecurity(app);

app.use(configureSession());
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());
app.use(methodOverride("_method"));
app.use(requestLogger);

app.use(
  express.static(path.join(__dirname, "public"), {
    index: false,
    maxAge: IS_PRODUCTION ? "1d" : 0,
    etag: true,
  }),
);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);
app.set("query parser", "extended");

app.use((req, res, next) => {
  res.locals.user = req.session?.user || null;
  res.locals.path = req.path;
  next();
});

app.use("/auth", authRoutes);
app.use("/invoices", checkAccountStatus, invoiceRoutes);
app.use("/", pageRoutes);
app.use("/admin", checkAccountStatus, adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const startServer = async (PORT) => {
  try {
    await db.connect();
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server is running on http://localhost:${PORT}`);
      console.log(`Environment: ${NODE_ENV || "development"}`);
    });
    return server;
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

(async () => {
  const PORT = process.env.PORT || 3001;
  let server = await startServer(PORT);

  setupGracefulShutdown(server, {
    timeout: 15000,
    exitOnUnhandled: true,
  });
})();
