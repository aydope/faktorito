import AppError from "../utils/AppError.js";

// The shared error handler renders the (redesigned) error page / JSON.
const notFound = (req, res, next) => {
  next(AppError.notFound(`مسیر ${req.path.slice(0, 120)} پیدا نشد`));
};

export default notFound;
