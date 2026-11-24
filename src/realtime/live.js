import Member from "../models/Member.js";
import { emitLive } from "./socket.js";

/**
 * Which open pages must refresh after a business event. Everything here is
 * fire-and-forget: a failed push must never break the request that caused it.
 */
const safe = (fn) => {
  try {
    fn();
  } catch (err) {
    console.error("live emit failed:", err.message);
  }
};

/** An invoice was created, changed, paid or deleted. */
export const emitInvoiceLive = (invoice, member = null) =>
  safe(() => {
    emitLive(invoice.user, [
      "invoices",
      "dashboard",
      "reports",
      ...(member ? ["members"] : []),
    ]);
    if (member?.account) emitLive(member.account, ["me"]);
  });

/** A member was added, edited, frozen, deleted, restored, linked or left. */
export const emitMemberLive = (ownerId, member = null) =>
  safe(() => {
    emitLive(ownerId, ["members", "dashboard"]);
    if (member?.account) emitLive(member.account, ["me"]);
  });

/** Announcements changed: the owner's list and every member's panel. */
export const emitAnnouncementLive = async (ownerId) => {
  try {
    emitLive(ownerId, ["announcements"]);
    const members = await Member.find({ user: ownerId, account: { $ne: null } })
      .select("account")
      .lean();
    emitLive(
      members.map((m) => m.account),
      ["me"],
    );
  } catch (err) {
    console.error("live emit failed:", err.message);
  }
};

/**
 * Router-level hook: after a SUCCESSFUL write (POST/PUT/PATCH/DELETE) run `fn(req)`
 * in the background. One line per router instead of an emit in every handler.
 */
export const liveAfterMutation = (fn) => (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  res.on("finish", () => {
    if (res.statusCode < 400)
      Promise.resolve(fn(req)).catch((err) =>
        console.error("live emit failed:", err.message),
      );
  });
  next();
};

const idFromUrl = (req, collection) =>
  req.originalUrl.match(
    new RegExp(`/${collection}/([a-f0-9]{24})`, "i"),
  )?.[1] || null;

/** members router: refresh the owner's pages and, when the record has an account, that member's panel. */
export const memberMutationLive = async (req) => {
  const ownerId = req.session?.user?.id;
  if (!ownerId) return;
  const id = idFromUrl(req, "members");
  const member = id
    ? await Member.findById(id)
        .setOptions({ withDeleted: true })
        .select("account")
        .lean()
    : null;
  emitMemberLive(ownerId, member);
};
