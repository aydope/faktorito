import test from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { emitLive } from "../src/realtime/socket.js";
import { parseReadIds } from "../src/routes/panel.js";
import errorHandler, { stripStackBlocks } from "../src/middleware/errorHandler.js";
import AppError from "../src/utils/AppError.js";

const dir = path.resolve("views");
const render = (view, locals) => ejs.renderFile(path.join(dir, `${view}.ejs`), locals, { views: [dir] });
const walk = (d, ext) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : []; });
const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");

// ---------------------------------------------------------------- live fan-out
test("emitLive: one 'live' message per distinct user, with the topics", () => {
  const sent = [];
  const n = emitLive(["u1", "u2", "u1", null, undefined], ["invoices", "members"], (id, event, payload) => sent.push({ id, event, payload }));
  assert.equal(n, 2);
  assert.deepEqual(sent.map((s) => s.id).sort(), ["u1", "u2"]);
  assert.ok(sent.every((s) => s.event === "live" && s.payload.topics.join() === "invoices,members" && typeof s.payload.at === "number"));
  assert.equal(emitLive(null, "x", () => assert.fail("nobody to tell")), 0);
});

test("read receipts: ids are validated (1-50 object ids), no ids means 'all'", () => {
  assert.equal(parseReadIds({}), null);
  assert.deepEqual(parseReadIds({ ids: ["a".repeat(24), "a".repeat(24), "b".repeat(24)] }), ["a".repeat(24), "b".repeat(24)]);
  for (const bad of [[], "x", ["nope"], [{ $ne: 1 }], Array.from({ length: 51 }, () => "a".repeat(24))]) {
    assert.throws(() => parseReadIds({ ids: bad }), AppError);
  }
});

// ------------------------------------------------------------- the error page
test("no template can print a stack: the views never mention one", () => {
  for (const f of walk("views", ".ejs")) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/<pre[^>]*stack/i.test(src) && !/<%[=-]\s*stack/.test(src), `${f} prints a stack`);
  }
});

test("stripStackBlocks removes a stack <pre> and nothing else", () => {
  const html = `<p>ok</p><pre class="stack">Error: x\n at y</pre><pre>keep</pre><PRE id="a" class='big stack'>z</PRE>`;
  assert.equal(stripStackBlocks(html), "<p>ok</p><pre>keep</pre>");
});

