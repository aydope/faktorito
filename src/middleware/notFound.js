const xss = require("xss");

const notFound = (req, res, next) => {
  const safeUrl = xss(req.originalUrl, {
    whiteList: [],
    stripIgnoreTag: true,
    stripIgnoreTagBody: ["script", "style"],
  });

  res.status(404).render("404.ejs", {
    success: false,
    message: `مسیر ${safeUrl} پیدا نشد`,
    url: safeUrl,
    statusCode: 404,
  });
};

module.exports = notFound;
