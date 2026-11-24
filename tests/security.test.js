import test from "node:test";
import assert from "node:assert/strict";

import { can, outranks, homeFor, ROLE_LEVEL, ASSIGNABLE_ROLES } from "../src/config/permissions.js";
import { generateCode, hashCode } from "../src/services/otpService.js";
import { excludeDeleted } from "../src/models/Member.js";

test("role hierarchy: moderator > admin > owner > member", () => {
  assert.ok(ROLE_LEVEL.moderator > ROLE_LEVEL.admin);
  assert.ok(ROLE_LEVEL.admin > ROLE_LEVEL.owner);
  assert.ok(ROLE_LEVEL.owner > ROLE_LEVEL.member);
});

test("outranks: nobody acts on a peer or a senior", () => {
  assert.ok(outranks("moderator", "admin"));
  assert.ok(outranks("admin", "owner"));
  assert.ok(!outranks("admin", "admin"));
  assert.ok(!outranks("admin", "moderator"));
  assert.ok(!outranks("owner", "admin"));
  // an unknown target role is treated as the most senior one (fail closed)
  assert.ok(!outranks("admin", "unknown-role"));
  assert.ok(!outranks("unknown-role", "member"));
});

test("permissions: admins can suspend but not change roles or delete", () => {
  assert.ok(can("admin", "users:status"));
  assert.ok(can("admin", "deletions:review"));
  assert.ok(!can("admin", "users:role"));
  assert.ok(!can("admin", "users:delete"));
  assert.ok(!can("admin", "invoices:delete"));
  assert.ok(can("moderator", "users:role"));
  assert.ok(can("moderator", "invoices:delete"));
  assert.ok(!can("owner", "admin:access"));
  assert.ok(!can("member", "users:status"));
});

test("moderator can never be granted from the UI", () => {
  assert.ok(!ASSIGNABLE_ROLES.includes("moderator"));
});

test("each role lands in its own panel", () => {
  assert.equal(homeFor("member"), "/me");
  assert.equal(homeFor("owner"), "/dashboard");
  assert.equal(homeFor("admin"), "/admin/dashboard");
  assert.equal(homeFor("moderator"), "/admin/dashboard");
});

test("OTP: 6 digits, hash bound to user + purpose + code", () => {
  for (let i = 0; i < 200; i++) assert.match(generateCode(), /^\d{6}$/);
  const h = hashCode("u1", "verify", "123456");
  assert.equal(h, hashCode("u1", "verify", "123456"));
  assert.notEqual(h, hashCode("u2", "verify", "123456"));
  assert.notEqual(h, hashCode("u1", "reset", "123456"));
  assert.notEqual(h, hashCode("u1", "verify", "654321"));
});

const fakeQuery = (filter, options = {}) => {
  const q = { filter, options, added: null };
  q.getFilter = () => q.filter;
  q.getOptions = () => q.options;
  q.where = (c) => { q.added = c; };
  return q;
};

test("soft delete hook hides deleted members by default", () => {
  const q = fakeQuery({ user: "u1" });
  excludeDeleted.call(q);
  assert.deepEqual(q.added, { deletedAt: null });
});

test("soft delete hook lets the trash view / restore opt out", () => {
  const trash = fakeQuery({ user: "u1", deletedAt: { $ne: null } });
  excludeDeleted.call(trash);
  assert.equal(trash.added, null);

  const withDeleted = fakeQuery({ user: "u1" }, { withDeleted: true });
  excludeDeleted.call(withDeleted);
  assert.equal(withDeleted.added, null);
});

import { otpEmail, esc } from "../src/emails/templates.js";

test("OTP e-mail escapes user-controlled text (HTML injection)", () => {
  assert.equal(esc(`<img src=x onerror=alert(1)>`), "&lt;img src=x onerror=alert(1)&gt;");
  const mail = otpEmail({ purpose: "verify", code: "123456", minutes: 10, username: "<script>1</script>" });
  assert.ok(!mail.html.includes("<script>1</script>"));
});

test("OTP e-mail contains the code and a subject", () => {
  const mail = otpEmail({ purpose: "verify", code: "123456", minutes: 10, username: "ali" });
  assert.ok(mail.subject);
  assert.ok(mail.html.includes("123456"));
  assert.ok(mail.text.includes("123456"));
});
