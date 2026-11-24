import User from "../models/User.js";
import Member from "../models/Member.js";
import AppError from "../utils/AppError.js";
import { emitMemberLive } from "../realtime/live.js";
import { notifySafe } from "./notificationService.js";

/**
 * One account can belong to ONE club at a time. The rule is enforced by a
 * partial unique index on Member.account, so two clubs adding the same person
 * at the same moment cannot both win. A person leaves by pressing "leave" in
 * their own panel, or the club removes them (soft delete). Both free the account.
 */
export const BUSY_MESSAGE =
  "این کاربر هم‌اکنون عضو یک باشگاه دیگر است. تا زمانی که از آن باشگاه خارج نشود قابل افزودن نیست";

export const getMembership = (accountId) =>
  Member.findOne({ account: accountId })
    .select(
      "user name code status lastPlanName membershipStartsAt membershipExpiresAt totalPaid createdAt",
    )
    .populate("user", "clubName clubPhone clubAddress")
    .lean({ virtuals: true });

export const isInAnyClub = async (accountId) =>
  !!(await Member.exists({ account: accountId }));

export const OWNER_EMAIL_MESSAGE =
  "این ایمیل متعلق به صاحب یک کسب‌وکار (یا مدیر سیستم) است و نمی‌تواند عضو باشگاه شود";
export const MEMBER_CANT_OWN_MESSAGE =
  "شما هم‌اکنون عضو یک باشگاه هستید. ابتدا از آن خارج شوید، سپس کسب‌وکار خود را بسازید";

/** The verified member account that owns this e-mail, if any. */
export const findLinkableAccount = (email) =>
  email
    ? User.findOne({
        email,
        role: "member",
        emailVerified: true,
        status: "active",
      })
        .select("_id username")
        .lean()
    : null;

const duplicateAccount = (err) =>
  err?.code === 11000 &&
  (err.keyPattern?.account || /account/.test(err.message || ""));

/**
 * Before adding a member by e-mail: if that e-mail belongs to a member account
 * that already sits in a club, adding is refused (409).
 * Returns the account to attach (or null for a walk-in without an account).
 */
export const resolveAccountForNewMember = async (
  email,
  { ignoreMemberId = null } = {},
) => {
  if (!email) return null;

  // a business owner (or staff) is never a member of a club
  const staff = await User.exists({
    email,
    role: { $ne: "member" },
    status: { $nin: ["deleted"] },
  });
  if (staff) {
    const err = AppError.conflict(OWNER_EMAIL_MESSAGE);
    err.errors = { email: OWNER_EMAIL_MESSAGE };
    throw err;
  }

  const account = await findLinkableAccount(email);
  if (!account) return null;

  const filter = { account: account._id };
  if (ignoreMemberId) filter._id = { $ne: ignoreMemberId };
  if (await Member.exists(filter)) {
    const err = AppError.conflict(BUSY_MESSAGE);
    err.errors = { email: BUSY_MESSAGE };
    throw err;
  }
  return account;
};

/**
 * Atomically attaches an account; false if the account got busy in the meantime.
 * It also re-checks the role AFTER attaching: if the person became a business
 * owner while this ran, the link is undone (see createBusiness, which checks
 * for a membership AFTER promoting - one of the two always notices).
 */
export const attachAccount = async (memberId, accountId) => {
  try {
    const res = await Member.updateOne(
      { _id: memberId, account: null },
      { $set: { account: accountId, unlinked: false, leftAt: null } },
    );
    if (res.modifiedCount !== 1) return false;

    const still = await User.exists({
      _id: accountId,
      role: "member",
      status: "active",
    });
    if (!still) {
      await Member.updateOne(
        { _id: memberId, account: accountId },
        { $set: { account: null } },
      );
      return false;
    }
    return true;
  } catch (err) {
    if (duplicateAccount(err)) return false;
    throw err;
  }
};

/** Tells the person (live + stored) that a club added them. */
export const announceJoin = async (member, clubName) => {
  if (!member.account) return;
  await notifySafe(member.account, {
    type: "membership",
    title: `شما عضو «${clubName || "یک باشگاه"}» شدید`,
    body: "اطلاعات عضویت و فاکتورهای شما در پنل شما نمایش داده می‌شود",
    url: "/me",
  });
};

/**
 * After a member is created / its e-mail changed: link the matching account.
 * Returns "linked" | "busy" | "none".
 */
export const linkByEmail = async (member, clubName) => {
  if (!member.email) return "none";
  const account = await findLinkableAccount(member.email);
  if (!account) return "none";
  const ok = await attachAccount(member._id, account._id);
  if (!ok) return "busy";
  await announceJoin({ account: account._id }, clubName);
  return "linked";
};

/**
 * At login: an account that is not in any club picks up the OLDEST member
 * record that was added with its (now verified) e-mail.
 */
export const linkOnLogin = async (user) => {
  if (user.role !== "member" || !user.emailVerified) return null;
  if (await isInAnyClub(user._id)) return null;

  const candidate = await Member.findOne({
    email: user.email,
    account: null,
    unlinked: { $ne: true },
  })
    .sort({ createdAt: 1 })
    .select("_id user")
    .lean();
  if (!candidate) return null;

  const ok = await attachAccount(candidate._id, user._id);
  if (!ok) return null;

  const owner = await User.findById(candidate.user).select("clubName").lean();
  await announceJoin({ account: user._id }, owner?.clubName);
  return candidate._id;
};

/** The member presses "leave club". The club keeps the record (inactive). */
export const leaveClub = async (accountId) => {
  const member = await Member.findOneAndUpdate(
    { account: accountId },
    {
      $set: {
        account: null,
        unlinked: true,
        status: "inactive",
        leftAt: new Date(),
      },
    },
    { returnDocument: "before", projection: "user name" },
  ).lean();
  if (!member) throw AppError.badRequest("شما عضو هیچ باشگاهی نیستید");

  emitMemberLive(member.user, member);
  await notifySafe(member.user, {
    type: "membership",
    title: "یک عضو از باشگاه خارج شد",
    body: `«${member.name}» خودش از باشگاه خارج شد`,
    url: `/members/${member._id}`,
  });
  return member;
};
