import "dotenv/config";
import http from "node:http";

import { createApp } from "./src/createApp.js";
import validateEnv from "./src/config/validateEnv.js";
import * as db from "./src/config/database.js";
import { runMigrations } from "./src/config/migrations.js";
import { initSocket, closeSocket } from "./src/realtime/socket.js";
import { startJobs } from "./src/jobs/index.js";
import { closeMailer, verifyMailer } from "./src/services/mailer.js";
import setupGracefulShutdown from "./src/utils/gracefulShutdown.js";

validateEnv();

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || "development";

try {
  await db.connect();
  await runMigrations();

  const { app, sessionMiddleware } = createApp();
  const server = http.createServer(app);
  initSocket(server, sessionMiddleware);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Environment: ${NODE_ENV}`);
  });

  // tells you at startup whether the Gmail login works (never blocks or crashes the server)
  verifyMailer();

  const stopJobs = startJobs();

  setupGracefulShutdown(server, {
    timeout: 15000,
    exitOnUnhandled: true,
    onShutdown: async () => {
      stopJobs();
      closeSocket();
      closeMailer();
    },
  });
} catch (error) {
  console.error("Failed to start server:", error);
  process.exit(1);
}
