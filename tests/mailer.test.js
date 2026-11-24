import test from "node:test";
import assert from "node:assert/strict";
import * as mailer from "../src/services/mailer.js";
import {
  mailConfig,
  isMailConfigured,
  fromAddress,
  sendOtpMail,
  assertMailCapacity,
} from "../src/services/mailer.js";
import {
  createQuota,
  dayKey,
  DAILY_MAIL_LIMIT,
  MAIL_FULL_MESSAGE,
} from "../src/services/dailyQuota.js";
import DailyQuota from "../src/models/DailyQuota.js";
import validateEnv from "../src/config/validateEnv.js";
import * as templates from "../src/emails/templates.js";

// ------------------------------------------------------------- Gmail transport
test("Gmail transport: service gmail with user and password", () => {
  const c = mailConfig({
    GMAIL_USER: "club@gmail.com",
    GMAIL_PASSWORD: "secret",
  });
  assert.equal(c.service, "gmail");
  assert.deepEqual(c.auth, { user: "club@gmail.com", pass: "secret" });
  assert.equal(c.pool, true);
});

test("the app password may be pasted with Google's spaces", () => {
  assert.equal(
    mailConfig({
      GMAIL_USER: "a@gmail.com",
      GMAIL_PASSWORD: "abcd efgh ijkl mnop",
    }).auth.pass,
    "abcdefghijklmnop",
  );
  assert.equal(
    mailConfig({ GMAIL_USER: "  a@gmail.com ", GMAIL_PASSWORD: "x" }).auth.user,
    "a@gmail.com",
  );
});

test("no credentials (or only one of them) means not configured", () => {
  assert.equal(mailConfig({}), null);
  assert.equal(mailConfig({ GMAIL_USER: "a@gmail.com" }), null);
  assert.equal(mailConfig({ GMAIL_PASSWORD: "x" }), null);
  assert.equal(isMailConfigured({}), false);
  assert.equal(
    isMailConfigured({ GMAIL_USER: "a@gmail.com", GMAIL_PASSWORD: "x" }),
    true,
  );
});

test("From is the Gmail address with our display name; the name can't inject headers", () => {
  assert.equal(
    fromAddress({ GMAIL_USER: "club@gmail.com" }),
    '"فاکتوریتو" <club@gmail.com>',
  );
  const from = fromAddress({
    GMAIL_USER: "club@gmail.com",
    MAIL_FROM_NAME: 'Evil"\r\nBcc: x@y.z',
  });
  assert.ok(!/[\r\n]/.test(from));
  assert.ok(!from.includes('Evil"'));
});

test("production refuses to start without Gmail credentials (and starts with them)", () => {
  const keep = { ...process.env };
  const realExit = process.exit;
  const realErr = console.error;
  const run = (env) => {
    for (const k of ["GMAIL_USER", "GMAIL_PASSWORD"]) delete process.env[k];
    Object.assign(
      process.env,
      {
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://x/y",
        SESSION_SECRET: "s".repeat(48),
      },
      env,
    );
    let exited = null;
    let message = "";
    process.exit = (code) => {
      exited = code;
    };
    console.error = (m) => {
      message += m;
    };
    validateEnv();
    return { exited, message };
  };
  try {
    const missing = run({});
    assert.equal(missing.exited, 1);
    assert.match(missing.message, /GMAIL_USER/);
    assert.equal(
      run({ GMAIL_USER: "a@gmail.com", GMAIL_PASSWORD: "x" }).exited,
      null,
    );
  } finally {
    process.exit = realExit;
    console.error = realErr;
    for (const k of Object.keys(process.env))
      if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});

const memoryStore = () => {
  const days = new Map();
  return {
    days,
    async tryIncrement(day, limit) {
      const n = days.get(day) || 0;
      if (n >= limit) return null;
      days.set(day, n + 1);
      return n + 1;
    },
    async decrement(day) {
      const n = days.get(day) || 0;
      if (n > 0) days.set(day, n - 1);
    },
    async used(day) {
      return days.get(day) || 0;
    },
  };
};

// ------------------------------------------------------------ OTP mail only
test("the mailer exposes NO generic send function: only one-time-code mail exists", () => {
  assert.equal(typeof mailer.sendOtpMail, "function");
  for (const name of ["sendMail", "sendMailSafe"])
    assert.equal(mailer[name], undefined, `${name} must not exist`);
  assert.deepEqual(
    Object.keys(templates)
      .filter((k) => k.endsWith("Email"))
      .sort(),
    ["otpEmail"],
  );
});

const withEnv = async (env, fn) => {
  const keep = { ...process.env };
  for (const k of ["GMAIL_USER", "GMAIL_PASSWORD"]) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(process.env))
      if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
};
const otp = {
  to: "a@b.c",
  purpose: "verify",
  code: "123456",
  minutes: 10,
  username: "ali",
};

