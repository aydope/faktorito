const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const log = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      user: req.session?.user?.id || null,
      timestamp: new Date().toISOString(),
    };

    if (res.statusCode >= 400) console.error("❌", log);
    else console.log("✅", log);
  });

  next();
};

module.exports = requestLogger;
