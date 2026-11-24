/**
 * Single source of truth for roles and permissions.
 *
 *   member     -> a gym member; only sees their own panel (/me)
 *   owner      -> a business owner; manages members, plans, invoices
 *   admin      -> staff: reviews users / invoices, can suspend owners & members
 *   moderator  -> senior staff ("مدیر ارشد"): everything admin can do + roles,
 *                 deleting users/invoices/plans. Never assignable from the UI.
 *
 * (The old code had a hierarchy table that contradicted its own checks:
 *  `admin: 3, moderator: 2` while moderators were the ones with more power.)
 */
export const ROLES = ["member", "owner", "admin", "moderator"];

export const ROLE_LEVEL = { member: 0, owner: 1, admin: 2, moderator: 3 };

export const ROLE_LABEL = {
  member: "عضو",
  owner: "صاحب کسب‌وکار",
  admin: "ادمین",
  moderator: "مدیر ارشد",
};

export const STAFF_ROLES = ["admin", "moderator"];
export const BUSINESS_ROLES = ["owner", "admin", "moderator"];
export const SELF_SIGNUP_ROLES = ["member", "owner"];
export const ASSIGNABLE_ROLES = ["member", "owner", "admin"];

const MATRIX = {
  "admin:access": STAFF_ROLES,
  "users:status": STAFF_ROLES,
  "users:role": ["moderator"],
  "users:delete": ["moderator"],
  "deletions:review": STAFF_ROLES,
  "invoices:delete": ["moderator"],
  "plans:view": STAFF_ROLES,
};

export const can = (role, permission) =>
  MATRIX[permission]?.includes(role) ?? false;

/** An actor may only act on users who are strictly below them. */
export const outranks = (actorRole, targetRole) =>
  (ROLE_LEVEL[actorRole] ?? -1) > (ROLE_LEVEL[targetRole] ?? 99);

export const homeFor = (role) => {
  if (role === "member") return "/me";
  if (STAFF_ROLES.includes(role)) return "/admin/dashboard";
  return "/dashboard";
};
