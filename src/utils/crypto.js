import crypto from "crypto";

/** Unguessable id used for public (shareable) invoice links. */
const generatePublicId = () => crypto.randomBytes(18).toString("base64url");

/** 4-digit tracking code generated with a CSPRNG instead of Math.random(). */
const generateTrackingCode = () => String(crypto.randomInt(1000, 10000));

export { generatePublicId, generateTrackingCode };
