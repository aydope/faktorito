import AppError from "../utils/AppError.js";

// mongoose.Types.ObjectId.isValid() also accepts ANY 12-character string and
// non-string values (e.g. objects coming from ?id[$ne]=x), so check strictly.
const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

export const isObjectId = (id) =>
  typeof id === "string" && OBJECT_ID_RE.test(id);

export const validateID = (id, options = {}) => {
  const { message = "شناسه نامعتبر است" } = options;

  if (!isObjectId(typeof id === "object" && id !== null ? String(id) : id)) {
    throw AppError.badRequest(message);
  }
};
