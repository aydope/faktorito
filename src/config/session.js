const session = require("express-session");
const { MongoStore } = require("connect-mongo");

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

const configureSession = () => {
  return session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: "faktorito.sid",
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      ttl: SESSION_MAX_AGE / 1000,
      autoRemove: "native",
      touchAfter: 24 * 3600, // Lazy update
    }),
    cookie: {
      maxAge: SESSION_MAX_AGE,
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
    },
  });
};

module.exports = configureSession;
