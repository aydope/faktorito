const mongoose = require("mongoose");

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000;

const getConnectionOptions = () => ({
  maxPoolSize: 10,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 30000,
  connectTimeoutMS: 10000,
  heartbeatFrequencyMS: 10000,
  maxIdleTimeMS: 60000,
  retryWrites: true,
  retryReads: true,
  family: 4,
});

const setupConnectionListeners = () => {
  mongoose.connection.on("connected", () => {
    const { host, port } = this.getConnection();
    console.log(`MongoDB connected: ${host}:${port}`);
  });

  mongoose.connection.on("error", (err) => {
    console.error("MongoDB runtime error:", err.message);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected");
  });

  mongoose.connection.on("reconnected", () => {
    console.log("MongoDB reconnected");
  });

  mongoose.connection.on("reconnectFailed", () => {
    console.error("MongoDB reconnection failed");
  });
};

const connectWithRetry = async (retryCount = 0) => {
  try {
    const options = getConnectionOptions();
    setupConnectionListeners();
    await mongoose.connect(process.env.MONGODB_URI, options);
    return true;
  } catch (error) {
    console.error(
      `MongoDB connection failed (attempt ${retryCount + 1}):`,
      error.message,
    );

    if (retryCount >= MAX_RETRIES) {
      console.error(`Max retries (${MAX_RETRIES}) reached. Exiting...`);
      process.exit(1);
    }

    if (IS_PRODUCTION) {
      const delay = RETRY_DELAY * (retryCount + 1);
      console.log(
        `Retrying in ${delay / 1000} seconds... (${retryCount + 1}/${MAX_RETRIES})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return connectWithRetry(retryCount + 1);
    }

    console.error("Non-production environment. Exiting...");
    process.exit(1);
  }
};

exports.connect = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error("MONGODB_URI is not defined in environment variables");
    process.exit(1);
  }

  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    console.error(
      "Invalid MONGODB_URI format. Must start with mongodb:// or mongodb+srv://",
    );
    process.exit(1);
  }

  console.log(
    `Connecting to MongoDB... (${IS_PRODUCTION ? "Production" : "Development"})`,
  );
  await connectWithRetry();
};

exports.getConnection = () => mongoose.connection;
exports.isConnected = () => mongoose.connection.readyState === 1;
exports.getStatus = () => {
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };
  return states[mongoose.connection.readyState] || "unknown";
};
