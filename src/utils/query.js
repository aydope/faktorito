/**
 * Small helpers for safely reading query-string input.
 * Express' "extended" query parser can turn `?status[$ne]=x` into an object,
 * so every value coming from req.query must be coerced before it reaches Mongo.
 */

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Returns a trimmed string (max `max` chars) or "" if the value isn't a plain string. */
const asString = (value, max = 100) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** Returns `value` only if it is one of `allowed`, otherwise "". */
const asEnum = (value, allowed) =>
  typeof value === "string" && allowed.includes(value) ? value : "";

const parsePagination = (query, { defaultLimit = 10, maxLimit = 50 } = {}) => {
  const rawPage = parseInt(asString(query.page, 10), 10);
  const rawLimit = parseInt(asString(query.limit, 10), 10);

  const page =
    Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100000) : 1;
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, maxLimit)
      : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
};

const buildPagination = ({ page, limit, totalCount }) => {
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return {
    currentPage: page,
    totalPages,
    totalCount,
    limit,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
};

/**
 * Escapes a value for CSV and neutralises spreadsheet formula injection
 * (cells starting with = + - @ are prefixed with an apostrophe).
 */
const csvCell = (value) => {
  let str = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
};

const toCsv = (headers, rows) => {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  // BOM so Excel opens Persian text correctly
  return "\uFEFF" + lines.join("\r\n");
};

/** ۰۹۱۲... / ٠٩١٢... -> 0912... (people type phone numbers with Persian keyboards) */
const normalizeDigits = (value) =>
  typeof value === "string"
    ? value
        .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    : value;

export {
  normalizeDigits,
  escapeRegex,
  asString,
  asEnum,
  parsePagination,
  buildPagination,
  csvCell,
  toCsv,
};
