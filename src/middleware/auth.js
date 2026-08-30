const AppError = require("../utils/AppError");
const User = require("../models/User");

const clearSession = (req, res) => {
  return new Promise((resolve) => {
    if (!req.session) return resolve();
    req.session.destroy((err) => {
      if (err) console.error("Session destroy error:", err);
      res.clearCookie("faktorito.sid");
      resolve();
    });
  });
};

const checkRole = (allowedRoles, errorMessage = "دسترسی غیرمجاز") => {
  return async (req, res, next) => {
    try {
      if (!req.session?.user) {
        throw AppError.unauthorized("لطفا ابتدا وارد شوید");
      }

      const user = await User.findById(req.session.user.id)
        .select("role status username")
        .lean();

      if (!user) {
        await clearSession(req, res);
        throw AppError.unauthorized("کاربر یافت نشد");
      }

      if (!allowedRoles.includes(user.role)) {
        throw AppError.forbidden(errorMessage);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

exports.authenticate = async (req, res, next) => {
  try {
    if (!req.session?.user) {
      throw AppError.unauthorized("لطفا ابتدا وارد شوید");
    }

    const user = await User.findById(req.session.user.id)
      .select("role status username")
      .lean();

    if (!user) {
      await clearSession(req, res);
      throw AppError.unauthorized("کاربر یافت نشد");
    }

    if (user.status !== "active") {
      const statusMessages = {
        suspended: "حساب کاربری شما تعلیق شده است",
        disabled: "حساب کاربری شما غیرفعال شده است",
      };

      const message = statusMessages[user.status] || "حساب کاربری غیرفعال است";

      await clearSession(req, res);
      throw AppError.forbidden(message);
    }

    next();
  } catch (error) {
    next(error);
  }
};

exports.adminOnly = checkRole(
  ["admin", "moderator"],
  "این بخش فقط برای مدیران قابل دسترسی است",
);

exports.moderatorOnly = checkRole(
  ["moderator"],
  "این عملیات فقط توسط مدیر ارشد قابل انجام است",
);

exports.adminOnlyStrict = checkRole(
  ["admin"],
  "این عملیات فقط توسط ادمین قابل انجام است",
);

exports.checkPermission = (permissionTemplate) => async (req, res, next) => {
  try {
    const [requiredRole, endpointAction] = permissionTemplate.split("/");
    const [endpoint, action] = endpointAction.split(":");

    if (!requiredRole || !endpoint || !action) {
      throw AppError.internal("فرمت مجوز نامعتبر است");
    }

    const { role: currentRole } = req.session.user;

    const adminRoles =
      requiredRole === "admin" ? ["admin", "moderator"] : ["user"];

    if (!adminRoles.includes(currentRole)) {
      if (action === "delete") {
        return res.status(403).json({
          success: false,
          message: "شما دسترسی حذف کاربران را ندارید",
        });
      }
      throw AppError.forbidden("شما دسترسی لازم برای این عملیات را ندارید");
    }

    switch (endpoint) {
      case "users":
        return handleUserActions(req, res, next, action, currentRole);

      case "invoices":
        return handleInvoiceActions(req, res, next, action, currentRole);

      case "plans":
        return handlePlanActions(req, res, next, action, currentRole);

      default:
        throw AppError.forbidden("اندپوینت نامعتبر است");
    }
  } catch (error) {
    next(error);
  }
};

const ROLE_HIERARCHY = {
  user: 1,
  moderator: 2,
  admin: 3,
};

async function handleUserActions(req, res, next, action, currentRole) {
  const targetUser = await User.findById(req.params.id)
    .select("role username")
    .lean();

  if (!targetUser) {
    return res.status(404).json({
      success: false,
      message: "کاربر پیدا نشد",
    });
  }

  const { role: targetRole } = targetUser;

  switch (action) {
    case "status":
      return handleUserStatus(req, res, next, currentRole, targetRole);

    case "role":
      return handleUserRole(req, res, next, currentRole, targetRole);

    case "delete":
      return handleUserDelete(req, res, next, currentRole, targetRole);

    default:
      throw AppError.forbidden("اکشن نامعتبر است");
  }
}

async function handleUserStatus(req, res, next, currentRole, targetRole) {
  const targetUserId = req.params.id;
  const currentUserId = req.session.user._id;

  if (currentRole === "admin") {
    if (targetRole === "user") {
      return next();
    }
    throw AppError.forbidden("شما دسترسی انجام این کار را ندارید");
  }

  if (currentRole === "moderator") {
    if (targetUserId === currentUserId) {
      throw AppError.forbidden("نمی‌توانید وضعیت خود را تغییر دهید");
    }

    if (targetRole === "moderator") {
      throw AppError.forbidden("نمی‌توانید وضعیت هم‌رتبه خود را تغییر دهید");
    }

    if (["user", "admin"].includes(targetRole)) {
      return next();
    }
  }

  throw AppError.forbidden("شما دسترسی تغییر وضعیت این کاربر را ندارید");
}

async function handleUserRole(req, res, next, currentRole, targetRole) {
  const newRole = req.body?.role;
  const targetUserId = req.params.id;
  const currentUserId = req.session.user._id;

  if (!newRole || !ROLE_HIERARCHY[newRole]) {
    throw AppError.badRequest("نقش جدید معتبر نیست");
  }

  if (currentRole === "admin") {
    throw AppError.forbidden("شما دسترسی تغییر نقش کاربران را ندارید");
  }

  if (currentRole === "moderator") {
    if (targetUserId === currentUserId) {
      throw AppError.forbidden("نمی‌توانید نقش خود را تغییر دهید");
    }

    if (targetRole === "moderator") {
      throw AppError.forbidden("نمی‌توانید نقش هم‌رتبه خود را تغییر دهید");
    }

    if (targetRole === "user" && newRole === "admin") {
      return next();
    }

    if (targetRole === "admin" && newRole === "user") {
      return next();
    }

    if (["user", "admin"].includes(targetRole) && newRole === "moderator") {
      throw AppError.forbidden("شما دسترسی ارتقا کاربر را ندارید");
    }
  }

  throw AppError.forbidden("شما دسترسی تغییر نقش را ندارید");
}

async function handleUserDelete(req, res, next, currentRole, targetRole) {
  const targetUserId = req.params.id;
  const currentUserId = req.session.user._id;

  if (currentRole === "admin") {
    return res.status(403).json({
      success: false,
      message: "شما دسترسی حذف کاربران را ندارید",
    });
  }

  if (currentRole === "moderator") {
    return res.status(403).json({
      success: false,
      message: "شما دسترسی حذف کاربران را ندارید",
    });
  }

  return res.status(403).json({
    success: false,
    message: "شما دسترسی حذف کاربر را ندارید",
  });
}

async function handleInvoiceActions(req, res, next, action, currentRole) {
  switch (action) {
    case "delete":
      if (currentRole === "admin") {
        return res.status(403).json({
          success: false,
          message: "شما دسترسی حذف فاکتور را ندارید",
        });
      }

      if (currentRole === "moderator") {
        return next();
      }

      return res.status(403).json({
        success: false,
        message: "شما دسترسی حذف فاکتور را ندارید",
      });

    default:
      return res.status(403).json({
        success: false,
        message: "اکشن نامعتبر است",
      });
  }
}

async function handlePlanActions(req, res, next, action, currentRole) {
  switch (action) {
    case "delete":
      if (currentRole === "admin") {
        return res.status(403).json({
          success: false,
          message: "شما دسترسی مدیریت پلن‌ها را ندارید",
        });
      }

      if (currentRole === "moderator") {
        return next();
      }

      return res.status(403).json({
        success: false,
        message: "شما دسترسی مدیریت پلن‌ها را ندارید",
      });

    default:
      return res.status(403).json({
        success: false,
        message: "اکشن نامعتبر است",
      });
  }
}

exports.preventSelfModification = (msg) => {
  return (req, res, next) => {
    if (req.session.user.id === req.params.id) {
      return res.status(400).json({
        success: false,
        message: msg || "نمی‌توانید روی حساب خود این عملیات را انجام دهید",
      });
    }
    next();
  };
};
