import express from "express";
import catchAsync from "../utils/catchAsync.js";
import { buildReport } from "../services/reportService.js";

const router = express.Router();

router.get(
  "/",
  catchAsync(async (req, res) => {
    const report = await buildReport(
      req.session.user.id,
      Number.parseInt(req.query.days, 10),
    );
    res.render("reports", { title: "گزارش فروش", active: "reports", report });
  }),
);

export default router;
