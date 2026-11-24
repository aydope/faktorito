import test from "node:test";
import assert from "node:assert/strict";

import { buildSignaturePath, safeSignaturePath, MAX_POINTS, SIG_W } from "../src/utils/signature.js";
import { addDuration, durationLabel, planDuration, toDays, hasDuration } from "../src/utils/duration.js";
import { advanceNext } from "../src/jobs/autoInvoices.js";
import Invoice from "../src/models/Invoice.js";

// ------------------------------------------------------------------ signature
test("signature: strokes become a safe SVG path", () => {
  const d = buildSignaturePath([[[10, 10], [40, 60], [90, 20], [150, 80]], [[200, 50]]]);
  assert.match(d, /^M /);
  assert.equal(safeSignaturePath(d), d);
});

test("signature: rejects empty, out-of-range, malformed and oversized input", () => {
  assert.throws(() => buildSignaturePath([]));
  assert.throws(() => buildSignaturePath("<svg>"));
  assert.throws(() => buildSignaturePath([[[SIG_W + 1, 5], [3, 3]]]));
  assert.throws(() => buildSignaturePath([[[-1, 5], [3, 3]]]));
  assert.throws(() => buildSignaturePath([[[1, "a"], [3, 3]]]));
  assert.throws(() => buildSignaturePath([[[1, 2, 3]]]));
  const big = [Array.from({ length: MAX_POINTS + 5 }, (_, i) => [i % SIG_W, (i * 7) % 200])];
  assert.throws(() => buildSignaturePath(big));
});

test("signature: a stored path that isn't ours is never rendered", () => {
  assert.equal(safeSignaturePath(`M 1 1" onload="alert(1)`), "");
  assert.equal(safeSignaturePath(undefined), "");
});

// ------------------------------------------------------------------- duration
const d = (iso) => new Date(iso);

test("duration: calendar months clamp to the end of short months", () => {
  assert.equal(addDuration(d("2026-01-31T00:00:00Z"), { unit: "month", value: 1 }).toISOString(), "2026-02-28T00:00:00.000Z");
  assert.equal(addDuration(d("2028-01-31T00:00:00Z"), { unit: "month", value: 1 }).toISOString(), "2028-02-29T00:00:00.000Z");
  assert.equal(addDuration(d("2026-01-15T00:00:00Z"), { unit: "month", value: 3 }).toISOString(), "2026-04-15T00:00:00.000Z");
  assert.equal(addDuration(d("2026-11-30T00:00:00Z"), { unit: "month", value: 3 }).toISOString(), "2027-02-28T00:00:00.000Z");
});

test("duration: days, legacy numbers and 'none'", () => {
  assert.equal(addDuration(d("2026-01-01T00:00:00Z"), 30).toISOString(), "2026-01-31T00:00:00.000Z");
  assert.equal(addDuration(d("2026-01-01T00:00:00Z"), { unit: "none", value: 0 }).toISOString(), "2026-01-01T00:00:00.000Z");
});

test("duration: legacy plans (only durationDays) keep working", () => {
  assert.deepEqual(planDuration({ durationDays: 45 }), { unit: "day", value: 45 });
  assert.deepEqual(planDuration({ durationDays: 0 }), { unit: "none", value: 0 });
  assert.deepEqual(planDuration({ durationUnit: "month", durationValue: 3 }), { unit: "month", value: 3 });
  assert.deepEqual(planDuration(null), { unit: "none", value: 0 });
  assert.equal(toDays({ unit: "month", value: 3 }), 90);
  assert.ok(!hasDuration({ unit: "none", value: 0 }));
});

test("duration: Persian labels", () => {
  assert.match(durationLabel({ unit: "month", value: 3 }), /ماهه$/);
  assert.match(durationLabel({ unit: "day", value: 45 }), /روزه$/);
  assert.equal(durationLabel({ unit: "none", value: 0 }), "بدون انقضا");
});

// --------------------------------------------------------------- auto-issuing
test("auto-issue: monthly dates follow the anchor and don't drift after February", () => {
  const anchor = d("2026-01-31T00:00:00Z");
  const m = { unit: "month", value: 1 };
  const feb = advanceNext(anchor, m, d("2026-01-31T00:00:00Z"));
  assert.equal(feb.toISOString(), "2026-02-28T00:00:00.000Z");
  const mar = advanceNext(anchor, m, feb);
  assert.equal(mar.toISOString(), "2026-03-31T00:00:00.000Z");
});

test("auto-issue: a 3-month plan issues every 3 months", () => {
  const anchor = d("2026-01-10T00:00:00Z");
  const q = { unit: "month", value: 3 };
  assert.equal(advanceNext(anchor, q, d("2026-01-10T00:00:00Z")).toISOString(), "2026-04-10T00:00:00.000Z");
  assert.equal(advanceNext(anchor, q, d("2026-04-10T00:00:00Z")).toISOString(), "2026-07-10T00:00:00.000Z");
});

test("auto-issue: after a long outage there is ONE next date in the future, not a backlog", () => {
  const next = advanceNext(d("2025-01-01T00:00:00Z"), { unit: "month", value: 1 }, d("2026-06-15T12:00:00Z"));
  assert.equal(next.toISOString(), "2026-07-01T00:00:00.000Z");
});

test("auto-issue: a rule without a plan duration cannot be scheduled", () => {
  assert.throws(() => advanceNext(new Date(), { unit: "none", value: 0 }), RangeError);
});

test("invoice schema stores autoIssued at the top level", () => {
  assert.ok(Invoice.schema.path("autoIssued"));
  assert.equal(Invoice.schema.path("plan.autoIssued"), undefined);
});
