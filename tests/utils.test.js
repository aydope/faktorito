import test from "node:test";
import assert from "node:assert/strict";

import { escapeRegex, asString, asEnum, parsePagination, buildPagination, csvCell, toCsv, normalizeDigits } from "../src/utils/query.js";
import { calculateTotals } from "../src/utils/helpers.js";
import csrfProtection from "../src/middleware/csrfProtection.js";

test("asString rejects NoSQL-injection objects", () => {
  assert.equal(asString({ $ne: "x" }), "");
  assert.equal(asString(["a"]), "");
  assert.equal(asString("  hi  "), "hi");
  assert.equal(asString("x".repeat(500), 10).length, 10);
});

test("asEnum only returns allowed values", () => {
  assert.equal(asEnum("active", ["active", "frozen"]), "active");
  assert.equal(asEnum("admin", ["active", "frozen"]), "");
  assert.equal(asEnum({ $gt: "" }, ["active"]), "");
});

test("escapeRegex neutralises regex metacharacters (ReDoS / injection)", () => {
  const rx = new RegExp(escapeRegex("(a+)+$"));
  assert.ok(rx.test("(a+)+$"));
  assert.ok(!rx.test("aaaa"));
});

test("pagination is clamped", () => {
  assert.deepEqual(parsePagination({ page: "-5", limit: "9999" }, { maxLimit: 50 }), { page: 1, limit: 50, skip: 0 });
  assert.equal(parsePagination({ page: "3", limit: "10" }).skip, 20);
  const p = buildPagination({ page: 2, limit: 10, totalCount: 25 });
  assert.equal(p.totalPages, 3);
  assert.ok(p.hasNext && p.hasPrev);
});

test("CSV cells block formula injection and escape quotes", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell("+1"), `"'+1"`);
  assert.equal(csvCell(null), `""`);
  assert.ok(toCsv(["a"], [["b"]]).startsWith("\uFEFF"));
});

test("Persian / Arabic digits are normalised", () => {
  assert.equal(normalizeDigits("۰۹۱۲۳۴۵۶۷۸۹"), "09123456789");
  assert.equal(normalizeDigits("٠٩١٢"), "0912");
});

test("calculateTotals: items + percent + fixed discount, never negative", () => {
  const r = calculateTotals(100000, [{ name: "قهوه", price: 20000 }], [
    { type: "percent", value: 10, description: "تخفیف" },
    { type: "fixed", value: 5000, description: "کد" },
  ]);
  assert.equal(r.totalAmount, 120000 - 12000 - 5000);

  const huge = calculateTotals(1000, [], [{ type: "fixed", value: 999999, description: "x" }]);
  assert.equal(huge.totalAmount, 0);
});

const run = (headers, method = "POST") =>
  new Promise((resolve) => {
    const req = { method, protocol: "https", get: (h) => headers[h.toLowerCase()] };
    csrfProtection(req, {}, (err) => resolve(err || null));
  });

test("CSRF: same-origin passes, cross-site blocked", async () => {
  assert.equal(await run({}, "GET"), null);
  assert.equal(await run({ "sec-fetch-site": "same-origin", host: "a.com" }), null);
  assert.ok(await run({ "sec-fetch-site": "cross-site", host: "a.com" }));
  assert.ok(await run({ "sec-fetch-site": "same-site", host: "a.com" }));
  assert.equal(await run({ origin: "https://a.com", host: "a.com" }), null);
  assert.ok(await run({ origin: "https://evil.com", host: "a.com" }));
});
