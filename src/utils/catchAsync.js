const catchAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      if (process.env.NODE_ENV === "development") {
        console.error("🚨 Async Error:", {
          message: err.message,
          stack: err.stack,
          url: req.originalUrl,
          method: req.method,
          body: req.body,
          params: req.params,
          query: req.query,
          user: req.session.user?.id || null,
        });
      }

      next(err);
    });
  };
};

const catchAsyncWithTimeout = (fn, timeoutMs = 30000) => {
  return (req, res, next) => {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`درخواست بیش از ${timeoutMs / 1000} ثانیه طول کشید`));
      }, timeoutMs);
    });

    Promise.race([Promise.resolve(fn(req, res, next)), timeoutPromise]).catch(
      (err) => {
        if (process.env.NODE_ENV === "development") {
          console.error("⏱️ Timeout Error:", {
            message: err.message,
            url: req.originalUrl,
            method: req.method,
          });
        }
        next(err);
      },
    );
  };
};

module.exports = catchAsync;
module.exports.catchAsync = catchAsync;
module.exports.catchAsyncWithTimeout = catchAsyncWithTimeout;
