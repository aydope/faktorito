import User from "../models/User.js";
import Member from "../models/Member.js";
import AppError from "../utils/AppError.js";
import { issueOtp, verifyOtp, OTP_TTL_MS } from "./otpService.js";
import { sendOtpMail, assertMailCapacity } from "./mailer.js";
import { clearUserSessions } from "../utils/session.js";
import AutoInvoice from "../models/AutoInvoice.js";
import { linkOnLogin } from "./membershipService.js";
import { disconnectUser, emitToStaff } from "../realtime/socket.js";

/** Issues a code and e-mails it. Throws if the mail can't be delivered or today's mail budget is used up. */
export const sendOtpEmail = async (user, purpose, { to, meta = "" } = {}) => {
  // no budget left: say so BEFORE a code is created (it could never be delivered)
  await assertMailCapacity();
  const { code } = await issueOtp(user._id, purpose, { meta });
  await sendOtpMail({
    to: to || user.email,
    purpose,
    code,
    minutes: Math.round(OTP_TTL_MS / 60000),
    username: user.username,
  });
};

export const maskEmail = (email = "") => {
  const [name = "", domain = ""] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
};

// ---------------------------------------------------------------------------
// member <-> account linking lives in membershipService (one club per account)
// ---------------------------------------------------------------------------
export const linkMemberAccounts = (user) => linkOnLogin(user);

// ---------------------------------------------------------------------------
// e-mail change: the new address must prove itself with a code first
// ---------------------------------------------------------------------------
export const startEmailChange = async (user, newEmail) => {
  const taken = await User.exists({ email: newEmail, _id: { $ne: user._id } });
  if (taken) {
    const err = AppError.conflict("این ایمیل قبلاً ثبت شده است");
    err.errors = { email: "این ایمیل قبلاً ثبت شده است" };
    throw err;
  }
  await User.updateOne({ _id: user._id }, { $set: { pendingEmail: newEmail } });
  await sendOtpEmail(user, "email_change", { to: newEmail, meta: newEmail });
};

export const confirmEmailChange = async (user, code) => {
  const newEmail = await verifyOtp(user._id, "email_change", code);
  if (!newEmail) throw AppError.badRequest("کد نامعتبر یا منقضی شده است");

  try {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          email: newEmail,
          pendingEmail: "",
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      },
    );
  } catch (err) {
    if (err.code === 11000)
      throw AppError.conflict("این ایمیل قبلاً ثبت شده است");
    throw err;
  }

  // An existing club membership belongs to the ACCOUNT and is kept. If the
  // person is in no club yet, the new verified address may match one now.
  if (user.role === "member") {
    await linkOnLogin({
      _id: user._id,
      role: "member",
      email: newEmail,
      emailVerified: true,
    });
  }
  return newEmail;
};

// ---------------------------------------------------------------------------
// account deletion: request -> deactivated -> staff review -> soft delete
// ---------------------------------------------------------------------------
export const requestAccountDeletion = async (user, reason = "") => {
  await User.updateOne(
    { _id: user._id, status: "active" },
    {
      $set: {
        status: "pending_deletion",
        deletionRequestedAt: new Date(),
        deletionReason: String(reason).slice(0, 300),
      },
    },
  );
  await clearUserSessions(user._id, user.username);
  disconnectUser(user._id);

  emitToStaff("deletion:requested", {
    id: String(user._id),
    username: user.username,
  });
};

export const cancelAccountDeletion = (userId) =>
  User.updateOne(
    { _id: userId, status: "pending_deletion" },
    {
      $set: { status: "active", deletionRequestedAt: null, deletionReason: "" },
    },
  );

/**
 * Soft delete: the account is anonymised and locked, but invoices, plans and
 * members are kept (financial history). Members of the business are soft
 * deleted too; nothing is removed from the database.
 */
export const softDeleteUser = async (userId, actorId = null) => {
  const user = await User.findById(userId).select("username email role").lean();
  if (!user) throw AppError.notFound("کاربر پیدا نشد");

  const now = new Date();
  const id = String(userId);

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        status: "deleted",
        deletedAt: now,
        deletedBy: actorId,
        // free the unique e-mail / username for future sign-ups
        email: `deleted+${id}@deleted.invalid`,
        username: `deleted_${id}`.slice(0, 32),
        pendingEmail: "",
        emailVerified: false,
        "signature.path": "",
      },
    },
    { runValidators: false },
  );

  await Promise.all([
    // the club's members are soft deleted and their accounts are freed to join another club
    Member.updateMany(
      { user: userId, deletedAt: null },
      {
        $set: {
          deletedAt: now,
          deletedBy: actorId,
          status: "inactive",
          account: null,
          unlinked: true,
        },
      },
    ),
    // a member account that is deleted leaves its club
    Member.updateMany(
      { account: userId },
      {
        $set: {
          account: null,
          unlinked: true,
          status: "inactive",
          leftAt: now,
        },
      },
      { withDeleted: true },
    ),
    AutoInvoice.updateMany({ user: userId }, { $set: { active: false } }),
    clearUserSessions(userId, user.username),
  ]);
  disconnectUser(userId);

  return user;
};
