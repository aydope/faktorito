import test from "node:test";
import assert from "node:assert/strict";
import Joi from "joi";

import * as auth from "../src/validators/auth.js";
import * as gym from "../src/validators/gym.js";
import * as invoice from "../src/validators/invoice.js";
import * as member from "../src/validators/member.js";
import * as plan from "../src/validators/plan.js";
import * as settings from "../src/validators/settings.js";
import * as announcement from "../src/validators/announcement.js";
import * as autoInvoice from "../src/validators/autoInvoice.js";
import * as branding from "../src/validators/branding.js";
import * as account from "../src/validators/account.js";
import { JOI_OPTIONS, JOI_MESSAGES_FA, FIELD_LABELS, messageFor } from "../src/validators/messages.js";
import validateRequest from "../src/middleware/validateRequest.js";

const MODULES = { auth, gym, invoice, member, plan, settings, announcement, autoInvoice, branding, account };
const SCHEMAS = Object.entries(MODULES).flatMap(([mod, m]) => Object.entries(m).filter(([, v]) => Joi.isSchema(v)).map(([k, v]) => [`${mod}.${k}`, v]));
const PERSIAN = /[\u0600-\u06ff]/;
const NATIVE_DIGITS = /[\u06f0-\u06f9\u0660-\u0669]/;

/** Bad input for a schema: empty, wrong types, out of range, unknown keys, for every declared field. */
const badPayloads = (schema) => {
  const keys = Object.keys(schema.describe().keys || {});
  const odd = [123456789, "", "   ", "x".repeat(700), -1, 0.5, [], {}, null, true, "abc", "2020-13-45", ["a"], { a: 1 }, "<b>", "a@", "zzzzzzzzzzzzzzzzzzzzzzzz"];
  const out = [{}, { unknown_field: 1 }, { items: "x", discounts: 5 }];
  for (const k of keys) for (const v of odd) out.push({ [k]: v });
  return out;
};

const collect = (schema) => {
  const msgs = new Map();
  for (const payload of badPayloads(schema)) {
    const { error } = schema.validate(payload, { ...JOI_OPTIONS, stripUnknown: false });
    for (const d of error?.details || []) msgs.set(`${d.type} @ ${d.path.join(".")}`, messageFor(d));
  }
  return msgs;
};

test("there are validators to check (and the inline ones moved here)", () => {
  assert.ok(SCHEMAS.length >= 20, `found ${SCHEMAS.length} schemas`);
});

for (const [name, schema] of SCHEMAS) {
  test(`every error of ${name} is Persian, with Persian field names and Latin digits`, () => {
    const msgs = collect(schema);
    for (const [where, msg] of msgs) {
      assert.match(msg, PERSIAN, `${where}: no Persian text: ${msg}`);
      assert.ok(!/"?[A-Za-z]+"? (is|must|length|not allowed|required)/.test(msg), `${where}: English leaked: ${msg}`);
      assert.ok(!/[a-z]+[A-Z][a-z]+/.test(msg), `${where}: a field key is shown untranslated (add it to FIELD_LABELS): ${msg}`);
      assert.ok(!NATIVE_DIGITS.test(msg), `${where}: native digits in ${msg}`);
      assert.ok(!/\{\{|#label|#limit/.test(msg), `${where}: unfilled template in ${msg}`);
    }
  });
}

test("a schema's own, more specific message still wins over the default", () => {
  const { error } = auth.registerSchema.validate({ username: "a", email: "x", password: "y", confirmPassword: "z" }, JOI_OPTIONS);
  const text = error.details.map(messageFor).join(" | ");
  assert.match(text, /نام کاربری/);
  assert.ok(!/(یا|و) معتبر نیست.*نام کاربری معتبر نیست/.test(text));
});

test("defaults fill in the gaps: wrong type, too long, empty, unknown field", () => {
  const s = Joi.object({ username: Joi.string().max(5), age: Joi.number() });
  const text = (v) => s.validate(v, { ...JOI_OPTIONS, stripUnknown: false }).error.details.map(messageFor).join("|");
  assert.equal(text({ username: 5 }), "نام کاربری باید متن باشد");
  assert.equal(text({ username: "abcdefgh" }), "نام کاربری نباید بیشتر از 5 کاراکتر باشد");
  assert.equal(text({ username: "" }), "نام کاربری نمی‌تواند خالی باشد");
  assert.equal(text({ zzz: 1 }), "فیلد «مقدار» مجاز نیست");
  assert.equal(text({ age: "x" }), "مقدار باید عدد باشد");
});

test("array rows are named: 'آیتم‌ها (ردیف 2)'", () => {
  const s = Joi.object({ items: Joi.array().items(Joi.object({ price: Joi.number().required() })) });
  const { error } = s.validate({ items: [{ price: 1 }, {}] }, JOI_OPTIONS);
  assert.equal(messageFor(error.details[0]), "قیمت (ردیف 2) الزامی است");
});

test("the dictionary has no English text and no native digits", () => {
  for (const [code, msg] of Object.entries(JOI_MESSAGES_FA)) {
    assert.match(msg, PERSIAN, code);
    assert.ok(!NATIVE_DIGITS.test(msg), code);
    assert.ok(!/[A-Za-z]{3,}/.test(msg.replace(/\{\{#\w+\}\}/g, "")), `${code} has English words: ${msg}`);
  }
  for (const [key, label] of Object.entries(FIELD_LABELS)) assert.match(label, PERSIAN, key);
});

test("validateRequest answers in Persian with a field-by-field map", async () => {
  let captured;
  validateRequest(auth.registerSchema)({ body: { username: 5, email: {}, password: [] } }, {}, (err) => { captured = err; });
  assert.equal(captured.statusCode, 400);
  assert.equal(captured.message, "داده‌های ارسالی نامعتبر هستند");
  for (const [k, v] of Object.entries(captured.errors)) assert.match(v, PERSIAN, `${k}: ${v}`);
  assert.ok(Object.keys(captured.errors).includes("username"));
});

test("unknown fields are dropped by the middleware, not echoed back", () => {
  let req = { body: { name: "علی", hacker: "x" } };
  validateRequest(Joi.object({ name: Joi.string() }))(req, {}, () => {});
  assert.deepEqual(req.validatedBody, { name: "علی" });
});