test("development without credentials: prints the code, never throws, never touches the budget", async () => {
  const calls = [];
  const quota = {
    reserve: async () => {
      calls.push("reserve");
      return { day: "d", count: 1 };
    },
    release: async () => {},
    assertAvailable: async () => {
      calls.push("check");
    },
  };
  const log = console.log;
  let printed = "";
  console.log = (m) => {
    printed += m;
  };
  try {
    await withEnv({ NODE_ENV: "test" }, async () => {
      await sendOtpMail(otp, { quota });
      await assertMailCapacity(quota);
    });
  } finally {
    console.log = log;
  }
  assert.deepEqual(calls, []);
  assert.match(printed, /123456/);
});

test("production without credentials: 503 and nothing is sent", async () => {
  await withEnv({ NODE_ENV: "production" }, async () => {
    await assert.rejects(
      () => sendOtpMail(otp),
      (e) => e.statusCode === 503,
    );
  });
});

test("budget used up: the OTP mail is refused with a clear 429 and nothing is sent", async () => {
  const quota = createQuota({
    kind: "mail",
    limit: 0,
    message: MAIL_FULL_MESSAGE,
    store: memoryStore(),
  });
  await withEnv(
    { NODE_ENV: "test", GMAIL_USER: "a@gmail.com", GMAIL_PASSWORD: "x" },
    async () => {
      await assert.rejects(
        () => sendOtpMail(otp, { quota }),
        (e) =>
          e.statusCode === 429 &&
          e.message === MAIL_FULL_MESSAGE &&
          e.retryAfter > 0 &&
          e.retryAfter <= 86400,
      );
    },
  );
});

// ------------------------------------------------------ the shared daily budget

test("the daily budget is exactly 25 + 1 for the whole service", async () => {
  assert.equal(DAILY_MAIL_LIMIT, 25 + 1);
  const quota = createQuota({
    kind: "mail",
    limit: DAILY_MAIL_LIMIT,
    message: MAIL_FULL_MESSAGE,
    store: memoryStore(),
    now: () => new Date("2026-10-12T10:00:00Z"),
  });
  const slots = await Promise.all(
    Array.from({ length: 200 }, () => quota.reserve()),
  );
  assert.equal(slots.filter(Boolean).length, 25 + 1);
  assert.equal(slots.filter((s) => s === null).length, 50);
  assert.deepEqual(await quota.status(), {
    used: 25 + 1,
    limit: 25 + 1,
    remaining: 0,
  });
  await assert.rejects(
    () => quota.assertAvailable(),
    (e) => e.statusCode === 429,
  );
});

test("a mail that failed to send gives its slot back", async () => {
  const quota = createQuota({
    kind: "mail",
    message: "m",
    store: memoryStore(),
    limit: 2,
  });
  const a = await quota.reserve();
  await quota.reserve();
  assert.equal(await quota.reserve(), null);
  await quota.release(a);
  assert.ok(await quota.reserve());
  assert.equal((await quota.status()).used, 2);
});

test("a new calendar day starts with a fresh budget", async () => {
  let t = new Date("2026-10-12T10:00:00Z");
  const quota = createQuota({
    kind: "mail",
    message: "m",
    store: memoryStore(),
    limit: 1,
    now: () => t,
  });
  assert.ok(await quota.reserve());
  assert.equal(await quota.reserve(), null);
  t = new Date("2026-10-13T10:00:00Z");
  assert.ok(await quota.reserve());
});

test("day keys follow the configured timezone (Tehran is ahead of UTC)", () => {
  assert.equal(dayKey(new Date("2026-10-12T21:00:00Z"), "UTC"), "2026-10-12");
  assert.equal(
    dayKey(new Date("2026-10-12T21:00:00Z"), "Asia/Tehran"),
    "2026-10-13",
  );
});

test("the quota document: one per (kind, day) and it cleans itself up (TTL)", () => {
  const idx = DailyQuota.schema.indexes();
  assert.ok(
    idx.some(([k, o]) => k.kind === 1 && k.day === 1 && o.unique),
    "(kind, day) must be unique",
  );
  assert.ok(
    idx.some(([k, o]) => k.expireAt === 1 && o.expireAfterSeconds === 0),
    "TTL index on expireAt",
  );
});

test("no other part of the app sends mail: only the mailer imports nodemailer", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (d) =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
    });
  const users = walk("src")
    .concat(["app.js"])
    .filter((f) => /from\s+["']nodemailer["']/.test(readFileSync(f, "utf8")));
  assert.deepEqual(
    users.map((f) => f.replaceAll("\\", "/")),
    ["src/services/mailer.js"],
  );
});
