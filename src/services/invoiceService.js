import Invoice from "../models/Invoice.js";
import { toDays } from "../utils/duration.js";
import { PERIOD_CHOICES } from "../utils/period.js";
import { announceInvoiceIssued } from "./invoiceNotifier.js";

/**
 * The copy of a plan stored on an invoice (later plan edits never change it).
 * A plan has NO duration: `periodMonths` is how long paying THIS invoice extends
 * the membership (0 = it doesn't, e.g. a single session or a sale of extras).
 */
export const planSnapshot = (plan, periodMonths = 0) => {
  const months = PERIOD_CHOICES.includes(Number(periodMonths))
    ? Number(periodMonths)
    : 0;
  const d =
    months > 0 ? { unit: "month", value: months } : { unit: "none", value: 0 };
  return {
    planRef: plan._id,
    name: plan.name,
    price: plan.price,
    description: plan.description || "",
    durationUnit: d.unit,
    durationValue: d.value,
    durationDays: toDays(d),
  };
};

const persianDate = () =>
  new Date().toLocaleDateString("fa-IR-u-nu-latn", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

/**
 * Issues an UNPAID invoice for one plan to one member (used by auto-issue and
 * by "issue now"). The member is notified live and by e-mail.
 */
export const issuePlanInvoice = async ({
  ownerId,
  member,
  plan,
  periodMonths = 0,
  note = "",
  autoIssued = false,
}) => {
  const [invoiceNumber, trackingCode] = await Promise.all([
    Invoice.generateInvoiceNumber(),
    Promise.resolve(Invoice.generateTrackingCode()),
  ]);

  const invoice = await Invoice.create({
    user: ownerId,
    memberRef: member._id,
    invoiceNumber,
    trackingCode,
    member: {
      name: member.name,
      phone: member.phone || "-",
      memberId: member.code || "-",
    },
    plan: planSnapshot(plan, periodMonths),
    extraItems: [],
    note,
    totalAmount: Math.max(0, plan.price),
    extraTotal: 0,
    autoIssued,
    invoiceDate: persianDate(),
  });

  announceInvoiceIssued({ invoice, member });
  return invoice;
};
