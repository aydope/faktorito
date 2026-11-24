import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import express from "express";
import session from "express-session";
import mongoose from "mongoose";

import User from "../src/models/User.js";
import DailyQuota from "../src/models/DailyQuota.js";
import authRoutes from "../src/routes/auth.js";
import errorHandler from "../src/middleware/errorHandler.js";
import { DAILY_SIGNUP_LIMIT, SIGNUP_FULL_MESSAGE, dayKey, secondsUntilTomorrow, createQuota } from "../src/services/dailyQuota.js";

/**
 * The REAL register route and the REAL quota rules over HTTP. Only the database calls are replaced
 * by a small in-memory fake that keeps MongoDB's semantics for the one atomic statement that matters.
 */
mongoose.set("bufferCommands", false); // anything not faked fails at once instead of waiting for a connection
process.env.SESSION_SECRET ||= "s".repeat(48);

// ---- fake collection for DailyQuota (findOneAndUpdate with upsert + unique(kind, day), updateOne, findOne)
const quotaDocs = new Map();
DailyQuota.findOneAndUpdate = async (filter, update, opts) => {
  const key = `${filter.kind}|${filter.day}`;
  const doc = quotaDocs.get(key);
  if (doc && !(doc.count < filter.count.$lt)) { // the filter does not match
    const err = new Error("E11000 duplicate key"); err.code = 11000; throw err; // ...so the upsert tries a second insert
  }
  const next = doc || { kind: filter.kind, day: filter.day, count: 0 };
  next.count += update.$inc.count;
  quotaDocs.set(key, next);
  return { count: next.count };
};
DailyQuota.updateOne = async (filter, update) => {
  const doc = quotaDocs.get(`${filter.kind}|${filter.day}`);
  if (doc && doc.count > 0) doc.count += update.$inc.count;
};
DailyQuota.findOne = (filter) => ({ select: () => ({ lean: async () => quotaDocs.get(`${filter.kind}|${filter.day}`) || null }) });

// ---- fake users
const users = new Map();
let failCreateOnce = false;
User.findOne = (q) => ({
  select: () => ({
    lean: async () => {
      const wanted = q.$or || [];
      return [...users.values()].find((u) => wanted.some((w) => (w.email && w.email === u.email) || (w.username && w.username === u.username))) || null;
    },
  }),
});
User.create = async (doc) => {
  if (failCreateOnce) { failCreateOnce = false; throw new Error("database exploded"); }
  const user = { ...doc, _id: String(users.size + 1).padStart(24, "0") };
  users.set(user._id, user);
  return user;
};

const app = express();
app.set("view engine", "ejs");
app.set("views", path.resolve("views"));
app.use(express.json());
app.use(session({ secret: "x".repeat(32), resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
app.use("/auth", authRoutes);
app.use(errorHandler);
const server = http.createServer(app);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.closeAllConnections?.(); server.close(); });

const silence = () => { const e = console.error, l = console.log; console.error = () => {}; console.log = () => {}; return () => { console.error = e; console.log = l; }; };
const register = (n, extra = {}) =>
  fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username: `user_${n}`, email: `user${n}@example.com`, password: "Abcdef1!x", confirmPassword: "Abcdef1!x", acceptTerms: true, ...extra }),
  });
const used = () => quotaDocs.get(`signup|${dayKey()}`)?.count || 0;

test("the daily sign-up limit is 25, for the whole service", () => {
  assert.equal(DAILY_SIGNUP_LIMIT, 25);
  assert.match(SIGNUP_FULL_MESSAGE, /25/);
  assert.ok(!/[\u06f0-\u06f9]/.test(SIGNUP_FULL_MESSAGE), "Latin digits only");
});

test("25 people can register today, the 26th is told to come back tomorrow", async () => {
  const done = silence();
  try {
    for (let n = 1; n <= 25; n++) {
      const res = await register(n);
      assert.equal(res.status, 201, `registration ${n} should work`);
    }
    assert.equal(used(), 25);

    const res = await register(26);
    const body = await res.json();
    assert.equal(res.status, 429);
    assert.equal(body.success, false);
    assert.equal(body.message, SIGNUP_FULL_MESSAGE);
    assert.ok(Number(res.headers.get("retry-after")) > 0 && Number(res.headers.get("retry-after")) <= 86400, "Retry-After says when to try again");
    assert.equal(users.size, 25, "no 26th account exists");
    assert.equal(used(), 25, "a refused attempt does not change the counter");
  } finally { done(); }
});

test("the register PAGE says it is full (and disables the button) before anyone types", async () => {
  const html = await (await fetch(`${base}/auth/register`)).text();
  assert.ok(html.includes(SIGNUP_FULL_MESSAGE));
  assert.match(html, /id="submitBtn"[^>]*disabled/);
});

test("a day later the counter starts again", async () => {
  quotaDocs.clear();
  const html = await (await fetch(`${base}/auth/register`)).text();
  assert.ok(!html.includes(SIGNUP_FULL_MESSAGE));
  assert.ok(!/id="submitBtn"[^>]*disabled/.test(html));
});

test("a duplicate e-mail or username is refused WITHOUT using a slot", async () => {
  quotaDocs.clear(); users.clear();
  const done = silence();
  try {
    assert.equal((await register(1)).status, 201);
    assert.equal(used(), 1);
    const dupMail = await register(2, { email: "user1@example.com" });
    const dupName = await register(3, { username: "user_1" });
    assert.equal(dupMail.status, 409);
    assert.equal(dupName.status, 409);
    assert.equal(used(), 1, "duplicates never spend the budget");
  } finally { done(); }
});

test("if the account can't be created, the slot is given back", async () => {
  quotaDocs.clear(); users.clear();
  const done = silence();
  try {
    failCreateOnce = true;
    const res = await register(1);
    assert.equal(res.status, 500);
    assert.equal(used(), 0, "the failed attempt did not eat a slot");
    assert.equal((await register(1)).status, 201);
    assert.equal(used(), 1);
  } finally { done(); }
});

test("invalid input is rejected before the budget is touched", async () => {
  quotaDocs.clear(); users.clear();
  const res = await register(1, { password: "short", confirmPassword: "short" });
  assert.equal(res.status, 400);
  assert.equal(used(), 0);
});

test("concurrent registrations can never exceed 25", async () => {
  quotaDocs.clear(); users.clear();
  const done = silence();
  try {
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => register(i + 100)));
    const codes = results.map((r) => r.status);
    assert.equal(codes.filter((c) => c === 201).length, 25);
    assert.equal(codes.filter((c) => c === 429).length, 15);
    assert.equal(users.size, 25);
  } finally { done(); }
});

test("Retry-After counts down to midnight in the quota timezone", () => {
  assert.equal(secondsUntilTomorrow(new Date("2026-10-12T20:30:00Z"), "UTC"), 3.5 * 3600);
  assert.equal(secondsUntilTomorrow(new Date("2026-10-12T00:00:00Z"), "UTC"), 86400);
  const q = createQuota({ kind: "signup", limit: 1, message: "full", store: { tryIncrement: async () => null, decrement: async () => {}, used: async () => 1 } });
  assert.equal(q.fullError().statusCode, 429);
});
