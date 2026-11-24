export const CURRENT_TERMS_VERSION = "1.0";
export const LEGAL_UPDATED = "16 مهر 1405";

export const getLegal = () => ({
  version: CURRENT_TERMS_VERSION,
  updated: LEGAL_UPDATED,
  appName: "فاکتوریتو",
  entity: process.env.LEGAL_ENTITY || "ارائه‌دهنده‌ی سرویس فاکتوریتو",
  contactEmail: process.env.CONTACT_EMAIL || "amin0xa1b@gmail.com",
  jurisdiction: process.env.LEGAL_JURISDICTION || "",
  retentionDays: Number.parseInt(process.env.RETENTION_DAYS, 10) || 365,
});
