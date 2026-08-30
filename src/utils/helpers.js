const Invoice = require("../models/Invoice");
const User = require("../models/User");
const AppError = require("./AppError");

exports.calculateTotals = (planPrice, customOptions = [], discounts = []) => {
  const cafeTotal = customOptions.reduce(
    (sum, item) => sum + (Number(item.price) || 0),
    0,
  );

  let discountTotal = 0;
  const extraItems = [];

  for (const item of customOptions) {
    extraItems.push({
      type: "cafe",
      name: item.name,
      price: Number(item.price) || 0,
    });
  }

  for (const discount of discounts) {
    const discountValue = Number(discount.value) || 0;
    const amount =
      discount.type === "percent"
        ? Math.floor(((planPrice + cafeTotal) * discountValue) / 100)
        : discountValue;

    discountTotal += amount;

    const label =
      discount.type === "percent"
        ? `${discountValue}%`
        : `${discountValue.toLocaleString("fa-IR-u-nu-latn")} تومان`;

    extraItems.push({
      type: "discount",
      name: `${discount.description} (${label})`,
      price: -Math.abs(amount),
    });
  }

  const totalAmount = Math.max(0, planPrice + cafeTotal - discountTotal);

  return {
    cafeTotal,
    discountTotal,
    extraItems,
    totalAmount,
    extraTotal: cafeTotal - discountTotal,
  };
};

exports.checkDuplicateField = async (field, value, userId) => {
  const query = { [field]: value.toLowerCase() };
  const existingUser = await User.findOne(query).select(field).lean();

  if (existingUser && existingUser._id.toString() !== userId.toString()) {
    const fieldNames = {
      username: "نام کاربری",
      email: "ایمیل",
    };
    throw AppError.conflict(`${fieldNames[field]} قبلاً ثبت شده است`);
  }
};

exports.setupPagination = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const userId = req.session.user.id;

  const invoices = await Invoice.find({ user: userId })
    .select("invoiceNumber member totalAmount isPaid invoiceDate plan")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const totalCount = await Invoice.countDocuments({ user: userId });

  const totalPages = Math.ceil(totalCount / limit);
  const currentPage = page;

  return {
    invoices,
    currentPage,
    totalPages,
    totalCount,
    limit,
    hasNext: currentPage < totalPages,
    hasPrev: currentPage > 1,
  };
};
