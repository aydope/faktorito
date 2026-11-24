import Member from "../models/Member.js";
import { notifySafe } from "../services/notificationService.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMIND_DAYS = 3;

/**
 * Reminds members whose subscription ends within REMIND_DAYS. Safe to run from
 * several instances: each member is "claimed" atomically per expiry date.
 */
export const runExpiryReminders = async () => {
  const now = new Date();
  const soon = new Date(now.getTime() + REMIND_DAYS * DAY_MS);

  const candidates = await Member.find({
    status: "active",
    membershipExpiresAt: { $gte: now, $lte: soon },
    account: { $ne: null }, // reminders are in-app only (no e-mail)
  })
    .select("_id membershipExpiresAt")
    .limit(500)
    .lean();

  let sent = 0;
  for (const c of candidates) {
    const member = await Member.findOneAndUpdate(
      {
        _id: c._id,
        membershipExpiresAt: c.membershipExpiresAt,
        lastReminderFor: { $ne: c.membershipExpiresAt },
      },
      { $set: { lastReminderFor: c.membershipExpiresAt } },
      { returnDocument: "after" },
    ).populate("user", "clubName");
    if (!member) continue; // somebody else already reminded them

    const daysLeft = Math.max(
      1,
      Math.ceil((member.membershipExpiresAt - now) / DAY_MS),
    );
    const clubName = member.user?.clubName || "باشگاه";

    if (member.account) {
      notifySafe(member.account, {
        type: "membership",
        title: "اشتراک شما رو به پایان است",
        body: `${daysLeft} روز تا پایان اشتراک شما در ${clubName} باقی مانده است`,
        url: "/me",
      });
    }
    sent++;
  }
  return sent;
};
