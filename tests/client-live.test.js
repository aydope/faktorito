import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

/**
 * Runs the REAL public/realtime.js inside jsdom with a fake socket, fake fetch and a
 * controllable IntersectionObserver / timer, to prove WHEN a notification counts as read.
 */
const SCRIPT = readFileSync("public/realtime.js", "utf8");

const PAGE = `<!doctype html><html><body>
  <div class="bell-wrap">
    <button id="notifBtn" class="bell-btn"><span id="liveDot" class="live-dot"></span><span id="notifBadge" style="display:none"></span></button>
    <div id="notifPanel" class="notif-panel"><button id="notifReadAll">همه</button><div id="notifList"></div></div>
  </div>
  <div id="region" data-live="invoices" data-live-id="inv">OLD</div>
</body></html>`;

const makeEnv = async ({ items = [], unread = 0, visible = true } = {}) => {
  const dom = new JSDOM(PAGE, { runScripts: "outside-only", url: "http://localhost/dashboard", pretendToBeVisual: true });
  const { window } = dom;

  const calls = []; // every fetch
  let serverUnread = unread;
  let regionHtml = "OLD";
  window.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method || "GET", body });
    const json = (data) => ({ ok: true, redirected: false, json: async () => data, text: async () => "" });
    if (url === "/notifications" && (!opts.method || opts.method === "GET")) return json({ success: true, items, unread: serverUnread });
    if (url === "/notifications/read") {
      const n = body?.ids ? body.ids.length : serverUnread;
      serverUnread = Math.max(0, serverUnread - n);
      return json({ success: true, marked: n, unread: serverUnread });
    }
    // a refreshed copy of the current page
    return { ok: true, redirected: false, text: async () => `<html><body><div data-live-id="inv">${regionHtml}</div></body></html>` };
  };

  // visibility + focus
  let isVisible = visible;
  Object.defineProperty(window.document, "visibilityState", { get: () => (isVisible ? "visible" : "hidden"), configurable: true });
  window.document.hasFocus = () => isVisible;

  // timers we control
  const timers = new Map();
  let tid = 1;
  window.setTimeout = (fn, ms) => { timers.set(++tid, { fn, ms }); return tid; };
  window.clearTimeout = (id) => timers.delete(id);
  window.setInterval = () => 0;
  window.clearInterval = () => {};
  const runTimers = async (maxMs = Infinity) => {
    for (const [id, t] of [...timers]) { if (t.ms <= maxMs) { timers.delete(id); await t.fn(); } }
    await new Promise((r) => setImmediate(r));
  };

  // IntersectionObserver we can drive
  const observed = new Set();
  let ioCallback;
  window.IntersectionObserver = class { constructor(cb) { ioCallback = cb; } observe(el) { observed.add(el); } unobserve(el) { observed.delete(el); } disconnect() {} };
  const intersect = (el, isIntersecting) => ioCallback([{ target: el, isIntersecting }]);

  // fake socket
  const handlers = {};
  window.io = () => ({ on: (e, fn) => { handlers[e] = fn; }, close() {} });
  const fire = async (e, data) => { await handlers[e](data); await new Promise((r) => setImmediate(r)); };

  window.CSS = { escape: (s) => String(s).replace(/"/g, '\\"') };
  window.toast = () => {};
  window.eval(SCRIPT);
  await new Promise((r) => setImmediate(r)); // initial load()

  const $ = (sel) => window.document.querySelector(sel);
  return {
    window, calls, handlers, fire, intersect, runTimers, timers, observed, $,
    setVisible: (v) => { isVisible = v; },
    open: () => $("#notifBtn").click(),
    rows: () => [...window.document.querySelectorAll(".notif-item")],
    badge: () => $("#notifBadge"),
    readCalls: () => calls.filter((c) => c.url === "/notifications/read"),
    setRegion: (h) => { regionHtml = h; },
  };
};

const N = (id, readAt = null) => ({ id, type: "invoice", title: `t${id}`, body: "b", url: "/me", createdAt: new Date().toISOString(), readAt });
const AA = "a".repeat(24), BB = "b".repeat(24);

test("the bell shows the unread count and rows after loading", async () => {
  const env = await makeEnv({ items: [N(AA), N(BB)], unread: 2 });
  assert.equal(env.rows().length, 2);
  assert.equal(env.badge().textContent, "2");
  assert.equal(env.badge().style.display, "flex");
});

test("opening alone is not enough: a row must be seen for a moment, in an open panel", async () => {
  const env = await makeEnv({ items: [N(AA)], unread: 1 });
  // visible in the viewport but the panel is CLOSED -> not read
  env.intersect(env.rows()[0], true);
  await env.runTimers();
  assert.equal(env.readCalls().length, 0);

  env.open();
  assert.ok(env.observed.has(env.rows()[0]), "unread rows are watched once the panel opens");
  env.intersect(env.rows()[0], true);
  assert.equal(env.readCalls().length, 0, "not read the instant it appears");
  await env.runTimers(); // the 'seen for 1.2 s' timer
  await env.runTimers(); // the batched send
  assert.equal(env.readCalls().length, 1);
  assert.deepEqual(env.readCalls()[0].body, { ids: [AA] });
  assert.equal(env.rows()[0].classList.contains("unread"), false);
  assert.equal(env.badge().style.display, "none", "badge follows the server's unread count");
});

test("a row that scrolls away before the delay is NOT marked read", async () => {
  const env = await makeEnv({ items: [N(AA)], unread: 1 });
  env.open();
  env.intersect(env.rows()[0], true);
  env.intersect(env.rows()[0], false); // scrolled out of view
  await env.runTimers();
  await env.runTimers();
  assert.equal(env.readCalls().length, 0);
  assert.equal(env.rows()[0].classList.contains("unread"), true);
});

test("a hidden tab does not read anything", async () => {
  const env = await makeEnv({ items: [N(AA)], unread: 1, visible: false });
  env.open();
  env.intersect(env.rows()[0], true);
  await env.runTimers();
  await env.runTimers();
  assert.equal(env.readCalls().length, 0);
});

test("clicking a notification marks it read immediately", async () => {
  const env = await makeEnv({ items: [N(AA), N(BB)], unread: 2 });
  env.open();
  env.rows()[1].dispatchEvent(new env.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await env.runTimers();
  assert.deepEqual(env.readCalls()[0].body, { ids: [BB] });
});

test("a live notification while the panel is closed stays unread; while open and visible it is read", async () => {
  const env = await makeEnv({ items: [], unread: 0 });
  await env.fire("notification", N(AA));
  assert.equal(env.badge().textContent, "1");
  assert.equal(env.rows().length, 1);
  await env.runTimers();
  assert.equal(env.readCalls().length, 0, "a toast is not 'read'");

  env.open();
  env.intersect(env.rows()[0], true);
  await env.runTimers();
  await env.runTimers();
  assert.equal(env.readCalls().length, 1);

  await env.fire("notification", N(BB)); // arrives while the panel is open
  assert.ok(env.observed.has(env.rows()[0]), "new rows are watched at once");
});

test("another tab reading notifications updates this tab (ids and 'all')", async () => {
  const env = await makeEnv({ items: [N(AA), N(BB)], unread: 2 });
  await env.fire("notifications:read", { ids: [AA], unread: 1 });
  assert.equal(env.rows().find((r) => r.dataset.id === AA).classList.contains("unread"), false);
  assert.equal(env.rows().find((r) => r.dataset.id === BB).classList.contains("unread"), true);
  assert.equal(env.badge().textContent, "1");
  await env.fire("notifications:read", { ids: null, unread: 0 });
  assert.equal(env.rows().every((r) => !r.classList.contains("unread")), true);
});

test("the 'read all' button still works as a shortcut", async () => {
  const env = await makeEnv({ items: [N(AA), N(BB)], unread: 2 });
  env.$("#notifReadAll").click();
  await new Promise((r) => setImmediate(r));
  assert.equal(env.readCalls()[0].body, null);
  assert.equal(env.badge().style.display, "none");
});

test("the live dot follows the connection and a reconnect resyncs", async () => {
  const env = await makeEnv({ items: [], unread: 0 });
  assert.equal(env.$("#liveDot").classList.contains("on"), false);
  await env.fire("connect");
  assert.equal(env.$("#liveDot").classList.contains("on"), true);
  await env.fire("disconnect");
  assert.equal(env.$("#liveDot").classList.contains("on"), false);
  const before = env.calls.filter((c) => c.url === "/notifications").length;
  await env.fire("connect"); // second connect = a RE-connect
  assert.ok(env.calls.filter((c) => c.url === "/notifications").length > before, "the bell is reloaded after a drop");
});

test("a 'live' event refreshes just the matching region", async () => {
  const env = await makeEnv();
  env.setRegion("NEW DATA");
  await env.fire("live", { topics: ["invoices"] });
  await env.runTimers(); // coalescing delay
  await new Promise((r) => setImmediate(r));
  assert.equal(env.$("#region").innerHTML, "NEW DATA");
});

test("a 'live' event for another topic leaves the page alone", async () => {
  const env = await makeEnv();
  env.setRegion("NEW DATA");
  await env.fire("live", { topics: ["members"] });
  await env.runTimers();
  assert.equal(env.$("#region").innerHTML, "OLD");
});

test("a page handler wins over the generic region refresh", async () => {
  const env = await makeEnv();
  let called = 0;
  env.window.fxLiveHandlers = { invoices: () => { called++; } };
  await env.fire("live", { topics: ["invoices"] });
  await env.runTimers();
  assert.equal(called, 1);
  assert.equal(env.$("#region").innerHTML, "OLD");
});

test("while a dialog is open nothing is refreshed under the user's hands", async () => {
  const env = await makeEnv();
  const modal = env.window.document.createElement("div");
  modal.className = "modal-overlay active";
  env.window.document.body.append(modal);
  env.setRegion("NEW DATA");
  await env.fire("live", { topics: ["invoices"] });
  await env.runTimers(500); // the first attempt: busy -> rescheduled
  assert.equal(env.$("#region").innerHTML, "OLD");
  modal.remove();
  await env.runTimers(); // the retry
  await new Promise((r) => setImmediate(r));
  assert.equal(env.$("#region").innerHTML, "NEW DATA");
});

test("notification text is inserted as text, never as HTML", async () => {
  const env = await makeEnv({ items: [{ ...N(AA), title: "<img src=x onerror=alert(1)>", body: "<b>x</b>", url: "javascript:alert(1)" }], unread: 1 });
  const row = env.rows()[0];
  assert.equal(row.querySelector("img"), null);
  assert.equal(row.querySelector("b"), null);
  assert.ok(!row.getAttribute("href").startsWith("javascript:"));
});
