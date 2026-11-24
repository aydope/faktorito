const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_FREEZE_DAYS = 180;

/**
 * Gym feature: freezing a membership. While a member is frozen the clock
 * keeps running, so on unfreeze the frozen days are ADDED BACK to the expiry
 * date (at most MAX_FREEZE_DAYS, so a forgotten freeze can't hand out years).
 */
export const frozenDays = (frozenAt, now = new Date()) => {
  if (!frozenAt) return 0;
  const ms = now.getTime() - new Date(frozenAt).getTime();
  if (ms <= 0) return 0;
  return Math.min(MAX_FREEZE_DAYS, Math.ceil(ms / DAY_MS));
};

/**
 * What to `$set` when a member's status changes. Returns {} when nothing
 * freeze-related happens. `current` needs: status, frozenAt, membershipExpiresAt.
 */
export const statusTransition = (current, nextStatus, now = new Date()) => {
  if (!current || nextStatus === undefined || nextStatus === current.status)
    return {};

  if (nextStatus === "frozen") return { frozenAt: now };

  if (current.status === "frozen") {
    const set = { frozenAt: null };
    const days = frozenDays(current.frozenAt, now);
    if (days > 0 && current.membershipExpiresAt) {
      set.membershipExpiresAt = new Date(
        new Date(current.membershipExpiresAt).getTime() + days * DAY_MS,
      );
    }
    return set;
  }
  return {};
};
