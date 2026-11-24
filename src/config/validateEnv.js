/**
 * Fail fast (with a clear message) instead of crashing later with an obscure
 * error, and refuse to boot in production with a weak session secret.
 */
const validateEnv = () => {
  const errors = [];
  const isProd = process.env.NODE_ENV === "production";

  if (!process.env.MONGODB_URI) errors.push("MONGODB_URI is required");

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    errors.push("SESSION_SECRET is required");
  } else if (isProd && secret.length < 32) {
    errors.push("SESSION_SECRET must be at least 32 characters in production");
  }

  // OTP e-mails are the only way to verify accounts, so production needs Gmail credentials
  if (isProd && (!process.env.GMAIL_USER || !process.env.GMAIL_PASSWORD)) {
    errors.push(
      "GMAIL_USER and GMAIL_PASSWORD (a Google App Password) are required in production (e-mail verification / OTP)",
    );
  }

  if (errors.length) {
    console.error(
      "Invalid environment configuration:\n - " + errors.join("\n - "),
    );
    process.exit(1);
  }
};

export default validateEnv;
