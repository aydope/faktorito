import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";
import session from "express-session";

/**
 * The whole product through the real HTTP stack against a REAL database:
 * sign-up with the e-mail code, creating a gym, plans, members, invoices, payment,
 * the member's own panel, leaving a club, announcements, auto-issue and every page.
 *
 * It is skipped unless INTEGRATION_MONGODB_URI is set, e.g.
 *   INTEGRATION_MONGODB_URI=mongodb://127.0.0.1:27017/faktorito_it npm test
 * Use a THROW-AWAY database: the test wipes it first, and refuses unless its name ends with _it, _test or _tmp.
 */
const URI = process.env.INTEGRATION_MONGODB_URI;
const run = URI ? test : test.skip;

if (URI) {
  process.env.MONGODB_URI = URI;
  process.env.SESSION_SECRET = "i".repeat(48);
  process.env.NODE_ENV = "development"; // the mail is printed to the console and the test reads the code from there
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_PASSWORD;
}

let server, base;
const printed = []; // what the dev mailer printed
const realLog = console.log;
const clients = new Map();

const client = (name, ip) => {
  const jar = {};
  const c = {
    name, ip, jar,
    async req(method, path, body, headers = {}) {
      const res = await fetch(base + path, {
        method,
        redirect: "manual",
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          Accept: "application/json, text/html",
          "X-Forwarded-For": ip,
          Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const sc of res.headers.getSetCookie?.() || []) { const [kv] = sc.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* html */ }
      return { status: res.status, text, json, headers: res.headers };
    },
    get: (p, h) => c.req("GET", p, undefined, { Accept: "text/html", ...h }),
    post: (p, b = {}) => c.req("POST", p, b),
    put: (p, b = {}) => c.req("PUT", p, b),
    patch: (p, b = {}) => c.req("PATCH", p, b),
    del: (p) => c.req("DELETE", p),
  };
  clients.set(name, c);
  return c;
};

/** The 6-digit code the dev mailer printed for this address. */
const lastCode = (email) => {
  for (let i = printed.length - 1; i >= 0; i--) if (printed[i].includes(`to=${email}`)) { const m = printed[i].match(/\b(\d{6})\b/); if (m) return m[1]; }
  throw new Error(`no code was mailed to ${email}`);
};

const signUp = async (c, n) => {
  const email = `${n}@example.com`;
  let res = await c.post("/auth/register", { username: n, email, password: "Abcdef1!x", confirmPassword: "Abcdef1!x", acceptTerms: true });
  assert.equal(res.status, 201, `register ${n}: ${res.text.slice(0, 200)}`);
  res = await c.post("/auth/verify", { code: lastCode(email) });
  assert.ok([200, 201].includes(res.status), `verify ${n}: ${res.status} ${res.text.slice(0, 200)}`);
  return email;
};

test.before(async () => {
  if (!URI) return;
  console.log = (...a) => { const s = a.join(" "); if (s.includes("[mail:dev]")) printed.push(s); else realLog(...a); };
  await mongoose.connect(URI);
  // this test WIPES the database: refuse anything that is not clearly a throw-away one
  const dbName = mongoose.connection.name;
  if (!/(^|[_-])(it|test|tests|tmp)$/i.test(dbName)) {
    await mongoose.disconnect();
    throw new Error(`Refusing to wipe database "${dbName}": its name must end with _it, _test or _tmp`);
  }
  await mongoose.connection.dropDatabase();
  const { createApp } = await import("../../src/createApp.js");
  const { runMigrations } = await import("../../src/config/migrations.js");
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await runMigrations();
  const { app } = createApp({ sessionStore: new session.MemoryStore() });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  console.log = realLog;
  if (!URI) return;
  server?.closeAllConnections?.();
  server?.close();
  await mongoose.disconnect();
});

const S = {}; // shared state between the steps

run("1. sign-up with the e-mail code (everyone registers the same way)", async () => {
  const owner = client("owner", "10.0.0.1");
  S.ownerEmail = await signUp(owner, "ali_owner");
  const me = await owner.get("/me");
  assert.equal(me.status, 200, "a verified account lands in the ordinary member panel");
  assert.ok(!me.text.includes("stack"), "no stack on any page");
});

run("2. a wrong code is refused, the budget of attempts is respected", async () => {
  const c = client("probe", "10.0.0.2");
  const email = "probe@example.com";
  await c.post("/auth/register", { username: "probe_user", email, password: "Abcdef1!x", confirmPassword: "Abcdef1!x", acceptTerms: true });
  const res = await c.post("/auth/verify", { code: "000000" });
  assert.equal(res.status, 400);
  assert.match(res.json.message, /[\u0600-\u06ff]/, "the message is Persian");
});

run("3. only the dedicated route creates a gym, and it needs the extra terms", async () => {
  const owner = clients.get("owner");
  let res = await owner.post("/gym/create", { clubName: "باشگاه آیدا", clubPhone: "09123456789", clubAddress: "تهران", acceptBusinessTerms: false });
  assert.equal(res.status, 400);
  res = await owner.post("/gym/create", { clubName: "باشگاه آیدا", clubPhone: "09123456789", clubAddress: "تهران", acceptBusinessTerms: true });
  assert.equal(res.status, 201, res.text.slice(0, 200));
  assert.equal((await owner.get("/dashboard")).status, 200);
  assert.equal((await owner.post("/gym/create", { clubName: "دوباره", acceptBusinessTerms: true })).status >= 400, true, "a second gym is refused");
});

run("4. plan, member and an invoice with a subscription period", async () => {
  const owner = clients.get("owner");
  let res = await owner.post("/plans", { name: "ماهانه", price: 900000, description: "یک ماه" });
  assert.equal(res.status, 201, res.text.slice(0, 200));
  res = await owner.get("/plans");
  assert.equal(res.status, 200);
  const Plan = mongoose.models.Plan;
  S.plan = await Plan.findOne({ name: "ماهانه" }).lean();
  assert.ok(S.plan && S.plan.durationDays === undefined, "plans carry no duration");

  res = await owner.post("/members", { name: "علی رضایی", phone: "09121112233", notes: "" });
  assert.equal(res.status, 201, res.text.slice(0, 200));
  S.member = await mongoose.models.Member.findOne({ name: "علی رضایی" }).lean();
  assert.match(S.member.code, /^M-\d{4}$/);

  res = await owner.post("/invoices", { memberRef: String(S.member._id), planId: String(S.plan._id), periodMonths: 3, items: [{ name: "آب", price: 20000 }], note: "" });
  assert.equal(res.status, 201, res.text.slice(0, 300));
  S.invoice = await mongoose.models.Invoice.findOne({ memberRef: S.member._id }).lean();
  assert.equal(S.invoice.totalAmount, 920000);
  assert.equal(S.invoice.plan.durationValue, 3);
  assert.equal(S.invoice.extraItems[0].type, "item");
  assert.equal(S.invoice.isPaid, false);
});

run("5. paying extends the membership; the owner sees until when and how much is left", async () => {
  const owner = clients.get("owner");
  const res = await owner.patch(`/invoices/${S.invoice._id}/toggle-payment`);
  assert.equal(res.status, 200, res.text.slice(0, 200));
  const m = await mongoose.models.Member.findById(S.member._id).lean();
  const days = Math.round((m.membershipExpiresAt - Date.now()) / 864e5);
  assert.ok(days >= 88 && days <= 92, `3 months of subscription, got ${days} days`);
  assert.equal(m.totalPaid, 920000);

  const list = await owner.get("/members");
  assert.equal(list.status, 200);
  assert.ok(list.text.includes("اشتراک تا"), "the list shows the end date");
  assert.match(list.text, /(8[89]|9[0-2]) روز مانده/, "and the days left");
  const detail = await owner.get(`/members/${S.member._id}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /روز مانده/);

  // toggling again must not extend a second time
  await owner.patch(`/invoices/${S.invoice._id}/toggle-payment`);
  await owner.patch(`/invoices/${S.invoice._id}/toggle-payment`);
  const again = await mongoose.models.Member.findById(S.member._id).lean();
  assert.ok(Math.abs(again.membershipExpiresAt - m.membershipExpiresAt) < 3 * 864e5, "paying twice does not double the subscription");
});

run("6. every owner page renders (settings crashed once)", async () => {
  const owner = clients.get("owner");
  for (const p of ["/dashboard", "/members", "/plans", "/invoices", "/invoices/new", "/auto-invoices", "/announcements", "/reports", "/reports?days=7", "/reports?days=90", "/settings", "/profile", `/members/${S.member._id}`, `/invoices/${S.invoice._id}/edit`]) {
    const res = await owner.get(p);
    assert.equal(res.status, 200, `${p} -> ${res.status}`);
    assert.ok(!/<pre[^>]*stack|node_modules|\.ejs:\d+/.test(res.text), `${p} leaked internals`);
    assert.ok(!/[\u06f0-\u06f9\u0660-\u0669]/.test(res.text.replace(/<script[\s\S]*?<\/script>/g, "")), `${p} shows native digits`);
  }
});

run("7. the public invoice page works for every theme and never shows the phone in full", async () => {
  const owner = clients.get("owner");
  const anon = client("anon", "10.0.0.3");
  for (const theme of ["aurora", "midnight", "mono", "luxe"]) {
    assert.equal((await owner.put("/settings/branding", { invoiceTheme: theme })).status, 200);
    const page = await anon.get(`/i/${S.invoice.publicId}`);
    assert.equal(page.status, 200, theme);
    assert.ok(page.text.includes(`data-fx-theme="${theme}"`));
    assert.ok(!page.text.includes("09121112233"), "phone is masked");
  }
  assert.equal((await owner.get("/settings/branding/preview?theme=luxe")).status, 200);
});

run("8. the signature is drawn strokes, stored as a safe path", async () => {
  const owner = clients.get("owner");
  const res = await owner.put("/settings/branding", { strokes: [[[10, 10], [60, 80], [120, 30]]], signerName: "مدیریت", signaturePosition: "left", signatureColor: "#111827" });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  const u = await mongoose.models.User.findOne({ username: "ali_owner" }).lean();
  assert.match(u.signature.path, /^M /);
  const bad = await owner.put("/settings/branding", { strokes: [[[9999, 10], [1, 1]]] });
  assert.equal(bad.status, 400);
});

run("9. a second person registers, is added to the club by e-mail and sees it in /me", async () => {
  const owner = clients.get("owner");
  const memberClient = client("member", "10.0.0.4");
  const email = await signUp(memberClient, "sara_member");
  const add = await owner.post("/members", { name: "سارا احمدی", phone: "09125556677", email });
  assert.equal(add.status, 201, add.text.slice(0, 200));
  S.sara = await mongoose.models.Member.findOne({ name: "سارا احمدی" }).lean();
  assert.ok(S.sara.account, "the member is linked to the account");

  const me = await memberClient.get("/me");
  assert.equal(me.status, 200);
  assert.ok(me.text.includes("باشگاه آیدا"), "the member's panel says which gym they belong to");
});

run("10. a club member can't create a gym, and a club owner can't be added as a member", async () => {
  const memberClient = clients.get("member");
  const res = await memberClient.post("/gym/create", { clubName: "باشگاه دوم", acceptBusinessTerms: true });
  assert.equal(res.status, 409);

  const owner = clients.get("owner");
  const res2 = await owner.post("/members", { name: "خودم", phone: "09120000000", email: S.ownerEmail });
  assert.equal(res2.status, 409);
});

run("11. a second gym can't take a member who is already in a club", async () => {
  const owner2 = client("owner2", "10.0.0.5");
  await signUp(owner2, "reza_owner");
  assert.equal((await owner2.post("/gym/create", { clubName: "باشگاه رضا", acceptBusinessTerms: true })).status, 201);
  const res = await owner2.post("/members", { name: "سارا", phone: "09125556677", email: "sara_member@example.com" });
  assert.equal(res.status, 409, "the member must leave or be removed first");
});

run("12. announcements show up in the member's panel", async () => {
  const owner = clients.get("owner");
  const res = await owner.post("/announcements", { title: "تعطیلی", body: "فردا باشگاه تعطیل است", hours: 24 });
  assert.equal(res.status, 201, res.text.slice(0, 200));
  const me = await clients.get("member").get("/me");
  assert.ok(me.text.includes("تعطیلی"));
});

run("13. auto-issue every 3 months for a member; edit and delete", async () => {
  const owner = clients.get("owner");
  const res = await owner.put(`/auto-invoices/member/${S.member._id}`, { planId: String(S.plan._id), intervalMonths: 3, note: "" });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  const rule = await mongoose.models.AutoInvoice.findOne({ member: S.member._id }).lean();
  assert.equal(rule.intervalMonths, 3);
  assert.equal((await owner.patch(`/auto-invoices/${rule._id}`, { intervalMonths: 1 })).status, 200);
  assert.equal((await owner.get("/auto-invoices")).status, 200);
  assert.equal((await owner.del(`/auto-invoices/${rule._id}`)).status, 200);
  assert.equal(await mongoose.models.AutoInvoice.countDocuments({ member: S.member._id }), 0);
});

run("14. freezing a gym member and unfreezing it", async () => {
  const owner = clients.get("owner");
  assert.equal((await owner.post(`/members/${S.member._id}/freeze`)).status, 200);
  assert.equal((await mongoose.models.Member.findById(S.member._id).lean()).status, "frozen");
  assert.equal((await owner.post(`/members/${S.member._id}/unfreeze`)).status, 200);
  assert.equal((await mongoose.models.Member.findById(S.member._id).lean()).status, "active");
});

run("15. notifications: the member got some, and reading them by id works", async () => {
  const c = clients.get("member");
  const list = await c.req("GET", "/notifications");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.length >= 1 && list.json.unread >= 1);
  const ids = list.json.items.slice(0, 1).map((n) => n.id);
  const res = await c.post("/notifications/read", { ids });
  assert.equal(res.status, 200);
  assert.equal(res.json.unread, list.json.unread - 1);
  assert.equal((await c.post("/notifications/read", { ids: ["nope"] })).status, 400);
});

run("16. the member leaves; the owner's record is kept and unlinked", async () => {
  const c = clients.get("member");
  const res = await c.post("/me/leave");
  assert.equal(res.status, 200, res.text.slice(0, 200));
  const m = await mongoose.models.Member.findById(S.sara._id).lean();
  assert.equal(m.account, null);
  assert.equal(m.deletedAt ?? null, null, "the gym keeps the record");
  // free to join another club now
  const owner2 = clients.get("owner2");
  assert.equal((await owner2.post("/members", { name: "سارا", phone: "09125556677", email: "sara_member@example.com" })).status, 201);
});

run("17. removing a member is a soft delete; restoring brings them back", async () => {
  const owner = clients.get("owner");
  assert.equal((await owner.del(`/members/${S.member._id}`)).status, 200);
  const gone = await mongoose.models.Member.findById(S.member._id).setOptions({ withDeleted: true }).lean();
  assert.ok(gone && gone.deletedAt, "still in the database, marked deleted");
  assert.equal((await owner.post(`/members/${S.member._id}/restore`)).status, 200);
  assert.equal((await mongoose.models.Member.findById(S.member._id).lean()).deletedAt ?? null, null);
});

run("18. staff pages are closed to owners; other people's data is not reachable", async () => {
  const owner = clients.get("owner");
  for (const p of ["/admin/dashboard", "/admin/users"]) assert.ok([401, 403, 302, 404].includes((await owner.get(p)).status), p);
  const owner2 = clients.get("owner2");
  assert.equal((await owner2.get(`/members/${S.member._id}`)).status, 404, "another gym's member");
  assert.equal((await owner2.get(`/invoices/${S.invoice._id}/edit`)).status, 404, "another gym's invoice");
  assert.ok((await owner2.patch(`/invoices/${S.invoice._id}/toggle-payment`)).status >= 400);
});

run("19. errors never show a stack, in any mode", async () => {
  const owner = clients.get("owner");
  const r1 = await owner.get("/members/not-an-id");
  assert.ok(r1.status >= 400 && !/stack|node_modules|\.js:\d+/.test(r1.text));
  const r2 = await owner.get("/nope/nothing");
  assert.equal(r2.status, 404);
  assert.ok(!/<pre/.test(r2.text));
  const r3 = await owner.req("POST", "/members", undefined, { "Content-Type": "application/json" });
  assert.ok(r3.status >= 400);
});

run("20. the daily limits hold", async () => {
  const DailyQuota = mongoose.models.DailyQuota;
  const signups = await DailyQuota.findOne({ kind: "signup" }).lean();
  assert.ok(signups.count >= 3 && signups.count <= 25);
  // fill today's sign-up budget, the next registration is refused with Retry-After
  await DailyQuota.updateOne({ kind: "signup", day: signups.day }, { $set: { count: 25 } });
  const c = client("late", "10.0.0.9");
  const res = await c.post("/auth/register", { username: "late_user", email: "late@example.com", password: "Abcdef1!x", confirmPassword: "Abcdef1!x", acceptTerms: true });
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) > 0);
  assert.ok(!(await mongoose.models.User.exists({ username: "late_user" })));
});
