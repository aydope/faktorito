import mongoose from "mongoose";
import Invoice from "../models/Invoice.js";

export const REPORT_RANGES = [7, 30, 90];
const TZ = process.env.REPORT_TIMEZONE || "Asia/Tehran";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every day of the range, oldest first, filled with zeros where nothing was sold. */
export const fillDays = (rows, days, now = new Date()) => {
  const byDay = new Map(rows.map((r) => [r._id, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    const r = byDay.get(key);
    out.push({ day: key, revenue: r?.revenue || 0, count: r?.count || 0 });
  }
  return out;
};

/** Sales numbers for the owner's reports page: daily revenue and revenue by plan. */
export const buildReport = async (userIdInput, days = 30) => {
  const userId = new mongoose.Types.ObjectId(String(userIdInput));
  const range = REPORT_RANGES.includes(days) ? days : 30;
  const since = new Date(Date.now() - range * DAY_MS);
  const match = { user: userId, isPaid: true, paidAt: { $gte: since } };

  const [daily, totals, extra, unpaid] = await Promise.all([
    Invoice.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$paidAt",
              timezone: TZ,
            },
          },
          revenue: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        },
      },
    ]),
    Invoice.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          revenue: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        },
      },
    ]),
    Invoice.aggregate([
      { $match: { ...match, "plan.name": { $ne: "" } } },
      {
        $group: {
          _id: "$plan.name",
          revenue: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 8 },
    ]),
    Invoice.aggregate([
      { $match: { user: userId, isPaid: false } },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalAmount" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const series = fillDays(daily, range);
  const today = series[series.length - 1];
  return {
    days: range,
    series,
    peak: Math.max(1, ...series.map((s) => s.revenue)),
    totalRevenue: totals[0]?.revenue || 0,
    totalCount: totals[0]?.count || 0,
    average: totals[0]?.count
      ? Math.round(totals[0].revenue / totals[0].count)
      : 0,
    today,
    unpaidTotal: unpaid[0]?.total || 0,
    unpaidCount: unpaid[0]?.count || 0,
    breakdown: extra.map((r) => ({
      name: r._id || "-",
      revenue: r.revenue,
      count: r.count,
    })),
    breakdownTitle: "درآمد به تفکیک پلن",
  };
};
