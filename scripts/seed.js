/**
 * Fills the database with a demo gym so the project can be shown off
 * (members in every membership state, paid / unpaid invoices, plans).
 *
 *   npm run seed
 *   login -> demo_gym / Demo@1234
 *
 * Refuses to run in production. Re-running recreates the demo account's data.
 */
import "dotenv/config";
import mongoose from "mongoose";

import User from "../src/models/User.js";
import Plan from "../src/models/Plan.js";
import Member from "../src/models/Member.js";
import Invoice from "../src/models/Invoice.js";
import Announcement from "../src/models/Announcement.js";
import AutoInvoice from "../src/models/AutoInvoice.js";
import { calculateTotals } from "../src/utils/helpers.js";
import { planSnapshot } from "../src/services/invoiceService.js";
import { addDuration } from "../src/utils/duration.js";

const DAY = 24 * 60 * 60 * 1000;
const DEMO_USERNAME = "demo_gym";
const DEMO_EMAIL = "demo@faktorito.local";
const DEMO_PASSWORD = "Demo@1234";
const DEMO_MEMBER_USERNAME = "demo_member";
const DEMO_MEMBER_EMAIL = "member@faktorito.local";

const FIRST = [
  "علی",
  "محمد",
  "رضا",
  "سارا",
  "مریم",
  "حسین",
  "نگار",
  "امیر",
  "زهرا",
  "پارسا",
  "الهام",
  "کیان",
];
const LAST = [
  "محمدی",
  "احمدی",
  "رضایی",
  "کریمی",
  "حسینی",
  "موسوی",
  "صادقی",
  "نظری",
  "اکبری",
  "جعفری",
];

