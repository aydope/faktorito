const mongoose = require("mongoose");
const AppError = require("../utils/AppError");

exports.validateID = (id, options = {}) => {
  const { message = "شناسه نامعتبر است" } = options;

  if (!id) {
    throw AppError.badRequest(message);
  }

  const isValid = mongoose.Types.ObjectId.isValid(id);

  if (!isValid) {
    throw AppError.badRequest(message);
  }
};
