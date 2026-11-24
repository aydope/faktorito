/**
 * Every rendered page gets the same small set of shared assets without each of
 * the 30+ templates (some with their own <head>) having to remember them:
 *   - /a11y.css  : focus rings, skip link, reduced motion, readable muted text
 *   - /a11y.js   : accessible names, dialogs, live regions, skip link target
 *   - /cookie-consent.js : the cookie notice
 * Added in one place, applied by createApp for every res.render.
 */
export const HEAD_ASSET = '<link rel="stylesheet" href="/a11y.css">';
export const BODY_ASSETS =
  '<script src="/a11y.js" defer></script><script src="/cookie-consent.js" defer></script>';

const insertBefore = (html, closingTag, snippet) => {
  const i = html.toLowerCase().lastIndexOf(closingTag);
  return i === -1 ? html : `${html.slice(0, i)}${snippet}${html.slice(i)}`;
};

/** Returns the page with the shared assets added (once). Fragments without </head> or </body> are left alone. */
export const enhanceHtml = (html, { includeAssets = true } = {}) => {
  if (!includeAssets || typeof html !== "string") return html;
  let out = html;
  if (!out.includes('href="/a11y.css"'))
    out = insertBefore(out, "</head>", HEAD_ASSET);
  if (!out.includes('src="/a11y.js"'))
    out = insertBefore(out, "</body>", BODY_ASSETS);
  return out;
};
