/**
 * One-off migration: gives every invoice created before `publicId` existed an
 * unguessable public id. (The app also back-fills lazily, this does it in bulk.)
 *
 *   npm run backfill:public-ids
 */
import "dotenv/config";
import mongoose from "mongoose";
import Invoice from "../src/models/Invoice.js";
import { generatePublicId } from "../src/utils/crypto.js";

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is required");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  let updated = 0;
  const cursor = Invoice.find({
    $or: [
      { publicId: { $exists: false } },
      { publicId: null },
      { publicId: "" },
    ],
  })
    .select("_id")
    .cursor();

  for await (const doc of cursor) {
    await Invoice.updateOne(
      { _id: doc._id },
      { $set: { publicId: generatePublicId() } },
    );
    updated++;
  }

  console.log(`Done. ${updated} invoice(s) updated.`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
