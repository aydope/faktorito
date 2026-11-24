import { createHash } from "node:crypto";

/**
 * Every business owner gets a small SVG "person" avatar for their invoices.
 * It is generated from a stable seed (the owner's id / club name), so nobody
 * uploads or configures anything and the same owner always gets the same face.
 *
 * Nothing user-controlled ever reaches the markup except the accessible label,
 * which is escaped; all numbers and colours are derived from a hash.
 */

const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

// soft, friendly "skin" tones kept abstract on purpose (one shape, many tints)
const TONES = [
  "#fde7d3",
  "#f6d2b5",
  "#e9b98f",
  "#d19c73",
  "#b97f59",
  "#8f5d3f",
];
const HAIR = [
  "#1f2937",
  "#3b2a1a",
  "#7c4a21",
  "#c48a2c",
  "#6d28d9",
  "#0f766e",
  "#be123c",
];

const SHOULDERS = [
  "M8 64c0-13 10-20 24-20s24 7 24 20z", // classic
  "M6 64c2-14 12-21 26-21s24 7 26 21z", // wider
  "M10 64c0-11 9-18 22-18s22 7 22 18z", // narrow
];

const HAIRDOS = [
  (c) =>
    `<path d="M19 27c0-9 6-15 13-15s13 6 13 15c-4-5-9-7-13-7s-9 2-13 7z" fill="${c}"/>`, // short
  (c) =>
    `<path d="M17 31c-2-13 5-20 15-20s17 7 15 20c-1-6-3-9-5-11-4 3-13 3-20 0-2 2-4 5-5 11z" fill="${c}"/>`, // fringe
  (c) =>
    `<path d="M16 38c-3-16 4-27 16-27s19 11 16 27c-2-6-3-9-4-14-6 2-15 2-24 0-1 5-2 8-4 14z" fill="${c}"/>`, // long
  (c) =>
    `<circle cx="32" cy="12" r="6" fill="${c}"/><path d="M19 27c0-8 6-13 13-13s13 5 13 13c-4-4-9-6-13-6s-9 2-13 6z" fill="${c}"/>`, // bun
  (c) =>
    `<path d="M18 28c1-9 7-14 14-14s13 5 14 14c-5-3-9-4-14-4s-9 1-14 4z" fill="${c}"/><rect x="18" y="26" width="28" height="3" rx="1.5" fill="#fff" fill-opacity=".85"/>`, // headband
  () => "", // none
];

const GLASSES = `<g fill="none" stroke="#111827" stroke-width="1.3" stroke-opacity=".8"><circle cx="27" cy="31" r="3.6"/><circle cx="37" cy="31" r="3.6"/><path d="M30.6 31h2.8"/></g>`;

const seedBytes = (seed) =>
  createHash("sha256")
    .update(String(seed ?? ""))
    .digest();

/** The avatar's recipe (exported so tests can check it is deterministic). */
export const avatarSpec = (seed) => {
  const b = seedBytes(seed);
  const hue = (b[0] / 255) * 360;
  return {
    hue1: Math.round(hue),
    hue2: Math.round((hue + 40 + (b[1] % 70)) % 360),
    angle: (b[2] % 4) * 45 + 20,
    tone: b[3] % TONES.length,
    hair: b[4] % HAIRDOS.length,
    hairColor: b[5] % HAIR.length,
    shoulders: b[6] % SHOULDERS.length,
    glasses: b[7] % 3 === 0,
  };
};

export const renderAvatar = (seed, label = "") => {
  const s = avatarSpec(seed);
  const id = `av${seedBytes(seed).toString("hex").slice(0, 8)}`;
  const tone = TONES[s.tone];
  const hairColor = HAIR[s.hairColor];
  const x2 = Math.round(50 + 50 * Math.cos(((s.angle - 90) * Math.PI) / 180));
  const y2 = Math.round(50 + 50 * Math.sin(((s.angle - 90) * Math.PI) / 180));
  const title = esc(label) || "آواتار";

  return (
    `<svg class="fx-avatar" viewBox="0 0 64 64" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="${id}" x1="0%" y1="0%" x2="${x2}%" y2="${y2}%">` +
    `<stop offset="0" stop-color="hsl(${s.hue1} 78% 58%)"/><stop offset="1" stop-color="hsl(${s.hue2} 72% 42%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="64" height="64" fill="url(#${id})"/>` +
    `<circle cx="52" cy="12" r="9" fill="#fff" fill-opacity=".12"/>` +
    `<path d="${SHOULDERS[s.shoulders]}" fill="#fff" fill-opacity=".92"/>` +
    `<rect x="28.5" y="38" width="7" height="8" rx="3" fill="${tone}"/>` +
    `<ellipse cx="32" cy="29" rx="10.5" ry="12" fill="${tone}"/>` +
    HAIRDOS[s.hair](hairColor) +
    (s.glasses ? GLASSES : "") +
    `</svg>`
  );
};
