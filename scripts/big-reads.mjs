// Queries that ask for more than 1,000 rows in one go (Oct 31). The database answers at most 1,000 rows per request,
// whatever .limit() says, so these quietly stop at 1,000: read them with readAll / allRows from lib/readAll.ts.
// Run: node scripts/big-reads.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { if (["node_modules", ".next", ".claude", ".git"].includes(f)) continue; const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p)) files.push(p); } };
["app", "components", "lib"].forEach(walk);
const out = [];
for (const f of files) readFileSync(f, "utf8").split("\n").forEach((l, i) => {
  const m = /\.from\("([a-z_]+)"\)[^\n]*?\.limit\((\d+)\)/.exec(l);
  if (m && Number(m[2]) > 1000 && !/allRows|readAll/.test(l)) out.push(`${f}:${i + 1}  ${m[1]} .limit(${m[2]})`);
});
console.log(out.length ? out.join("\n") : "No reads over 1,000 rows.");
