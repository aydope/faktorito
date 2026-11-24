import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { CASES, render, base } from "./helpers/views.js";
import { enhanceHtml, HEAD_ASSET, BODY_ASSETS } from "../src/utils/htmlEnhance.js";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const A11Y_JS = readFileSync("public/a11y.js", "utf8");
const A11Y_CSS = readFileSync("public/a11y.css", "utf8");

const open = (html, { script = true } = {}) => {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, json: async () => ({ items: [], unread: 0 }), text: async () => "" });
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.HTMLCanvasElement.prototype.getContext = () => null; // the signature pad draws on a canvas; jsdom has none
  if (!("inert" in w.HTMLElement.prototype)) {
    Object.defineProperty(w.HTMLElement.prototype, "inert", { get() { return this.hasAttribute("inert"); }, set(v) { v ? this.setAttribute("inert", "") : this.removeAttribute("inert"); }, configurable: true });
  }
  w.HTMLElement.prototype.getClientRects = function () { return this.hasAttribute("hidden") ? [] : [{}]; }; // jsdom has no layout
  // a real browser runs the deferred script after parsing; make the fake document say so
  Object.defineProperty(w.document, "readyState", { value: "complete", configurable: true });
  if (script) w.eval(A11Y_JS);
  return w;
};

// ------------------------------------------------- axe on every page we render
// color-contrast needs a real layout engine (checked below with the real numbers instead)
const RULES = { "color-contrast": { enabled: false }, "scrollable-region-focusable": { enabled: false } };

for (const [name, extra] of Object.entries(CASES)) {
  test(`axe finds no accessibility violation on: ${name}`, async () => {
    const view = name.split(" (")[0];
    const html = enhanceHtml(await render(view, { ...base, ...extra }), { includeAssets: view !== "invoice-preview" });
    const w = open(html);
    w.eval(AXE);
    const { violations } = await w.axe.run(w.document, { rules: RULES, resultTypes: ["violations"] });
    w.close();
    // axe runs inside jsdom, so its arrays come from another realm: compare by length, print the details
    const report = Array.from(violations, (v) => `${v.id}: ${v.help} -> ${Array.from(v.nodes).slice(0, 3).map((n) => Array.from(n.target).join(" ")).join(" | ")}`);
    assert.equal(report.length, 0, report.join("\n"));
  });
}

// ----------------------------------------------------------- shared assets
test("enhanceHtml adds the shared assets once and leaves fragments alone", () => {
  const page = "<html><head><title>t</title></head><body><main>x</main></body></html>";
  const out = enhanceHtml(page);
  assert.ok(out.includes(HEAD_ASSET) && out.includes(BODY_ASSETS));
  assert.ok(out.indexOf(HEAD_ASSET) < out.indexOf("</head>") && out.indexOf(BODY_ASSETS) < out.indexOf("</body>"));
  assert.equal(enhanceHtml(out), out, "idempotent");
  assert.equal(enhanceHtml("<p>fragment</p>"), "<p>fragment</p>");
  assert.equal(enhanceHtml(page, { includeAssets: false }), page);
  assert.equal(enhanceHtml(null), null);
});

// ------------------------------------------------------------- script behavior
const PAGE = `<!doctype html><html lang="fa" dir="rtl"><body>
  <aside id="sidebar" class="sidebar"><a href="/x">link</a></aside>
  <button id="opener">open</button>
  <button id="iconOnly" title="حذف"><i class="bi bi-trash"></i></button>
  <a id="iconLink" href="/e" title="ویرایش"><i class="bi bi-pencil"></i></a>
  <main><h1>t</h1></main>
  <div id="toast" class="toast"></div>
  <div class="error-text" id="e1"></div>
  <div class="modal-overlay" id="dlg"><div class="modal-dialog"><h3>خروج از حساب</h3><button id="cancel">انصراف</button><button id="ok">خروج</button></div></div>
</body></html>`;
const tick = () => new Promise((r) => setTimeout(r, 30));

test("skip link goes to a focusable <main>", () => {
  const w = open(PAGE);
  const skip = w.document.body.firstElementChild;
  assert.equal(skip.className, "fx-skip");
  assert.equal(skip.getAttribute("href"), "#main");
  const main = w.document.querySelector("main");
  assert.equal(main.id, "main");
  assert.equal(main.getAttribute("tabindex"), "-1");
  skip.click();
  assert.equal(w.document.activeElement, main);
});

test("icon-only controls get a name from their title; icons are hidden from screen readers", () => {
  const w = open(PAGE);
  assert.equal(w.document.getElementById("iconOnly").getAttribute("aria-label"), "حذف");
  assert.equal(w.document.getElementById("iconLink").getAttribute("aria-label"), "ویرایش");
  assert.equal(w.document.getElementById("opener").hasAttribute("aria-label"), false, "a button with text keeps its text");
  assert.ok([...w.document.querySelectorAll("i.bi")].every((i) => i.getAttribute("aria-hidden") === "true"));
});

