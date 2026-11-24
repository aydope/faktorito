// Billing periods an owner can pick, in months. 0 = "doesn't extend the membership".
export const PERIOD_CHOICES = Object.freeze([0, 1, 2, 3, 4, 6, 12]);
// Auto-issue needs a real interval
export const INTERVAL_CHOICES = Object.freeze([1, 2, 3, 4, 6, 12]);

const LABELS = {
  0: "بدون تمدید اشتراک",
  1: "ماهانه",
  2: "2 ماهه",
  3: "3 ماهه",
  4: "4 ماهه",
  6: "6 ماهه",
  12: "سالانه",
};
export const periodLabel = (months) => LABELS[months] || `${months} ماهه`;
