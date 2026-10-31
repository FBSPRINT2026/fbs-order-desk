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
