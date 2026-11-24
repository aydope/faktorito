import { Server } from "socket.io";
import User from "../models/User.js";
import { STAFF_ROLES } from "../config/permissions.js";

let io = null;

const allowedOrigins = () =>
  (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

/**
 * Socket.IO shares the Express session, so only logged-in, active users can
 * connect. Each user joins a private room (`user:<id>`); staff also join
 * `staff`. Nothing is broadcast globally.
 */
export const initSocket = (httpServer, sessionMiddleware) => {
  io = new Server(httpServer, {
    serveClient: true,
    maxHttpBufferSize: 1e4,
    pingInterval: 25000,
    pingTimeout: 20000,
    // Blocks cross-site WebSocket hijacking: Origin must match this host
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (!origin) return callback(null, true);
      try {
        const sameHost = new URL(origin).host === req.headers.host;
        callback(null, sameHost || allowedOrigins().includes(origin));
      } catch {
        callback(null, false);
      }
    },
  });

  io.engine.use(sessionMiddleware);

  io.use(async (socket, next) => {
    try {
      const sessionUser = socket.request.session?.user;
      if (!sessionUser) return next(new Error("unauthorized"));

      const user = await User.findById(sessionUser.id)
        .select("role status")
        .lean();
      if (!user || user.status !== "active")
        return next(new Error("unauthorized"));

      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      next();
    } catch (err) {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.userId}`);
    if (STAFF_ROLES.includes(socket.data.role)) socket.join("staff");
    socket.emit("ready", { userId: socket.data.userId });
  });

  return io;
};

export const emitToUser = (userId, event, payload) => {
  if (io && userId) io.to(`user:${String(userId)}`).emit(event, payload);
};

/**
 * "Something you are looking at changed": tells these users' open pages which
 * topics to refresh (invoices, members, dashboard, me, announcements, reports).
 * `emit` is injectable so the fan-out can be tested without a socket server.
 */
export const emitLive = (userIds, topics, emit = emitToUser) => {
  const payload = { topics: [].concat(topics), at: Date.now() };
  const ids = new Set([].concat(userIds).filter(Boolean).map(String));
  for (const id of ids) emit(id, "live", payload);
  return ids.size;
};

export const emitToStaff = (event, payload) => {
  if (io) io.to("staff").emit(event, payload);
};

/** Kicks every open socket of a user (suspension, deletion, password reset). */
export const disconnectUser = (userId) => {
  if (io) io.in(`user:${String(userId)}`).disconnectSockets(true);
};

// The HTTP server itself is closed by the graceful-shutdown helper.
export const closeSocket = () => {
  if (io) io.disconnectSockets(true);
};