const pick = (arr, i) => arr[i % arr.length];
const phone = (i) => `0912${String(1000000 + i * 7919).slice(-7)}`;
const today = () =>
  new Date().toLocaleDateString("fa-IR-u-nu-latn", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

(async () => {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed in production.");
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is required");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  // ---- demo owner (recreated so the script is repeatable) ----
  const old = await User.findOne({ username: DEMO_USERNAME }).select("_id");
  if (old) {
    await Promise.all([
      Invoice.deleteMany({ user: old._id }),
      Member.deleteMany({ user: old._id }, { withDeleted: true }),
      Plan.deleteMany({ user: old._id }),
      Announcement.deleteMany({ user: old._id }),
      AutoInvoice.deleteMany({ user: old._id }),
      User.deleteOne({ _id: old._id }),
    ]);
  }
  await User.deleteOne({ username: DEMO_MEMBER_USERNAME });

  const owner = await User.create({
    username: DEMO_USERNAME,
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    clubName: "باشگاه دمو",
    businessType: "gym",
    clubPhone: "09120000000",
    clubAddress: "تهران، خیابان نمونه",
    invoiceTheme: "luxe",
    termsAcceptedAt: new Date(),
    termsVersion: "1.0",
    businessTermsAcceptedAt: new Date(),
    businessTermsVersion: "1.0",
  });

  // ---- plans ----
  const plans = await Plan.insertMany(
    [
      { name: "ماهانه", price: 900000, description: "ورود نامحدود" },
      { name: "سه‌ماهه", price: 2400000, description: "10٪ تخفیف" },
      { name: "سالانه", price: 8500000, description: "بهترین قیمت" },
      { name: "جلسه‌ای", price: 150000, description: "یک جلسه" },
    ].map((p) => ({ ...p, user: owner._id })),
  );

  // ---- members in every state ----
  // offsets are days until expiry (negative = already expired, null = never subscribed)
  const offsets = [
    45,
    20,
    12,
    60,
    3,
    5,
    1,
    -3,
    -12,
    -30,
    null,
    25,
    8,
    -1,
    70,
    30,
    2,
    -20,
    null,
    90,
  ];
  let paidInvoices = 0;
  let unpaidInvoices = 0;

  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i];
    const plan = plans[i % 3];
    const months = [1, 3, 12][i % 3]; // the period lives on the invoice, plans have no duration
    const status = i === 18 ? "frozen" : "active";

    const member = await Member.create({
      user: owner._id,
      code: await Member.generateCode(owner._id),
      name: `${pick(FIRST, i)} ${pick(LAST, i * 3 + 1)}`,
      phone: phone(i),
      status,
      notes: i % 5 === 0 ? "علاقه‌مند به کلاس‌های گروهی" : "",
    });

    if (offset === null) continue;

    const expiresAt = new Date(Date.now() + offset * DAY);
    const startsAt = new Date(expiresAt.getTime() - months * 30 * DAY);
    const totals = calculateTotals(plan.price, [], []);

    await Invoice.create({
      user: owner._id,
      memberRef: member._id,
      invoiceNumber: await Invoice.generateInvoiceNumber(),
      trackingCode: Invoice.generateTrackingCode(),
      member: { name: member.name, phone: member.phone, memberId: member.code },
      plan: planSnapshot(plan, months),
      extraItems: [],
      totalAmount: totals.totalAmount,
      extraTotal: totals.extraTotal,
      isPaid: true,
      paidAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      invoiceDate: today(),
    });
    paidInvoices++;

    await Member.updateOne(
      { _id: member._id },
      {
        $set: {
          lastPlanName: plan.name,
          membershipStartsAt: startsAt,
          membershipExpiresAt: expiresAt,
          lastPaymentAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
          totalPaid: totals.totalAmount,
        },
      },
    );

    // every 4th member also has a pending invoice for extras (shake, water)
    if (i % 4 === 0) {
      const extras = calculateTotals(
        0,
        [
          { name: "پروتئین شیک", price: 120000 },
          { name: "آب معدنی", price: 20000 },
        ],
        [],
      );
      await Invoice.create({
        user: owner._id,
        memberRef: member._id,
        invoiceNumber: await Invoice.generateInvoiceNumber(),
        trackingCode: Invoice.generateTrackingCode(),
        member: {
          name: member.name,
          phone: member.phone,
          memberId: member.code,
        },
        plan: {
          name: "فروش متفرقه",
          price: 0,
          description: "",
          durationDays: 0,
        },
        extraItems: extras.extraItems,
        totalAmount: extras.totalAmount,
        extraTotal: extras.extraTotal,
        invoiceDate: today(),
      });
      unpaidInvoices++;
    }
  }

  // ---- an ordinary account that belongs to the gym (see /me), an announcement, an auto-issue rule ----
  const demoMember = await Member.findOne({
    user: owner._id,
    membershipExpiresAt: { $gt: new Date() },
  }).sort({ code: 1 });
  if (demoMember) {
    const account = await User.create({
      username: DEMO_MEMBER_USERNAME,
      email: DEMO_MEMBER_EMAIL,
      password: DEMO_PASSWORD,
      role: "member",
      emailVerified: true,
      emailVerifiedAt: new Date(),
    });
    await Member.updateOne(
      { _id: demoMember._id },
      { $set: { account: account._id, email: DEMO_MEMBER_EMAIL } },
    );

    await AutoInvoice.create({
      user: owner._id,
      member: demoMember._id,
      plan: plans[0]._id,
      intervalMonths: 1,
      nextIssueAt: addDuration(new Date(), { unit: "month", value: 1 }),
      anchorAt: addDuration(new Date(), { unit: "month", value: 1 }),
    });
  }
  await Announcement.create({
    user: owner._id,
    title: "ساعت کاری ایام تعطیل",
    body: "فردا باشگاه از ساعت 10 تا 18 باز است.",
    expiresAt: new Date(Date.now() + DAY),
  });

  console.log(
    `Seeded demo gym: ${offsets.length} members, ${paidInvoices} paid + ${unpaidInvoices} unpaid invoices.`,
  );
  console.log(`Business login -> ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`Member login   -> ${DEMO_MEMBER_EMAIL} / ${DEMO_PASSWORD}`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
