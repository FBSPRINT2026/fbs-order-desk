// How the stitch estimate (lib/embroidery.ts densityFor) compares with the digitizer's real counts.
// Paste the rows from this query into rows.json and run: node scripts/stitch-fit.mjs rows.json
//   select d.name, (f->>'wIn')::numeric w, (f->>'hIn')::numeric h, (f->>'stitches')::int st, (f->>'colors')::int c
//   from designs d, jsonb_array_elements(coalesce(d.specs->'embroidery'->'files','[]')) f where (f->>'stitches')::numeric > 0;
// It assumes 45% of each logo's box is stitched (the calculator reads the real share off the logo's picture).
import fs from "node:fs";
const density = (a) => (a <= 1.5 ? 2700 : a <= 4 ? 2700 - ((a - 1.5) / 2.5) * 1350 : a >= 20 ? 1150 : 1350 - ((a - 4) / 16) * 200);
const est = (w, h, c, cov = 0.45) => Math.max(1000, Math.round((w * h * cov * density(w * h * cov) * 1.2 + Math.max(1, c) * 20) / 100) * 100);
const rows = JSON.parse(fs.readFileSync(process.argv[2] || "rows.json", "utf8"));
const seen = new Set(); const errs = [];
for (const r of rows) {
  const k = `${r.name}|${r.w}|${r.h}`; if (seen.has(k)) continue; seen.add(k);
  const e = est(+r.w, +r.h, +r.c), off = (e - r.st) / r.st;
  errs.push(off); console.log(`${r.name.slice(0, 34).padEnd(34)} ${r.w}×${r.h}  real ${r.st}  est ${e}  ${(off * 100).toFixed(0)}%`);
}
errs.sort((a, b) => a - b);
console.log(`median ${(errs[Math.floor(errs.length / 2)] * 100).toFixed(0)}% over ${errs.length} logos`);
