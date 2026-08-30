const mongoose = require("mongoose");

const setupGracefulShutdown = (server, options = {}) => {
  const {
    timeout = 10000,
    exitOnUnhandled = true,
    onShutdown = null,
  } = options;

  let isShuttingDown = false;

  const shutdown = async (signal, error = null) => {
    if (isShuttingDown) {
      console.log(`Shutdown already in progress, ignoring ${signal}`);
      return;
    }
    isShuttingDown = true;

    console.log(`\nGraceful shutdown initiated (Signal: ${signal})`);

    if (error) {
      console.error(`Error details:`, {
        message: error.message,
        stack: error.stack,
      });
    }

    const forceExitTimer = setTimeout(() => {
      console.error(`Force exit after ${timeout}ms timeout`);
      process.exit(1);
    }, timeout);

    try {
      if (onShutdown && typeof onShutdown === "function") {
        console.log("Running custom shutdown hook...");
        await onShutdown();
        console.log("Custom shutdown hook completed");
      }

      console.log("Closing HTTP server...");
      await new Promise((resolve) => {
        server.close((err) => {
          if (err) {
            console.error("Error closing HTTP server:", err.message);
          } else {
            console.log("HTTP server closed");
          }
          resolve();
        });
      });

      console.log("Closing MongoDB connection...");
      await mongoose.connection.close(false);
      console.log("MongoDB connection closed");

      // if (redisClient) {
      //   console.log("Closing Redis connection...");
      //   await redisClient.quit();
      //   console.log("Redis connection closed");
      // }

      console.log("Shutdown complete successfully\n");
      clearTimeout(forceExitTimer);

      process.exit(0);
    } catch (error) {
      console.error("Shutdown error:", error.message);
      console.error("Stack:", error.stack);
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  };

  const isShuttingDownCheck = () => isShuttingDown;

  const signals = ["SIGTERM", "SIGINT", "SIGQUIT"];
  signals.forEach((signal) => {
    process.on(signal, () => shutdown(signal));
  });

  process.on("unhandledRejection", (error) => {
    console.error("Unhandled Rejection:", {
      message: error.message,
      stack: error.stack,
    });

    if (exitOnUnhandled) {
      shutdown("unhandledRejection", error);
    }
  });

  process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", {
      message: error.message,
      stack: error.stack,
    });
    shutdown("uncaughtException", error);
  });

  process.on("warning", (warning) => {
    console.warn("Process Warning:", warning.message);
  });

  return {
    shutdown,
    isShuttingDown: isShuttingDownCheck,
  };
};

module.exports = setupGracefulShutdown;
