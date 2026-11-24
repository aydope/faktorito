import test from "node:test";
import assert from "node:assert/strict";

import Member from "../src/models/Member.js";
import { maskPhone } from "../src/services/memberService.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 1);

test("membership state: none / active / expiring / expired", () => {
  assert.equal(Member.computeMembershipState(null), "none");
  assert.equal(Member.computeMembershipState({ status: "active" }, NOW), "none");
  assert.equal(
    Member.computeMembershipState({ status: "active", membershipExpiresAt: new Date(NOW + 30 * DAY) }, NOW),
    "active",
  );
  assert.equal(
    Member.computeMembershipState({ status: "active", membershipExpiresAt: new Date(NOW + 3 * DAY) }, NOW),
    "expiring",
  );
  assert.equal(
    Member.computeMembershipState({ status: "active", membershipExpiresAt: new Date(NOW - DAY) }, NOW),
    "expired",
  );
});

test("frozen / inactive status wins over expiry date", () => {
  const future = new Date(NOW + 30 * DAY);
  assert.equal(Member.computeMembershipState({ status: "frozen", membershipExpiresAt: future }, NOW), "frozen");
  assert.equal(Member.computeMembershipState({ status: "inactive", membershipExpiresAt: future }, NOW), "inactive");
});

test("renewal after expiry starts from now", () => {
  const member = { membershipExpiresAt: new Date(NOW - 10 * DAY), membershipStartsAt: new Date(NOW - 40 * DAY) };
  const { startsAt, expiresAt } = Member.calculateRenewal(member, 30, NOW);
  assert.equal(startsAt.getTime(), NOW);
  assert.equal(expiresAt.getTime(), NOW + 30 * DAY);
});

test("early renewal stacks on remaining time", () => {
  const member = { membershipExpiresAt: new Date(NOW + 10 * DAY), membershipStartsAt: new Date(NOW - 20 * DAY) };
  const { startsAt, expiresAt } = Member.calculateRenewal(member, 30, NOW);
  assert.equal(startsAt.getTime(), NOW - 20 * DAY);
  assert.equal(expiresAt.getTime(), NOW + 40 * DAY);
});

test("first-ever membership starts from now", () => {
  const { expiresAt } = Member.calculateRenewal({}, 90, NOW);
  assert.equal(expiresAt.getTime(), NOW + 90 * DAY);
});

test("phone validation accepts 09xxxxxxxxx or empty only", async () => {
  const ok = async (phone) => {
    try {
      await new Member({ user: "507f1f77bcf86cd799439011", code: "M-0001", name: "Ali Test", phone }).validate();
      return true;
    } catch (err) {
      return !err.errors?.phone;
    }
  };
  assert.ok(await ok("09123456789"));
  assert.ok(await ok(""));
  assert.ok(!(await ok("9123456789")));
  assert.ok(!(await ok("0912345")));
});

test("maskPhone hides the middle digits", () => {
  assert.equal(maskPhone("09123456789"), "0912***6789");
  assert.equal(maskPhone("-"), "-");
});
