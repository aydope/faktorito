import Joi from "joi";
import { THEME_KEYS } from "../utils/invoiceSheet.js";

const hex = Joi.string()
  .pattern(/^#[0-9a-fA-F]{6}$/)
  .messages({ "string.pattern.base": "رنگ باید به شکل #RRGGBB باشد" });

// There is no logo / brand editor any more: every owner gets a generated SVG
// avatar. What remains is the theme and the DRAWN signature.
export const brandingSchema = Joi.object({
  invoiceTheme: Joi.string().valid(...THEME_KEYS),

  // The signature is drawn: lists of [x, y] points from the canvas. Never a file.
  strokes: Joi.array()
    .items(Joi.array().items(Joi.array().length(2).items(Joi.number())))
    .max(40),
  removeSignature: Joi.boolean(),
  signatureColor: hex,
  signerName: Joi.string().trim().allow("").max(40),
  signaturePosition: Joi.string().valid("left", "center", "right"),
}).unknown(false);
