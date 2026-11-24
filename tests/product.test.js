import test from "node:test";
import assert from "node:assert/strict";

import { renderAvatar, avatarSpec } from "../src/utils/avatar.js";
import { THEMES, THEME_KEYS, normalizeTheme, toSheet, sampleSheet } from "../src/utils/invoiceSheet.js";
import { PERIOD_CHOICES, INTERVAL_CHOICES, periodLabel } from "../src/utils/period.js";
import { planSnapshot } from "../src/services/invoiceService.js";
import { LIMITS, limitMessage } from "../src/config/limits.js";
import { registerSchema } from "../src/validators/auth.js";
import { createGymSchema } from "../src/validators/gym.js";
import { planSchema } from "../src/validators/plan.js";
import { invoiceSchema } from "../src/validators/invoice.js";
import Plan from "../src/models/Plan.js";
import AutoInvoice from "../src/models/AutoInvoice.js";
import User from "../src/models/User.js";

// ------------------------------------------------------------------- avatar
test("avatar: same seed -> same SVG; different seeds differ", () => {
  assert.equal(renderAvatar("owner-1", "x"), renderAvatar("owner-1", "x"));
  assert.notEqual(renderAvatar("owner-1"), renderAvatar("owner-2"));
  assert.deepEqual(avatarSpec("a"), avatarSpec("a"));
});

test("avatar: the label is escaped and no script can be injected", () => {
  const svg = renderAvatar("s", `"><script>alert(1)</script>`);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(!svg.includes("<script>"));
});

// ------------------------------------------------------------------- themes
test("themes: luxe exists and unknown names fall back to the default", () => {
  assert.ok(THEME_KEYS.includes("luxe"));
  assert.equal(THEMES.length, THEME_KEYS.length);
  assert.equal(normalizeTheme("luxe"), "luxe");
  assert.equal(normalizeTheme("<img>"), "aurora");
  assert.ok(User.schema.path("invoiceTheme").enumValues.includes("luxe"));
  assert.deepEqual([...User.schema.path("invoiceTheme").enumValues].sort(), [...THEME_KEYS].sort());
});

test("sheet: built from an invoice, splits items and discounts, never trusts the theme", () => {
  const sheet = toSheet({
    invoice: {
      invoiceNumber: "F-1", trackingCode: "TRK-1", totalAmount: 100, isPaid: false, invoiceDate: "1405/1/1",
      member: { name: "علی", phone: "09***", memberId: "M-1" },
      plan: { name: "ماهانه", price: 100, durationUnit: "month", durationValue: 3 },
      extraItems: [{ name: "آب", price: 5 }, { name: "تخفیف", price: -10, type: "discount" }],
    },
    owner: { _id: "o1", clubName: "باشگاه", invoiceTheme: "nope" },
  });
  assert.equal(sheet.theme, "aurora");
  assert.equal(sheet.extras.length, 1);
  assert.equal(sheet.discounts.length, 1);
  assert.equal(sheet.plan.period, "3 ماهه");
  assert.equal(sheet.member.initial, "ع");
  assert.ok(sheet.avatar.startsWith("<svg"));
  assert.equal(sheet.signature, null);
});

test("sheet: a hostile stored signature path is dropped", () => {
  const sheet = toSheet({
    invoice: { invoiceNumber: "F-1", member: { name: "x" }, plan: {}, extraItems: [] },
    owner: { _id: "o1", clubName: "c", signature: { path: `M 1 1" onload="x`, color: "red" } },
  });
  assert.equal(sheet.signature, null);
});

test("sample sheet works for every theme", async () => {
  for (const t of THEME_KEYS) {
    const s = await sampleSheet({ theme: t });
    assert.equal(s.theme, t);
    assert.ok(s.qrSvg.includes("<svg"));
    assert.ok(s.signature.path.startsWith("M "));
  }
});

// ------------------------------------------- plans have no time, periods do
test("plans carry no duration at all", () => {
  for (const k of ["durationUnit", "durationValue", "durationDays"]) assert.equal(Plan.schema.path(k), undefined);
  const ok = planSchema.validate({ name: "ماهانه", price: 100 });
  assert.equal(ok.error, undefined);
  assert.ok(planSchema.validate({ name: "ماهانه", price: 100, durationValue: 3 }).error);
});

test("invoice snapshot takes the period from the invoice, not the plan", () => {
  const plan = { _id: "p1", name: "ماهانه", price: 100 };
  const three = planSnapshot(plan, 3);
  assert.equal(three.durationUnit, "month");
  assert.equal(three.durationValue, 3);
  assert.equal(planSnapshot(plan).durationUnit, "none");
  assert.equal(planSnapshot(plan, 5).durationUnit, "none"); // not an allowed period
});

test("periods: monthly .. yearly; auto-issue needs a real interval", () => {
  assert.ok(PERIOD_CHOICES.includes(0));
  assert.ok(!INTERVAL_CHOICES.includes(0));
  assert.equal(periodLabel(1), "ماهانه");
  assert.equal(periodLabel(3), "3 ماهه");
});

test("auto-issue rule: interval is on the rule and limited to the allowed choices", () => {
  const rule = new AutoInvoice({ user: "507f1f77bcf86cd799439011", member: "507f1f77bcf86cd799439012", plan: "507f1f77bcf86cd799439013", nextIssueAt: new Date(), intervalMonths: 5 });
  assert.ok(rule.validateSync().errors.intervalMonths);
  rule.intervalMonths = 3;
  assert.equal(rule.validateSync(), undefined);
});

test("invoice validator: periodMonths must be an allowed value", () => {
  const base = { memberName: "علی رضایی", planId: "507f1f77bcf86cd799439013" };
  assert.equal(invoiceSchema.validate({ ...base, periodMonths: 3 }).error, undefined);
  assert.ok(invoiceSchema.validate({ ...base, periodMonths: 7 }).error);
});

// -------------------------------------------------------------------- legal
const goodRegistration = { username: "ali.test", email: "ali@example.com", password: "Abcdef1!x", confirmPassword: "Abcdef1!x" };

test("registration needs the terms checkbox, and only that (no account types)", () => {
  assert.ok(registerSchema.validate(goodRegistration).error);
  assert.ok(registerSchema.validate({ ...goodRegistration, acceptTerms: false }).error);
  assert.equal(registerSchema.validate({ ...goodRegistration, acceptTerms: true }).error, undefined);
  assert.ok(registerSchema.validate({ ...goodRegistration, acceptTerms: true, role: "owner" }).error);
  assert.ok(registerSchema.validate({ ...goodRegistration, acceptTerms: true, accountType: "owner" }).error);
});

test("creating a gym needs the extra gym-owner terms", () => {
  const body = { clubName: "باشگاه آیدا" };
  assert.ok(createGymSchema.validate(body).error);
  assert.ok(createGymSchema.validate({ ...body, acceptBusinessTerms: false }).error);
  assert.equal(createGymSchema.validate({ ...body, acceptBusinessTerms: true }).error, undefined);
});

test("terms acceptance is stored with a version and a time", () => {
  for (const f of ["termsAcceptedAt", "termsVersion", "businessTermsAcceptedAt", "businessTermsVersion"]) {
    assert.ok(User.schema.path(f), f);
  }
});

// ------------------------------------------------------------------- limits
test("owner limits are positive and produce a readable message", () => {
  for (const [k, v] of Object.entries(LIMITS)) assert.ok(Number.isInteger(v) && v > 0, k);
  assert.match(limitMessage("members"), new RegExp(String(LIMITS.members)));
  assert.ok(Object.isFrozen(LIMITS));
});
