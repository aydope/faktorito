import ejs from "ejs";
import path from "node:path";

import { sampleSheet, THEMES } from "../../src/utils/invoiceSheet.js";
import { renderAvatar } from "../../src/utils/avatar.js";
import { getLegal } from "../../src/config/legal.js";
import { LIMITS, LIMIT_LABELS } from "../../src/config/limits.js";

/**
 * STRICT render of the pages with realistic data (no "any variable exists" tricks):
 * a template that reads something the route doesn't pass fails here, instead of
 * showing a 500 to a user. Locals mirror what the routes pass.
 */
export const dir = path.resolve("views");
export const render = (view, locals) => ejs.renderFile(path.join(dir, `${view}.ejs`), locals, { views: [dir] });

const owner = {
  id: "507f1f77bcf86cd799439011", _id: "507f1f77bcf86cd799439011", username: "ali", email: "a@x.com",
  clubName: "باشگاه آیدا", role: "owner", invoiceTheme: "luxe", emailVerified: true,
  signature: { path: "M 1 1 L 5 5", color: "#111827", signerName: "م", position: "right" },
};
const plan = { _id: "p1", name: "ماهانه", price: 900000, description: "d", isActive: true };
const member = {
  _id: "m1", name: "علی رضایی", code: "M-0001", status: "active", phone: "09123456789", email: "m@x.com",
  membershipExpiresAt: new Date(Date.now() + 5 * 864e5), membershipStartsAt: new Date(), totalPaid: 1,
  createdAt: new Date(), state: "active", daysLeft: 5, lastPlanName: "ماهانه",
};
export const base = { title: "t", path: "/", active: "x", user: owner, csrfToken: "" };
const sheet = await sampleSheet({ theme: "luxe" });
const usage = Object.keys(LIMITS).map((k) => ({ key: k, label: LIMIT_LABELS[k], used: 3, max: LIMITS[k] }));

export const CASES = {
  settings: { user: { ...owner, clubPhone: "", clubAddress: "", clubEmail: "", clubCode: "" }, themes: THEMES, avatarHtml: renderAvatar("x", "c"), usage, hasSignature: true },
  "member-detail": { member, autoRule: null, plans: [plan], invoices: [], unpaidTotal: 0 },
  "member-detail (frozen)": { member: { ...member, status: "frozen", frozenAt: new Date() }, autoRule: { _id: "r1", active: true, plan, intervalMonths: 3, nextIssueAt: new Date(), note: "" }, plans: [plan], invoices: [], unpaidTotal: 0 },
  "me/dashboard": { membership: { ...member, user: { _id: "o", clubName: "باشگاه" } }, invoices: [], announcements: [], unpaidTotal: 0, user: { ...owner, role: "member" } },
  "me/dashboard (no club)": { membership: null, invoices: [], announcements: [], unpaidTotal: 0, user: { ...owner, role: "member" } },
  "gym/create": { inClub: false, user: { ...owner, role: "member" } },
  "gym/create (in a club)": { inClub: true, user: { ...owner, role: "member" } },
  "create-invoice": { plans: [plan], members: [], recentMembers: [] },
  plans: { plans: [plan] },
  reports: {
    report: {
      days: 30, series: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, revenue: i * 1000, count: 1 })),
      peak: 29000, totalRevenue: 1, totalCount: 1, average: 1, today: { day: "2026-09-30", revenue: 0, count: 0 },
      unpaidTotal: 0, unpaidCount: 0, breakdown: [{ name: "ماهانه", revenue: 5, count: 1 }], breakdownTitle: "درآمد به تفکیک پلن",
    },
  },
  index: { sheet, themes: THEMES, user: null },
  "public-invoice": { sheet, isOwner: false, user: null },
  "invoice-preview": { sheet },
  "legal/terms": { legal: getLegal() },
  "legal/privacy": { legal: getLegal() },
  "legal/business-terms": { legal: getLegal(), limits: Object.keys(LIMITS).map((k) => ({ label: LIMIT_LABELS[k], max: LIMITS[k] })) },
  error: { statusCode: 500, message: "x", errorId: "AB12CD34", retryAfter: null, isLoggedIn: false, homeHref: "/" },
  "404": { statusCode: 404, message: "x", errorId: null, retryAfter: null, isLoggedIn: false, homeHref: "/" },
  "error (404)": { statusCode: 404, message: "x", errorId: null, retryAfter: null, isLoggedIn: true, homeHref: "/dashboard" },
};
