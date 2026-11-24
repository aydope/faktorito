import test from "node:test";
import assert from "node:assert/strict";

import { CASES, render, base } from "./helpers/views.js";
import { LIMIT_LABELS } from "../src/config/limits.js";

for (const [name, extra] of Object.entries(CASES)) {
  test(`view renders strictly: ${name}`, async () => {
    const view = name.split(" (")[0];
    const html = await render(view, { ...base, ...extra });
    assert.ok(html.length > 200);
    assert.ok(!/کافه|cafe|loyalty|businessType/i.test(html), "cafe leftovers in the page");
    // scripts legitimately say `typeof x === 'undefined'`; look at the visible markup only
    const markup = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
    assert.ok(!/undefined|\bNaN\b|\[object Object\]/.test(markup), "undefined / NaN / [object Object] leaked into the page");
  });
}

test("settings shows a row for every limit (the page that crashed)", async () => {
  const html = await render("settings", { ...base, ...CASES.settings });
  for (const label of Object.values(LIMIT_LABELS)) assert.ok(html.includes(label), label);
});