test("even an OLD error view that prints a stack can't leak it through the real handler", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "views-"));
  fs.writeFileSync(path.join(tmp, "error.ejs"), `<h1><%= statusCode %> <%= message %></h1><% if (stack) { %><pre class="stack"><%= stack %></pre><% } %>`);
  fs.writeFileSync(path.join(tmp, "404.ejs"), `<%- include('error') %>`);
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", tmp);
  app.get("/boom", () => { throw new Error("Error: لطفا ابتدا وارد شوید at C:\\secret\\file.js:1"); });
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const silence = console.error; console.error = () => {};
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/boom`, { headers: { Accept: "text/html" } });
    const html = await res.text();
    assert.equal(res.status, 500);
    assert.ok(!html.includes("stack") && !html.includes("secret") && !html.includes("at C:"), html);
  } finally { console.error = silence; server.close(); }
});

test("the error page is responsive: viewport, scrolls when short, no horizontal overflow, phone layout", () => {
  const src = readFileSync("views/error.ejs", "utf8");
  assert.match(src, /<meta name="viewport"[^>]*width=device-width/);
  assert.ok(!/body\s*\{[^}]*overflow:\s*hidden/.test(src), "body must be able to scroll on short screens");
  assert.match(src, /min-height:\s*100dvh/);
  assert.match(src, /overflow-x:\s*clip/);
  assert.match(src, /@media \(max-width: 480px\)/);
  assert.match(src, /clamp\(/);
});

// -------------------------------------------------- the bell is the same everywhere
test("the bell is self-contained: it no longer depends on a page's own .action-btn styles", async () => {
  const html = await render("partials/shell", { user: { id: "1", username: "ali", role: "owner", clubName: "باشگاه" }, path: "/", active: "x", title: "t" });
  assert.match(html, /id="notifBtn" class="bell-btn"/);
  assert.match(html, /id="liveDot"/);
  assert.match(html, /\.bell-btn\s*\{/);
  assert.match(html, /\.notif-panel\s*\{/);
  assert.match(html, /\.link-btn\s*\{/, "the 'read all' button style travels with the shell");
  assert.ok(!/id="notifBtn"[^>]*action-btn/.test(html));
});

test("pages that bring their own <head> (profile & co.) still get a working bell", () => {
  const own = walk("views", ".ejs").filter((f) => { const s = readFileSync(f, "utf8"); return s.includes("partials/shell") && !s.includes("partials/head"); });
  assert.ok(own.length >= 1, "there are such pages");
  const shell = readFileSync("views/partials/shell.ejs", "utf8");
  for (const cls of ["bell-btn", "bell-wrap", "notif-panel", "notif-item", "notif-badge", "live-dot", "link-btn"]) {
    assert.ok(shell.includes(`.${cls}`), `shell must define .${cls} itself`);
  }
});

// -------------------------------------------------------------- invoice fonts
test("invoice fonts: every face falls back to Sahel per glyph (no stray system serif/mono for Persian)", () => {
  const css = readFileSync("views/partials/invoice-sheet-css.ejs", "utf8");
  const decls = [...css.matchAll(/(--fx-[a-z]+|font-family)\s*:\s*([^;}]+)/g)].filter(([, k]) => k === "font-family" || k.startsWith("--fx-")).map(([, k, v]) => [k, v.trim()]);
  for (const [k, v] of decls) {
    if (/^var\(/.test(v) || /bootstrap-icons/.test(v)) continue; // icons are a glyph font, not text
    assert.match(v, /Sahel/, `${k}: ${v} has no Sahel fallback`);
    // a generic family before Sahel would win with its own Arabic fallback
    const generic = v.search(/(^|,)\s*(serif|sans-serif|monospace|system-ui)\b/);
    if (generic !== -1) assert.ok(v.indexOf("Sahel") < generic, `${k}: Sahel must come before the generic family in ${v}`);
  }
  assert.match(css, /\.fx-sheet \*[^{]*\{\s*font-family:\s*var\(--fx-font\)\s*!important/);
  assert.ok(!/Times New Roman/.test(css), "Times New Roman has Arabic glyphs and would hijack Persian text");
});

// ------------------------------------------- subscription info on the members list
const baseLocals = { title: "t", path: "/members", active: "members", csrfToken: "", user: { id: "1", username: "ali", role: "owner", clubName: "باشگاه" } };
const mk = (over) => ({ _id: "m" + Math.random().toString(16).slice(2, 8), name: "علی رضایی", code: "M-0001", status: "active", phone: "09123456789", email: "", account: null, deletedAt: null, ...over });
const DAY = 864e5;

test("members list shows until WHEN and how much is LEFT for every state", async () => {
  const members = [
    mk({ name: "فعال", state: "active", membershipStartsAt: new Date(Date.now() - 20 * DAY), membershipExpiresAt: new Date(Date.now() + 10 * DAY), daysLeft: 10 }),
    mk({ name: "رو به پایان", state: "expiring", membershipStartsAt: new Date(Date.now() - 27 * DAY), membershipExpiresAt: new Date(Date.now() + 3 * DAY), daysLeft: 3 }),
    mk({ name: "منقضی", state: "expired", membershipStartsAt: new Date(Date.now() - 40 * DAY), membershipExpiresAt: new Date(Date.now() - 5 * DAY), daysLeft: -5 }),
    mk({ name: "منجمد", state: "frozen", status: "frozen", membershipStartsAt: new Date(Date.now() - 10 * DAY), membershipExpiresAt: new Date(Date.now() + 20 * DAY), daysLeft: 20 }),
    mk({ name: "بدون اشتراک", state: "none", membershipExpiresAt: null, membershipStartsAt: null, daysLeft: null }),
  ];
  const html = await render("members", { ...baseLocals, members, filters: { search: "", state: "" }, pagination: { totalCount: 5, currentPage: 1, totalPages: 1, hasNext: false, hasPrev: false, limit: 20 }, totalAll: 5, stats: {}, counts: {} });
  const text = visible(html);
  assert.equal((text.match(/اشتراک تا/g) || []).length, 4, "four members have an end date");
  assert.match(text, /10 روز مانده|10 روز مانده/);
  assert.match(text, /3 روز مانده|3 روز مانده/);
  assert.match(text, /5 روز از انقضا گذشته|5 روز از انقضا گذشته/);
  assert.match(text, /منجمد،/);
  assert.match(text, /اشتراک فعالی ثبت نشده/);
  assert.match(html, /data-live="members dashboard" data-live-id="members-list"/);
  assert.ok(!/NaN|undefined/.test(text));
});

test("the member page keeps showing from/until and the days left", async () => {
  const m = { _id: "m1", name: "علی", code: "M-1", status: "active", phone: "09123456789", email: "", membershipStartsAt: new Date(Date.now() - 5 * DAY), membershipExpiresAt: new Date(Date.now() + 25 * DAY), state: "active", daysLeft: 25, totalPaid: 0, createdAt: new Date(), lastPlanName: "ماهانه" };
  const html = await render("member-detail", { ...baseLocals, active: "members", member: m, autoRule: null, plans: [], invoices: [], unpaidTotal: 0 });
  assert.match(visible(html), /روز مانده/);
  assert.match(visible(html), /از .* تا /);
  assert.ok(!/مثلاً 30 روزه|پلن دارای مدت/.test(html), "no stale 'plan with a duration' wording");
});

// --------------------------------------------------------------- live regions
test("pages declare what refreshes live, and /me no longer opens a second socket", async () => {
  const me = await render("me/dashboard", { ...baseLocals, user: { id: "2", username: "x", role: "member" }, membership: null, invoices: [], announcements: [], unpaidTotal: 0 });
  assert.match(me, /data-live="me" data-live-id="me-main"/);
  assert.ok(!/\bio\(\s*\{/.test(me), "realtime.js owns the only connection");

  const rep = await render("reports", { ...baseLocals, active: "reports", report: { days: 30, series: [{ day: "2026-09-30", revenue: 0, count: 0 }], peak: 1, totalRevenue: 0, totalCount: 0, average: 0, today: { day: "2026-09-30", revenue: 0, count: 0 }, unpaidTotal: 0, unpaidCount: 0, breakdown: [], breakdownTitle: "x" } });
  assert.match(rep, /data-live-id="reports-main"/);

  const dash = readFileSync("views/dashboard.ejs", "utf8");
  assert.match(dash, /data-live-id="dash-stats"/);
  assert.match(dash, /data-live-id="dash-table"/);
  assert.match(readFileSync("views/invoices.ejs", "utf8"), /fxLiveHandlers[\s\S]*invoices: \(\) => window\.loadPage\(currentPage, true, false\)/);
  assert.match(readFileSync("views/member-detail.ejs", "utf8"), /fxLiveHandlers = \{ members/);
});

test("every live-region id is unique per page (the refresh matches regions by id)", () => {
  for (const f of walk("views", ".ejs")) {
    const ids = [...readFileSync(f, "utf8").matchAll(/data-live-id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${f} repeats a data-live-id`);
  }
});
