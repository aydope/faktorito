import express from "express";
import User from "../models/User.js";
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/AppError.js";
import validateRequest from "../middleware/validateRequest.js";
import { createGymSchema } from "../validators/gym.js";
import {
  isInAnyClub,
  MEMBER_CANT_OWN_MESSAGE,
} from "../services/membershipService.js";
import { CURRENT_TERMS_VERSION } from "../config/legal.js";

/**
 * The ONLY way to get a gym: a normal account (registered at /auth/register
 * like everybody else) opens /gym/create from its own panel, accepts the extra
 * terms, fills in the name and is promoted to "owner". Mounted behind memberOnly.
 */
const router = express.Router();

router.get(
  "/create",
  catchAsync(async (req, res) => {
    res.render("gym/create", {
      title: "ساخت باشگاه",
      active: "me",
      inClub: await isInAnyClub(req.session.user.id),
    });
  }),
);

router.post(
  "/create",
  validateRequest(createGymSchema),
  catchAsync(async (req, res) => {
    const { clubName, clubPhone = "", clubAddress = "" } = req.validatedBody; // acceptBusinessTerms is enforced by the schema
    const userId = req.session.user.id;

    if (await isInAnyClub(userId))
      throw AppError.conflict(MEMBER_CANT_OWN_MESSAGE);

    // atomic: only a still-ordinary, active account can be promoted (once)
    const promoted = await User.updateOne(
      { _id: userId, role: "member", status: "active" },
      {
        $set: {
          role: "owner",
          clubName,
          clubPhone: clubPhone || "",
          clubAddress: clubAddress || "",
          businessTermsAcceptedAt: new Date(),
          businessTermsVersion: CURRENT_TERMS_VERSION,
        },
      },
      { runValidators: true },
    );
    if (promoted.matchedCount === 0)
      throw AppError.conflict("این حساب قبلاً باشگاه دارد یا امکان ساخت ندارد");

    // Promote FIRST, check AFTER: if a club added this person in the meantime, undo.
    // (attachAccount re-checks the role too, so one of the two always notices.)
    if (await isInAnyClub(userId)) {
      await User.updateOne(
        { _id: userId, role: "owner" },
        {
          $set: {
            role: "member",
            clubName: "",
            businessTermsAcceptedAt: null,
            businessTermsVersion: "",
          },
        },
      );
      throw AppError.conflict(MEMBER_CANT_OWN_MESSAGE);
    }

    // the session carries the role used by menus; the guards re-read it from the DB anyway
    req.session.user.role = "owner";
    req.session.user.clubName = clubName;
    await new Promise((resolve, reject) =>
      req.session.save((e) => (e ? reject(e) : resolve())),
    );

    res.status(201).json({
      success: true,
      message: `باشگاه «${clubName}» ساخته شد`,
      redirect: "/dashboard",
    });
  }),
);

export default router;
