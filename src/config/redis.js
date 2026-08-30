const Redis = require("ioredis");

const redisClient = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: process.env.REDIS_DB || 0,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redisClient.on("connect", () => {
  console.log("Connecting to Redis...");
});

redisClient.on("ready", () => {
  console.log("Redis connected successfully");
});

redisClient.on("error", (err) => {
  console.error("Redis error:", err.message);
});

redisClient.on("close", () => {
  console.log("Redis connection closed");
});

redisClient.on("reconnecting", () => {
  console.log("Redis reconnecting...");
});

const connectRedis = async () => {
  try {
    if (!redisClient.status || redisClient.status === "end") {
      await redisClient.connect();
    }
    return redisClient;
  } catch (error) {
    console.error("Redis connection failed:", error.message);
    return null;
  }
};

const disconnectRedis = async () => {
  try {
    await redisClient.quit();
    console.log("Redis disconnected");
  } catch (error) {
    console.error("Redis disconnect error:", error.message);
  }
};

const cache = {
  get: async (key) => {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("Cache get error:", error);
      return null;
    }
  },

  set: async (key, value, ttl = 300) => {
    try {
      const stringValue = JSON.stringify(value);
      if (ttl > 0) {
        await redisClient.setex(key, ttl, stringValue);
      } else {
        await redisClient.set(key, stringValue);
      }
      return true;
    } catch (error) {
      console.error("Cache set error:", error);
      return false;
    }
  },

  del: async (key) => {
    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      console.error("Cache delete error:", error);
      return false;
    }
  },

  delPattern: async (pattern) => {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
      return keys.length;
    } catch (error) {
      console.error("Cache delete pattern error:", error);
      return 0;
    }
  },

  exists: async (key) => {
    try {
      return await redisClient.exists(key);
    } catch (error) {
      console.error("Cache exists error:", error);
      return false;
    }
  },

  expire: async (key, ttl) => {
    try {
      await redisClient.expire(key, ttl);
      return true;
    } catch (error) {
      console.error("Cache expire error:", error);
      return false;
    }
  },
};

module.exports = {
  redisClient,
  connectRedis,
  disconnectRedis,
  cache,
};
