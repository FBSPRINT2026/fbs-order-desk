// Class names two features both define in app/globals.css (Oct 31: the Assistant's to-do cards were squeezed to 96px
// and stacked because the Inbox's after-send pop-up and the Artwork shelf also used .as-card / .as-t). Lists every class
// with a base rule (".name{" at the start of a line) in two places far apart that's used by more than one file, so a
// new feature never borrows another's name by accident. Run: node scripts/css-clashes.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync("app/globals.css", "utf8").split("\n");
const defs = new Map();
css.forEach((l, i) => { const m = /^\.([a-z][\w-]*)\{/.exec(l); if (m) defs.set(m[1], [...(defs.get(m[1]) || []), i + 1]); });
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { if (["node_modules", ".next", ".claude", ".git"].includes(f)) continue; const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".tsx")) files.push(p); } };
walk("app"); walk("components");
const src = files.map((f) => [f, readFileSync(f, "utf8")]);
const out = [];
for (const [c, lines] of defs) {
  if (lines.length < 2 || Math.max(...lines) - Math.min(...lines) < 400) continue;
  const re = new RegExp(`"[^"\\n]*(?<![\\w-])${c.replace(/[-]/g, "\\-")}(?![\\w-])[^"\\n]*"`);
  const users = src.filter(([, s]) => re.test(s)).map(([f]) => f);
  if (users.length >= 2) out.push(`${c}  lines ${lines.join(", ")}  used by ${users.join(", ")}`);
}
console.log(out.length ? out.join("\n") : "No clashes.");

// Grids that drop to one column on a smaller screen but still put a child in column 2 or 3 (Oct 31: the Calendar's side
// panel kept grid-column:2 under 900px, so the grid grew an extra column and squeezed the calendar to a sliver)
const flat = [];
const parse = (str, media) => {
  for (let j = 0; j < str.length;) {
    const ob = str.indexOf("{", j); if (ob < 0) break;
    const head = str.slice(j, ob).trim();
    let d = 1, k = ob + 1; while (k < str.length && d) { if (str[k] === "{") d++; else if (str[k] === "}") d--; k++; }
    const body = str.slice(ob + 1, k - 1);
    if (head.startsWith("@media")) parse(body, head); else if (!head.startsWith("@")) flat.push({ media, sel: head, body });
    j = k;
  }
};
parse(css.join("\n").replace(/\/\*[\s\S]*?\*\//g, ""), "");
const orphans = new Set();
for (const r of flat.filter((x) => x.media && /grid-template-columns:\s*(1fr|minmax\(0,\s*1fr\)|100%)\s*(!important)?\s*(;|$)/.test(x.body)))
  for (const s of r.sel.split(",")) {
    const cls = (s.trim().match(/\.([\w-]+)(?![\s\S]*\.[\w-])/) || [])[1]; if (!cls) continue;
    for (const p of flat) {
      if (p.media || !/grid-column:\s*([2-9]|span\s*[2-9])/.test(p.body)) continue;
      const part = p.sel.split(",").find((q) => new RegExp(`\\.${cls}\\b[^,]*[ >]+\\S`).test(q)); if (!part) continue;
      const bits = part.trim().split(/\s*>\s*|\s+/), tail = bits.pop(), box = bits.join(" ");
      // its box isn't a grid at all (".gb.dense" is a flex list): nothing to orphan
      if (flat.some((x) => !x.media && x.sel.split(",").some((q) => q.trim() === box) && /display:\s*(flex|block)/.test(x.body))) continue;
      if (!flat.some((x) => x.media === r.media && x.sel.includes(tail) && /grid-(column|area|row)/.test(x.body)))
        orphans.add(`${r.media} .${cls} is one column, but "${part.trim()}" stays in ${p.body.match(/grid-column:[^;]+/)[0]}`);
    }
  }
console.log(orphans.size ? "\nOne-column grids with a child left in another column:\n" + [...orphans].join("\n") : "No one-column grid orphans.");
