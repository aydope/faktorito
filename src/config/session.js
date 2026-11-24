import session from "express-session";
import { MongoStore } from "connect-mongo";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_MAX_AGE = 3 * 24 * 60 * 60 * 1000;

const configureSession = ({ store } = {}) => {
  return session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: "faktorito.sid",
    store:
      store ||
      MongoStore.create({
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

export default configureSession;
