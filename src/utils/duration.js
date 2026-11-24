/**
 * Plan durations are either calendar months ("month") or plain days ("day").
 * A value of 0 (or unit "none") means the plan does not extend a membership.
 * `durationDays` is the legacy field; it is used as a fallback for plans and
 * invoices created before units existed.
 */
export const UNITS = ["none", "day", "month"];
export const MAX_MONTHS = 60;
export const MAX_DAYS = 3650;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Normalises a plan / invoice-plan snapshot into { unit, value }. */
export const planDuration = (plan) => {
  if (!plan) return { unit: "none", value: 0 };
  const value = Number(plan.durationValue);
  if (plan.durationUnit && UNITS.includes(plan.durationUnit)) {
    if (plan.durationUnit === "none" || !(value > 0)) {
      // a stored unit without a value may still carry the legacy day count
      const legacy = Number(plan.durationDays) || 0;
      return plan.durationUnit === "none" || !legacy
        ? { unit: "none", value: 0 }
        : { unit: "day", value: legacy };
    }
    return { unit: plan.durationUnit, value: Math.floor(value) };
  }
  const days = Number(plan.durationDays) || 0;
  return days > 0 ? { unit: "day", value: days } : { unit: "none", value: 0 };
};

export const hasDuration = (d) => !!d && d.unit !== "none" && d.value > 0;

/** Approximate length in days (used for sorting / the legacy field only). */
export const toDays = (d) =>
  !hasDuration(d) ? 0 : d.unit === "month" ? d.value * 30 : d.value;

/**
 * Adds a duration to a date. Months are CALENDAR months in UTC and clamp the
 * day (31 Jan + 1 month = 28/29 Feb), so "monthly" really means monthly.
 * Accepts a plain number of days for backwards compatibility.
 */
export const addDuration = (from, duration) => {
  const start = new Date(from);
  const d =
    typeof duration === "number" ? { unit: "day", value: duration } : duration;
  if (!hasDuration(d)) return start;

  if (d.unit === "day") return new Date(start.getTime() + d.value * DAY_MS);

  const day = start.getUTCDate();
  const out = new Date(start.getTime());
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + d.value);
  const lastDay = new Date(
    Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0),
  ).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
};

/** Persian label: "1 ماهه", "3 ماهه", "45 روزه", "بدون انقضا". */
export const durationLabel = (d) => {
  if (!hasDuration(d)) return "بدون انقضا";
  const n = d.value.toLocaleString("fa-IR-u-nu-latn");
  return d.unit === "month" ? `${n} ماهه` : `${n} روزه`;
};

/** Validates the pair coming from a form. Returns { unit, value } or throws. */
export const parseDuration = (unit, value) => {
  if (!unit || unit === "none") return { unit: "none", value: 0 };
  const v = Number(value);
  const max = unit === "month" ? MAX_MONTHS : MAX_DAYS;
  if (!Number.isInteger(v) || v < 1 || v > max) {
    throw new RangeError(
      unit === "month"
        ? `مدت پلن بین 1 تا ${MAX_MONTHS} ماه باشد`
        : `مدت پلن بین 1 تا ${MAX_DAYS} روز باشد`,
    );
  }
  return { unit, value: v };
};
