import Notification from "../models/Notification.js";
import { emitToUser } from "../realtime/socket.js";

const serialize = (n) => ({
  id: String(n._id),
  type: n.type,
  title: n.title,
  body: n.body,
  url: n.url,
  readAt: n.readAt,
  createdAt: n.createdAt,
});

/** Stores a notification (so it's there after the next login) and pushes it live. */
export const notify = async (
  userId,
  { type = "system", title, body = "", url = "" },
) => {
  if (!userId) return null;
  const doc = await Notification.create({
    user: userId,
    type,
    title,
    body,
    url,
  });
  emitToUser(userId, "notification", serialize(doc));
  return doc;
};

/** Never lets a notification failure break the request that triggered it. */
export const notifySafe = (userId, payload) =>
  notify(userId, payload).catch((err) =>
    console.error("notify failed:", err.message),
  );

export const listNotifications = async (userId, limit = 20) => {
  const [items, unread] = await Promise.all([
    Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Notification.countDocuments({ user: userId, readAt: null }),
  ]);
  return { items: items.map(serialize), unread };
};

/**
 * Marks notifications as read: the given ids, or all of them when `ids` is null.
 * Returns the new unread count and tells the user's other tabs/devices.
 */
export const markRead = async (userId, ids = null) => {
  const list = ids === null ? null : [].concat(ids);
  const res = await Notification.updateMany(
    { user: userId, readAt: null, ...(list ? { _id: { $in: list } } : {}) },
    { $set: { readAt: new Date() } },
  );
  const unread = await Notification.countDocuments({
    user: userId,
    readAt: null,
  });
  if (res.modifiedCount > 0)
    emitToUser(userId, "notifications:read", {
      ids: list ? list.map(String) : null,
      unread,
    });
  return { marked: res.modifiedCount, unread };
};
