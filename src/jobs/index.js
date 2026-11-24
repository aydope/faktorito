import { runExpiryReminders } from "./expiryReminders.js";
import { runAutoInvoices } from "./autoInvoices.js";

const MINUTE = 60 * 1000;

// Background jobs. Every job is idempotent, so several instances can run safely.
export const startJobs = () => {
  if (process.env.DISABLE_JOBS === "1") return () => {};

  const safe = (name, fn) => () =>
    fn().catch((err) => console.error(`${name} job failed:`, err.message));

  const jobs = [
    {
      run: safe("expiry", runExpiryReminders),
      first: 30 * 1000,
      every: 6 * 60 * MINUTE,
    },
    {
      run: safe("auto-invoice", runAutoInvoices),
      first: 45 * 1000,
      every: 10 * MINUTE,
    },
  ];

  const timers = jobs.flatMap((j) => {
    const first = setTimeout(j.run, j.first);
    const loop = setInterval(j.run, j.every);
    first.unref();
    loop.unref();
    return [first, loop];
  });

  return () => timers.forEach((t) => (clearTimeout(t), clearInterval(t)));
};