test("toast and field errors are announced", () => {
  const w = open(PAGE);
  const toast = w.document.getElementById("toast");
  assert.equal(toast.getAttribute("role"), "status");
  assert.equal(toast.getAttribute("aria-live"), "polite");
  assert.equal(w.document.getElementById("e1").getAttribute("aria-live"), "polite");
});

test("content added later gets names too (live refresh)", async () => {
  const w = open(PAGE);
  w.document.body.insertAdjacentHTML("beforeend", '<button id="late" title="جدید"><i class="bi bi-plus"></i></button>');
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(w.document.getElementById("late").getAttribute("aria-label"), "جدید");
});

test("the closed off-canvas menu can't be reached with Tab; opening it makes it reachable", async () => {
  const w = open(PAGE);
  const sb = w.document.getElementById("sidebar");
  assert.equal(sb.hasAttribute("inert"), true);
  sb.classList.add("open");
  await tick();
  assert.equal(sb.hasAttribute("inert"), false);
  sb.classList.remove("open");
  await tick();
  assert.equal(sb.hasAttribute("inert"), true);
});

test("dialog: role, focus inside, Tab stays inside, Escape closes, focus goes back", async () => {
  const w = open(PAGE);
  const d = w.document;
  const box = d.querySelector(".modal-dialog");
  assert.equal(box.getAttribute("role"), "dialog");
  assert.equal(box.getAttribute("aria-modal"), "true");
  assert.equal(box.getAttribute("aria-labelledby"), "dlg-title");
  assert.equal(d.getElementById("dlg-title").textContent, "خروج از حساب");

  let closed = null;
  w.closeModal = (id) => { closed = id; d.getElementById(id).classList.remove("active"); };
  d.getElementById("opener").focus();
  d.getElementById("dlg").classList.add("active");
  await tick();
  assert.equal(d.activeElement.id, "cancel", "focus moves into the dialog");

  const press = (init) => { const e = new w.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }); d.dispatchEvent(e); return e; };
  d.getElementById("ok").focus();
  assert.equal(press({ key: "Tab" }).defaultPrevented, true);
  assert.equal(d.activeElement.id, "cancel", "Tab from the last control wraps to the first");
  assert.equal(press({ key: "Tab", shiftKey: true }).defaultPrevented, true);
  assert.equal(d.activeElement.id, "ok", "Shift+Tab from the first wraps to the last");

  press({ key: "Escape" });
  await tick();
  assert.equal(closed, "dlg");
  assert.equal(d.activeElement.id, "opener", "focus returns to what opened it");
});

// ------------------------------------------------------------------- contrast
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const SURFACES = { page: "#050508", card: "#0c0c0f", panel: "#12121c" };
const cssColor = (selector) => A11Y_CSS.match(new RegExp(`${selector}\\s*\\{\\s*color:\\s*(#[0-9a-fA-F]{6})`))?.[1];

test("muted text meets WCAG AA (4.5:1) on every dark surface the app uses", () => {
  for (const sel of ["html body \\.text-gray-500", "html body \\.text-gray-600"]) {
    const c = cssColor(sel);
    assert.ok(c, `${sel} is defined`);
    for (const [name, bg] of Object.entries(SURFACES)) assert.ok(ratio(c, bg) >= 4.5, `${sel} ${c} on ${name} = ${ratio(c, bg).toFixed(2)}`);
  }
  const ph = A11Y_CSS.match(/::placeholder\s*\{\s*color:\s*(#[0-9a-fA-F]{6})/)[1];
  for (const bg of Object.values(SURFACES)) assert.ok(ratio(ph, bg) >= 4.5, `placeholder ${ph}`);
});

test("the numbers behind the override: Tailwind's gray-500/600 really failed", () => {
  assert.ok(ratio("#6b7280", SURFACES.card) < 4.5);
  assert.ok(ratio("#4b5563", SURFACES.page) < 3);
});

test("the focus ring is visible against the dark UI (3:1 for non-text, WCAG 1.4.11)", () => {
  const ring = A11Y_CSS.match(/outline:\s*2px solid (#[0-9a-fA-F]{6})/)[1];
  for (const bg of Object.values(SURFACES)) assert.ok(ratio(ring, bg) >= 3, `${ring} on ${bg}`);
});

test("the stylesheet covers focus, reduced motion, touch targets and tiny text", () => {
  assert.match(A11Y_CSS, /:focus-visible/);
  assert.match(A11Y_CSS, /prefers-reduced-motion:\s*reduce/);
  assert.match(A11Y_CSS, /pointer:\s*coarse[\s\S]*min-height:\s*44px/);
  assert.match(A11Y_CSS, /text-\\\[10px\\\][\s\S]*font-size:\s*11px/);
  assert.match(A11Y_CSS, /\.fx-skip:focus/);
});

test("the invoice sheet uses no type smaller than 11px", () => {
  const css = readFileSync("views/partials/invoice-sheet-css.ejs", "utf8");
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 10);
  assert.ok(Math.min(...sizes) >= 11, `smallest is ${Math.min(...sizes)}px`);
});
