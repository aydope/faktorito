import nodemailer from "nodemailer";
import AppError from "../utils/AppError.js";
import { otpEmail } from "../emails/templates.js";
import { mailQuota, DAILY_MAIL_LIMIT } from "./dailyQuota.js";

/**
 * Mail goes out through Gmail: GMAIL_USER (the address) and GMAIL_PASSWORD.
 * IMPORTANT: GMAIL_PASSWORD must be a Google *App Password* (Google account ->
 * Security -> 2-Step Verification -> App passwords), not the normal login
 * password - Google rejects that one for SMTP. Google shows the app password
 * in groups of four ("abcd efgh ijkl mnop"); the spaces are removed here.
 *
 * Without credentials, mails are printed to the console (development only).
 * Only one-time-code mails exist, and the whole service shares a budget of
 * 25 + 1 mails per day (dailyQuota.js).
 */

/** Transport options for Gmail, or null when credentials are missing. Pure, so it can be tested. */
export const mailConfig = (env = process.env) => {
  const user = (env.GMAIL_USER || "").trim();
  const pass = (env.GMAIL_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass) return null;
  return {
    service: "gmail",
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  };
};

export const isMailConfigured = (env = process.env) => !!mailConfig(env);

/** Gmail always sends from the logged-in address; only the display name is ours. */
export const fromAddress = (env = process.env) => {
  const name =
    (env.MAIL_FROM_NAME || "فاکتوریتو").replace(/["<>\r\n]/g, "").trim() ||
    "فاکتوریتو";
  return `"${name}" <${(env.GMAIL_USER || "no-reply@faktorito.local").trim()}>`;
};

let transport = null;

const getTransport = () => {
  if (transport) return transport;
  const config = mailConfig();
  if (config) {
    transport = nodemailer.createTransport(config);
  } else {
    // development fallback: nothing is sent, the message is printed instead
    transport = nodemailer.createTransport({ jsonTransport: true });
  }
  return transport;
};

/**
 * The ONLY mail this service sends: one-time codes (sign-up, login, password
 * reset, e-mail change). There is deliberately no generic "send a mail"
 * function, so invoices, reminders or notices cannot go out by e-mail.
 *
 * Every real send takes one slot of the shared daily budget (see dailyQuota.js:
 * 25 + 1 mails per day for the whole service). A failed send gives the slot back.
 */
export const sendOtpMail = async (
  { to, purpose, code, minutes, username },
  { quota = mailQuota } = {},
) => {
  const configured = isMailConfigured();
  if (!configured && process.env.NODE_ENV === "production") {
    throw new AppError("سرویس ایمیل پیکربندی نشده است", 503, false);
  }

  const mail = otpEmail({ purpose, code, minutes, username });

  // development without credentials: print, don't send, don't use the budget
  if (!configured) {
    await getTransport().sendMail({ from: fromAddress(), to, ...mail });
    console.log(
      `\n[mail:dev] to=${to}\n[mail:dev] subject=${mail.subject}\n${mail.text}\n`,
    );
    return;
  }

  const slot = await quota.reserve();
  if (!slot) throw quota.fullError();

  try {
    await getTransport().sendMail({ from: fromAddress(), to, ...mail });
  } catch (err) {
    await quota.release(slot).catch(() => {});
    // the real reason goes to the server log only; the visitor gets a safe message
    if (err?.code === "EAUTH") {
      console.error(
        "Gmail login failed: GMAIL_PASSWORD must be an App Password (2-Step Verification on), and GMAIL_USER the full address.",
      );
    } else {
      console.error("Mail error:", err?.code || "", err?.message);
    }
    throw new AppError(
      "ارسال ایمیل ناموفق بود؛ کمی بعد دوباره تلاش کنید",
      503,
      true,
    );
  }

  if (slot.count >= DAILY_MAIL_LIMIT - 10) {
    console.warn(`Mail budget: ${slot.count}/${DAILY_MAIL_LIMIT} used today`);
  }
};

/** Throws a clean 503 when today's budget is gone (called BEFORE a code is created). Does nothing in console-only dev mode. */
export const assertMailCapacity = async (quota = mailQuota) => {
  if (!isMailConfigured()) return;
  await quota.assertAvailable();
};

/** Boot-time check so a wrong password shows up in the log right away, not at the first signup. Never throws. */
export const verifyMailer = async () => {
  if (!isMailConfigured()) {
    console.log(
      "Mail: no GMAIL_USER / GMAIL_PASSWORD set, e-mails are printed to the console",
    );
    return false;
  }
  try {
    await getTransport().verify();
    const q = await mailQuota.status().catch(() => null);
    console.log(
      `Mail: Gmail login OK (${process.env.GMAIL_USER})${q ? `, budget today ${q.used}/${q.limit}` : ""}`,
    );
    return true;
  } catch (err) {
    console.error(
      `Mail: Gmail login FAILED (${err?.code || err?.message}). Use a Google App Password in GMAIL_PASSWORD.`,
    );
    return false;
  }
};

export const closeMailer = () => {
  if (transport?.close) transport.close();
};
