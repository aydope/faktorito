import User from "../models/User.js";
import Plan from "../models/Plan.js";
import Member from "../models/Member.js";
import AutoInvoice from "../models/AutoInvoice.js";
import Invoice from "../models/Invoice.js";

/**
 * Idempotent upgrade steps that run on boot, so deploying a new version over
 * an existing database needs no manual script.
 */
export const runMigrations = async () => {
  const log = [];

  // old "user" role -> "owner"
  const roles = await User.updateMany(
    { role: "user" },
    { $set: { role: "owner" } },
    { strict: false },
  );
  if (roles.modifiedCount) log.push(`${roles.modifiedCount} roles renamed`);

  // accounts created before e-mail verification existed stay usable
  const verified = await User.updateMany(
    { emailVerified: { $exists: false } },
    { $set: { emailVerified: true, emailVerifiedAt: new Date() } },
  );
  if (verified.modifiedCount)
    log.push(`${verified.modifiedCount} legacy accounts marked verified`);

  // image uploads are gone: the badge is designed, the signature is drawn
  const legacy = await User.collection.updateMany(
    {
      $or: [
        { logo: { $exists: true } },
        { logoRatio: { $exists: true } },
        { logoFit: { $exists: true } },
        { "signature.data": { $exists: true } },
      ],
    },
    { $unset: { logo: "", logoRatio: "", logoFit: "", "signature.data": "" } },
  );
  if (legacy.modifiedCount)
    log.push(`${legacy.modifiedCount} accounts lost legacy image fields`);

  // gyms only: drop the business type, the cafe loyalty/counter-sale fields and the cafe theme/item type
  const noType = await User.collection.updateMany(
    { businessType: { $exists: true } },
    { $unset: { businessType: "" } },
  );
  const noCafeTheme = await User.collection.updateMany(
    { invoiceTheme: "cafe" },
    { $set: { invoiceTheme: "aurora" } },
  );
  const cleaned = Math.max(noType.modifiedCount, noCafeTheme.modifiedCount);
  if (cleaned)
    log.push(
      `${noType.modifiedCount + noCafeTheme.modifiedCount} account fields cleaned of cafe settings`,
    );
  const cafeMembers = await Member.collection.updateMany(
    {
      $or: [
        { loyaltyStamps: { $exists: true } },
        { rewardsRedeemed: { $exists: true } },
      ],
    },
    { $unset: { loyaltyStamps: "", rewardsRedeemed: "" } },
  );
  if (cafeMembers.modifiedCount)
    log.push(`${cafeMembers.modifiedCount} members lost loyalty fields`);
  const cafeInvoices = await Invoice.collection.updateMany(
    { "extraItems.type": "cafe" },
    { $set: { "extraItems.$[e].type": "item" } },
    { arrayFilters: [{ "e.type": "cafe" }] },
  );
  if (cafeInvoices.modifiedCount)
    log.push(`${cafeInvoices.modifiedCount} invoices: extra items renamed`);
  await Invoice.collection.updateMany(
    { isPos: { $exists: true } },
    { $unset: { isPos: "" } },
  );

  // no brand designer any more: every owner gets a generated SVG avatar
  const brands = await User.collection.updateMany(
    { brand: { $exists: true } },
    { $unset: { brand: "" } },
  );
  if (brands.modifiedCount)
    log.push(`${brands.modifiedCount} accounts lost the legacy brand settings`);

  // plans have no duration any more (the period lives on the invoice / auto-issue rule)
  const plans = await Plan.collection.updateMany(
    {
      $or: [
        { durationUnit: { $exists: true } },
        { durationValue: { $exists: true } },
        { durationDays: { $exists: true } },
      ],
    },
    { $unset: { durationUnit: "", durationValue: "", durationDays: "" } },
  );
  if (plans.modifiedCount)
    log.push(`${plans.modifiedCount} plans lost their legacy duration`);

  // auto-issue rules used to take their interval from the plan: default them to monthly
  const rules = await AutoInvoice.collection.updateMany(
    { intervalMonths: { $exists: false } },
    { $set: { intervalMonths: 1 } },
  );
  if (rules.modifiedCount)
    log.push(`${rules.modifiedCount} auto-issue rules got a monthly interval`);

  // one account = one club. Older data could link an account to several clubs:
  // keep the oldest link, release the others, THEN build the unique index.
  const dupes = await Member.collection
    .aggregate([
      { $match: { account: { $type: "objectId" } } },
      { $sort: { createdAt: 1 } },
      { $group: { _id: "$account", ids: { $push: "$_id" }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();
  let released = 0;
  for (const d of dupes) {
    const res = await Member.collection.updateMany(
      { _id: { $in: d.ids.slice(1) } },
      { $set: { account: null, unlinked: true } },
    );
    released += res.modifiedCount;
  }
  if (released) log.push(`${released} extra club links released`);

  try {
    await Member.createIndexes();
  } catch (err) {
    console.error("Member index build failed:", err.message);
  }

  if (log.length) console.log(`Migration: ${log.join(", ")}`);
};
