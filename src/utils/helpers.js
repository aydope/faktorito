import mongoose from "mongoose";
import {
  asString,
  asEnum,
  escapeRegex,
  parsePagination,
  buildPagination,
} from "./query.js";
import Invoice from "../models/Invoice.js";
import User from "../models/User.js";
import AppError from "./AppError.js";

export const calculateTotals = (
  planPrice,
  customOptions = [],
  discounts = [],
) => {
  const itemsTotal = customOptions.reduce(
    (sum, item) => sum + (Number(item.price) || 0),
    0,
  );

  let discountTotal = 0;
  const extraItems = [];

  for (const item of customOptions) {
    extraItems.push({
      type: "item",
      name: item.name,
      price: Number(item.price) || 0,
    });
  }

  for (const discount of discounts) {
    const rawValue = Number(discount.value) || 0;
    const discountValue =
      discount.type === "percent" ? Math.min(rawValue, 100) : rawValue;
    const amount =
      discount.type === "percent"
        ? Math.floor(((planPrice + itemsTotal) * discountValue) / 100)
        : discountValue;

    const remaining = Math.max(0, planPrice + itemsTotal - discountTotal);
    const appliedAmount = Math.min(amount, remaining);
    discountTotal += appliedAmount;

    const label =
      discount.type === "percent"
        ? `${discountValue}%`
        : `${discountValue.toLocaleString("fa-IR-u-nu-latn")} تومان`;

    extraItems.push({
      type: "discount",
      name: `${discount.description} (${label})`,
      price: -Math.abs(appliedAmount),
    });
  }

  const totalAmount = Math.max(0, planPrice + itemsTotal - discountTotal);

  return {
    itemsTotal,
    discountTotal,
    extraItems,
    totalAmount,
    extraTotal: itemsTotal - discountTotal,
  };
};

export const checkDuplicateField = async (field, value, userId) => {
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

/**
 * Paginated invoice list for the logged-in owner.
 * Supports ?search=, ?status=paid|pending, ?member=<memberId>, ?page, ?limit
 * (all coerced/escaped: nothing from req.query reaches Mongo unchecked).
 */
export const buildInvoiceFilter = (query, userId) => {
  const filter = { user: userId };

  const status = asEnum(query.status, ["paid", "pending"]);
  if (status === "paid") filter.isPaid = true;
  if (status === "pending") filter.isPaid = false;

  const member = asString(query.member, 24);
  if (member && mongoose.isValidObjectId(member)) filter.memberRef = member;

  const search = asString(query.search, 50);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [
      { invoiceNumber: rx },
      { "member.name": rx },
      { "member.phone": rx },
      { "member.memberId": rx },
    ];
  }

  return { filter, search, status, member };
};

export const setupPagination = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, {
    defaultLimit: 10,
    maxLimit: 50,
  });

  const userId = req.session.user.id;
  const { filter, search, status, member } = buildInvoiceFilter(
    req.query,
    userId,
  );

  const [invoices, totalCount] = await Promise.all([
    Invoice.find(filter)
      .select(
        "invoiceNumber member memberRef totalAmount isPaid invoiceDate plan publicId",
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Invoice.countDocuments(filter),
  ]);

  const pagination = buildPagination({ page, limit, totalCount });

  return {
    invoices,
    currentPage: pagination.currentPage,
    totalPages: pagination.totalPages,
    totalCount,
    limit,
    hasNext: pagination.hasNext,
    hasPrev: pagination.hasPrev,
    filters: { search, status, member },
  };
};
