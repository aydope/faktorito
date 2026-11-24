import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import session from "express-session";
import path from "node:path";

import { frozenDays, statusTransition, MAX_FREEZE_DAYS } from "../src/services/freezeService.js";
import { fillDays } from "../src/services/reportService.js";
import { USAGE_COUNTERS } from "../src/services/limitsService.js";
import { LIMITS, LIMIT_LABELS } from "../src/config/limits.js";
import { THEME_KEYS } from "../src/utils/invoiceSheet.js";
import { calculateTotals } from "../src/utils/helpers.js";
import errorHandler, { normalizeError } from "../src/middleware/errorHandler.js";
import AppError from "../src/utils/AppError.js";
import User from "../src/models/User.js";
import Member from "../src/models/Member.js";
import Invoice from "../src/models/Invoice.js";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-06-30T12:00:00Z");

// ------------------------------------------------------- gym only, no leftovers
test("the app is gym-only: no cafe theme, type, loyalty or counter-sale fields", () => {
  assert.ok(!THEME_KEYS.includes("cafe"));
  assert.ok(!User.schema.path("invoiceTheme").enumValues.includes("cafe"));
  assert.equal(User.schema.path("businessType"), undefined);
  assert.equal(Member.schema.path("loyaltyStamps"), undefined);
  assert.equal(Invoice.schema.path("isPos"), undefined);
  assert.deepEqual(Invoice.schema.path("extraItems").schema.path("type").enumValues, ["item", "discount"]);
});

test("extra items on an invoice are generic 'item's", () => {
  const t = calculateTotals(100, [{ name: "آب", price: 5 }], [{ type: "percent", value: 10, description: "تخفیف" }]);
  assert.equal(t.extraItems[0].type, "item");
  assert.equal(t.extraItems[1].type, "discount");
  assert.equal(t.itemsTotal, 5);
  assert.equal(t.totalAmount, 105 - Math.floor((105 * 10) / 100));
});

// ----------------------------- regression: the settings page crashed on a limit with no counter
test("every limit has a usage counter and a label (settings page crash)", () => {
  for (const key of Object.keys(LIMITS)) {
    assert.equal(typeof USAGE_COUNTERS[key], "function", `no usage counter for limit "${key}"`);
    assert.ok(LIMIT_LABELS[key], `no label for limit "${key}"`);
  }
  for (const key of Object.keys(USAGE_COUNTERS)) assert.ok(key in LIMITS, `counter "${key}" has no limit`);
});

// ------------------------------------------------------------------ freezing
test("frozen days are counted per started day and capped", () => {
  assert.equal(frozenDays(null, now), 0);
  assert.equal(frozenDays(new Date(now.getTime() - 10 * DAY), now), 10);
  assert.equal(frozenDays(new Date(now.getTime() - 3 * 3600 * 1000), now), 1);
  assert.equal(frozenDays(new Date(now.getTime() + DAY), now), 0);
  assert.equal(frozenDays(new Date(now.getTime() - 900 * DAY), now), MAX_FREEZE_DAYS);
});

test("freezing starts a clock; unfreezing adds the frozen days to the expiry", () => {
  const expiry = new Date("2026-07-15T00:00:00Z");
  assert.deepEqual(statusTransition({ status: "active" }, "frozen", now), { frozenAt: now });
  const back = statusTransition({ status: "frozen", frozenAt: new Date(now.getTime() - 10 * DAY), membershipExpiresAt: expiry }, "active", now);
  assert.equal(back.frozenAt, null);
  assert.equal(back.membershipExpiresAt.getTime(), expiry.getTime() + 10 * DAY);
});

test("other status changes do nothing special", () => {
  assert.deepEqual(statusTransition({ status: "active" }, "inactive", now), {});
  assert.deepEqual(statusTransition({ status: "active" }, "active", now), {});
  assert.deepEqual(statusTransition({ status: "active" }, undefined, now), {});
  assert.deepEqual(statusTransition({ status: "frozen", frozenAt: new Date(now.getTime() - 5 * DAY) }, "inactive", now), { frozenAt: null });
});

test("report series covers every day, oldest first, zero-filled", () => {
  const series = fillDays([{ _id: "2026-06-30", revenue: 500, count: 2 }], 7, new Date("2026-06-30T10:00:00Z"));
  assert.equal(series.length, 7);
  assert.equal(series[6].revenue, 500);
  assert.equal(series[0].revenue, 0);
  assert.ok(series[0].day < series[6].day);
});

