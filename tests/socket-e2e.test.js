import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import session from "express-session";
import { io as connect } from "socket.io-client";

import User from "../src/models/User.js";
import configureSession from "../src/config/session.js";
import { initSocket, emitToUser, emitLive } from "../src/realtime/socket.js";

/**
 * END TO END over real sockets: a real HTTP server, the real session middleware, the real
 * Socket.IO server and a real client. Only the user lookup is stubbed (no database here).
 */
process.env.SESSION_SECRET ||= "s".repeat(48);
const USERS = {
  owner: { _id: "507f1f77bcf86cd799439011", role: "owner", status: "active" },
  member: { _id: "507f1f77bcf86cd799439012", role: "member", status: "active" },
  admin: { _id: "507f1f77bcf86cd799439013", role: "admin", status: "active" },
  banned: { _id: "507f1f77bcf86cd799439014", role: "member", status: "suspended" },
};
const realFind = User.findById;
User.findById = (id) => ({ select: () => ({ lean: async () => Object.values(USERS).find((u) => u._id === String(id)) || null }) });

const sessionMw = configureSession({ store: new session.MemoryStore() });
const app = express();
app.use(sessionMw);
app.get("/t/login/:who", (req, res) => { req.session.user = { id: USERS[req.params.who]._id, role: USERS[req.params.who].role }; res.end("ok"); });
const server = http.createServer(app);
initSocket(server, sessionMw);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => { User.findById = realFind; server.closeAllConnections?.(); server.close(); });

const cookieFor = async (who) => (await fetch(`${base}/t/login/${who}`)).headers.get("set-cookie")?.split(";")[0] || "";
const client = async (who) => {
  const s = connect(base, { extraHeaders: who ? { cookie: await cookieFor(who) } : {}, reconnection: false, transports: ["websocket"] });
  const got = [];
  for (const e of ["live", "notification", "notifications:read"]) s.on(e, (d) => got.push({ e, d }));
  await new Promise((resolve) => { s.once("ready", resolve); s.once("connect_error", resolve); });
  return { s, got, close: () => s.close() };
};
const settle = () => new Promise((r) => setTimeout(r, 120));

test("signed-out visitors can't connect", async () => {
  const c = await client(null);
  assert.equal(c.s.connected, false);
  c.close();
});

test("suspended accounts can't connect", async () => {
  const c = await client("banned");
  assert.equal(c.s.connected, false);
  c.close();
});

test("a 'live' push reaches ONLY the user it is meant for", async () => {
  const owner = await client("owner");
  const member = await client("member");
  assert.ok(owner.s.connected && member.s.connected);

  emitLive(USERS.owner._id, ["invoices", "dashboard"]);
  await settle();
  assert.equal(owner.got.length, 1);
  assert.deepEqual(owner.got[0].d.topics, ["invoices", "dashboard"]);
  assert.equal(member.got.length, 0, "other users hear nothing");
  owner.close(); member.close();
});

test("a user with two open tabs gets the push in both", async () => {
  const a = await client("owner");
  const b = await client("owner");
  emitLive(USERS.owner._id, "members");
  await settle();
  assert.equal(a.got.length, 1);
  assert.equal(b.got.length, 1);
  a.close(); b.close();
});

test("notifications and read-sync events are delivered live", async () => {
  const member = await client("member");
  emitToUser(USERS.member._id, "notification", { id: "n1", title: "فاکتور جدید" });
  emitToUser(USERS.member._id, "notifications:read", { ids: ["n1"], unread: 0 });
  await settle();
  assert.deepEqual(member.got.map((g) => g.e), ["notification", "notifications:read"]);
  member.close();
});

test("a push to a user who is offline is simply dropped (no crash)", () => {
  assert.doesNotThrow(() => emitLive("507f1f77bcf86cd7994390ff", ["me"]));
});
