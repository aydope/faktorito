import xss from "xss";

const sanitize = (data) => {
  if (typeof data === "string") return xss(data.trim());
  if (typeof data === "object" && data !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitize(value);
    }
    return sanitized;
  }
  return data;
};

const sanitizeBody = (req, res, next) => {
  if (req.body) req.body = sanitize(req.body);
  next();
};

export { sanitize, sanitizeBody };
