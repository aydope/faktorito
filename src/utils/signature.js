import AppError from "./AppError.js";

/**
 * A signature is drawn on a canvas in the browser and sent as STROKES
 * (lists of [x, y] points), never as an image file. The server validates the
 * numbers and stores a compact SVG path, so there is nothing to upload,
 * decode or sanitise.
 */
export const SIG_W = 600;
export const SIG_H = 240;
export const MAX_STROKES = 40;
export const MAX_POINTS = 3000;
export const MIN_DISTANCE = 1.5;
export const PATH_RE = /^[ML Q0-9.\-\s]{1,60000}$/;

const round1 = (n) => Math.round(n * 10) / 10;

export const buildSignaturePath = (strokes) => {
  if (!Array.isArray(strokes) || strokes.length === 0) {
    throw AppError.badRequest("امضا خالی است");
  }
  if (strokes.length > MAX_STROKES)
    throw AppError.badRequest("امضا بیش از حد پیچیده است");

  let total = 0;
  const parts = [];

  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length === 0) continue;
    const pts = [];

    for (const p of stroke) {
      if (!Array.isArray(p) || p.length !== 2)
        throw AppError.badRequest("امضا نامعتبر است");
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x > SIG_W ||
        y > SIG_H
      ) {
        throw AppError.badRequest("امضا نامعتبر است");
      }
      total++;
      if (total > MAX_POINTS)
        throw AppError.badRequest("امضا بیش از حد پیچیده است");

      const last = pts[pts.length - 1];
      if (last && Math.hypot(last[0] - x, last[1] - y) < MIN_DISTANCE) continue;
      pts.push([round1(x), round1(y)]);
    }
    if (pts.length === 0) continue;

    if (pts.length === 1) {
      // a dot
      parts.push(
        `M ${pts[0][0]} ${pts[0][1]} L ${round1(pts[0][0] + 0.1)} ${pts[0][1]}`,
      );
      continue;
    }

    // quadratic smoothing through the midpoints
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = round1((pts[i][0] + pts[i + 1][0]) / 2);
      const my = round1((pts[i][1] + pts[i + 1][1]) / 2);
      d += ` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
    }
    const end = pts[pts.length - 1];
    d += ` L ${end[0]} ${end[1]}`;
    parts.push(d);
  }

  if (parts.length === 0) throw AppError.badRequest("امضا خالی است");
  const path = parts.join(" ");
  if (!PATH_RE.test(path)) throw AppError.badRequest("امضا نامعتبر است");
  return path;
};

/** Defence in depth: only a path made of our own characters is ever rendered. */
export const safeSignaturePath = (path) =>
  typeof path === "string" && PATH_RE.test(path) ? path : "";