// ------------------------------------------------------------- error handling
test("normalizeError never exposes the original message of unexpected errors", () => {
  const ejsLike = new TypeError("G:\\New folder (5)\\views\\settings.ejs:477 Cannot read properties of undefined");
  const info = normalizeError(ejsLike);
  assert.equal(info.statusCode, 500);
  assert.ok(!info.message.includes("settings.ejs") && !info.message.includes("G:"));
  assert.equal(info.operational, false);

  // a developer-written message on a NON-operational AppError is not shown either
  assert.ok(!normalizeError(new AppError("password for db is hunter2", 500, false)).message.includes("hunter2"));
  // an expected (operational) error keeps its own, user-facing message
  assert.equal(normalizeError(AppError.badRequest("نام الزامی است")).message, "نام الزامی است");
});

test("normalizeError maps common failures to safe statuses", () => {
  assert.equal(normalizeError({ type: "entity.too.large", statusCode: 413 }).statusCode, 413);
  assert.equal(normalizeError({ type: "entity.parse.failed", statusCode: 400, message: "Unexpected token } in JSON at position 5" }).message.includes("JSON"), false);
  assert.equal(normalizeError({ name: "MongooseServerSelectionError", message: "connect ECONNREFUSED 10.0.0.5:27017" }).statusCode, 503);
  assert.equal(normalizeError({ name: "CastError", path: "_id" }).statusCode, 400);
  const dup = normalizeError({ code: 11000, keyPattern: { email: 1 }, keyValue: { email: "a@b.c" } });
  assert.equal(dup.statusCode, 409);
  assert.ok(!dup.message.includes("a@b.c"));
});

// a tiny app with the REAL error handler and the REAL error page
const makeApp = (boom) => {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.resolve("views"));
  app.use(express.json());
  app.use(session({ secret: "x".repeat(32), resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
  app.get("/boom", () => { throw boom; });
  app.post("/boom", () => { throw boom; });
  app.get("/fine", (req, res) => res.send("ok"));
  app.use(errorHandler);
  return app;
};
const withServer = async (app, fn) => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
};
const SECRET = "G:\\New folder (5)\\views\\settings.ejs:477 TypeError: Cannot read properties of undefined (reading 'toLocaleString')";

test("error PAGE: only a status code, a safe message and a tracking code - no stack, no paths", async () => {
  const silence = console.error; console.error = () => {};
  try {
    await withServer(makeApp(new TypeError(SECRET)), async (base) => {
      const res = await fetch(`${base}/boom`, { headers: { Accept: "text/html" } });
      const html = await res.text();
      assert.equal(res.status, 500);
      assert.ok(html.includes("مشکلی از سمت ما پیش آمد"));
      assert.match(html, /کد پیگیری/);
      for (const leak of ["settings.ejs", "G:\\", "toLocaleString", "TypeError", "at eval", "node_modules", "<pre"]) {
        assert.ok(!html.includes(leak), `error page leaked: ${leak}`);
      }
    });
  } finally { console.error = silence; }
});

test("error JSON: same rules, plus a tracking id", async () => {
  const silence = console.error; console.error = () => {};
  try {
    await withServer(makeApp(new TypeError(SECRET)), async (base) => {
      const res = await fetch(`${base}/boom`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.equal(body.success, false);
      assert.match(body.errorId, /^[0-9A-F]{8}$/);
      assert.ok(!("stack" in body));
      assert.ok(!JSON.stringify(body).includes("settings.ejs"));
    });
  } finally { console.error = silence; }
});

test("the full details go to the server log under the same tracking id", async () => {
  const logged = [];
  const silence = console.error; console.error = (...a) => logged.push(a.join(" "));
  try {
    await withServer(makeApp(new TypeError(SECRET)), async (base) => {
      const res = await fetch(`${base}/boom`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const { errorId } = await res.json();
      assert.ok(logged.some((l) => l.includes(errorId) && l.includes("settings.ejs")));
    });
  } finally { console.error = silence; }
});

test("expected errors are shown without a stack or tracking id; bad JSON is a clean 400", async () => {
  await withServer(makeApp(AppError.forbidden()), async (base) => {
    const res = await fetch(`${base}/boom`, { headers: { Accept: "text/html" } });
    const html = await res.text();
    assert.equal(res.status, 403);
    assert.ok(!html.includes("کد پیگیری"));
  });
  await withServer(makeApp(new Error("unused")), async (base) => {
    const res = await fetch(`${base}/boom`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{ not json" });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.ok(!JSON.stringify(body).includes("Unexpected token"));
  });
});
