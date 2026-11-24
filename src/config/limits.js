/**
 * Limits for business owners. They keep one account from abusing the service
 * (spam through e-mail/notifications, runaway data) and are listed on the
 * business terms page, so owners know them up front.
 */
const int = (names, fallback) => {
  for (const name of [].concat(names)) {
    const v = Number.parseInt(process.env[name], 10);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return fallback;
};

export const LIMITS = Object.freeze({
  members: int(["LIMIT_MEMBERS", "MAX_MEMBERS_PER_USER"], 500),
  plans: int("LIMIT_PLANS", 7),
  invoicesPerDay: int("LIMIT_INVOICES_PER_DAY", 200),
  unpaidInvoices: int(["LIMIT_UNPAID_INVOICES", "MAX_UNPAID_INVOICES"], 50),
  autoRules: int("LIMIT_AUTO_RULES", 100),
  announcementsPerDay: int("LIMIT_ANNOUNCEMENTS_PER_DAY", 5),
  memberAddsPerDay: int("LIMIT_MEMBER_ADDS_PER_DAY", 60),
});

export const LIMIT_LABELS = Object.freeze({
  members: "تعداد اعضا",
  plans: "تعداد پلن‌ها",
  invoicesPerDay: "فاکتور صادرشده در هر 24 ساعت",
  unpaidInvoices: "فاکتور پرداخت‌نشده هم‌زمان",
  autoRules: "تعداد صدور خودکار فعال",
  announcementsPerDay: "اعلان در هر 24 ساعت",
  memberAddsPerDay: "عضو جدید در هر 24 ساعت",
});

export const limitMessage = (key) =>
  `به سقف مجاز «${LIMIT_LABELS[key]}» (${LIMITS[key]}) رسیده‌اید`;
