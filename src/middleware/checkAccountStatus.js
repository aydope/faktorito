const User = require("../models/User");

const checkAccountStatus = async (req, res, next) => {
  try {
    if (!req.session?.user?.id) {
      return next();
    }

    const user = await User.findById(req.session.user.id)
      .select("status username")
      .lean();

    if (!user) {
      return res.redirect("/auth/login");
    }

    if (["disabled", "suspended"].includes(user.status)) {
      return renderAccountStatusPage(req, res, user);
    }

    next();
  } catch (error) {
    console.error("checkAccountStatus error:", error);
    next(error);
  }
};

const destroySession = (req, res) => {
  return new Promise((resolve) => {
    req.session.destroy((err) => {
      if (err) console.error("Session destroy error:", err);
      res.clearCookie("faktorito.sid");
      resolve();
    });
  });
};

const renderAccountStatusPage = (req, res, user) => {
  const statusText = user.status === "suspended" ? "تعلیق" : "غیرفعال";

  return res.status(403).render("account-status", {
    title: `حساب ${statusText} شده`,
    status: user.status,
    username: user.username,
    isSuspended: user.status === "suspended",
    isDisabled: user.status === "disabled",
  });
};

module.exports = checkAccountStatus;
