import User from "../models/User.js";
import { notifySafe } from "./notificationService.js";
import { emitInvoiceLive } from "../realtime/live.js";

const clubNameOf = async (userId) =>
  (await User.findById(userId).select("clubName").lean())?.clubName || "باشگاه";

/**
 * Tells the member about a new invoice with a live Socket.IO push + a stored
 * notification (when they have an account). No e-mail: the only mail this
 * service sends is the one-time code. Runs in the background; failures are only logged.
 */
export const announceInvoiceIssued = ({ invoice, member }) => {
  emitInvoiceLive(invoice, member); // open pages refresh (also for walk-in invoices)
  if (!member) return;

  (async () => {
    const clubName = await clubNameOf(invoice.user);

    if (member.account) {
      await notifySafe(member.account, {
        type: "invoice",
        title: `فاکتور جدید از ${clubName}`,
        body: `${invoice.invoiceNumber}، ${invoice.totalAmount.toLocaleString("fa-IR-u-nu-latn")} تومان`,
        url: invoice.publicId ? `/i/${invoice.publicId}` : "/me",
      });
    }
  })().catch((err) =>
    console.error("announceInvoiceIssued failed:", err.message),
  );
};

export const announcePayment = ({ invoice, member }) => {
  emitInvoiceLive(invoice, member);
  if (!member?.account) return;

  (async () => {
    const clubName = await clubNameOf(invoice.user);
    await notifySafe(member.account, {
      type: "payment",
      title: "پرداخت شما ثبت شد",
      body: member.membershipExpiresAt
        ? `اشتراک شما در ${clubName} تمدید شد`
        : `پرداخت فاکتور ${invoice.invoiceNumber} در ${clubName} ثبت شد`,
      url: "/me",
    });
  })().catch((err) => console.error("announcePayment failed:", err.message));
};
