const session = require("express-session");
const { MongoStore } = require("connect-mongo");

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_MAX_AGE = 3 * 24 * 60 * 1000;

const configureSession = () => {
  return session({
    secret: process.env.SESSION_SECRET,
    resave: true,
    saveUninitialized: false,
    name: "faktorito.sid",
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      ttl: SESSION_MAX_AGE / 1000 + 60,
      autoRemove: "native",
      touchAfter: 3600,
    }),
    cookie: {
      maxAge: SESSION_MAX_AGE,
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
    },
    rolling: true,
  });
};

module.exports = configureSession;
