// Reads that can quietly stop at 1,000 rows (Oct 31, Nov 1). The database answers at most 1,000 rows per request,
// whatever .limit() says. Two kinds are listed:
//  1. a .limit() over 1,000, anywhere in the query (the query can be built over several lines);
//  2. a whole growing table read with nothing that narrows it (orders, customers, logos, mockups, payments… all pass
//     1,000 within months: logos grow 100+ a week). Narrowing = a filter on an id, a customer, an order, a number, a
//     date range, a .limit(), .maybeSingle() / .single(), a count only (head: true). .is("archived_at", null) and
//     .eq("draft", false) don't narrow it.
// Read those with readAll / allRows from lib/readAll.ts (fixed order: end with .order("id")).
// Run: node scripts/big-reads.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { if (["node_modules", ".next", ".claude", ".git"].includes(f)) continue; const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p)) files.push(p); } };
["app", "components", "lib"].forEach(walk);
// tables that grow with the business (a customer's own rows in the portal are few, but staff see them all)
const GROWING = ["orders", "customers", "designs", "mockups", "payments", "archived_orders", "text_messages", "activities", "time_punches", "clickup_tasks", "ai_runs", "ai_suggestions", "messages", "proofs", "order_supplies", "goods_checkins", "mail_index", "mail_cache", "qbo_changes", "qbo_log", "ui_translations", "garment_necks", "supplier_manifest_lines"];
const NARROW = /\.(eq|neq|in|match|contains|containedBy|ilike|like|or|gte|gt|lte|lt|textSearch|range|limit|maybeSingle|single)\(|head: true|\.filter\(/;
const BROAD_ONLY = /\.(eq)\("(draft|archived|active)", (true|false)\)|\.eq\("kind", "[a-z_]+"\)/g;
const out = [];
for (const f of files) {
  const src = readFileSync(f, "utf8"), lines = src.split("\n");
  lines.forEach((l, i) => {
    if (/allRows|readAll|fetchAll|inChunks/.test(l)) return;
    // the query as written: this line and the lines that carry on its chain (start with ".")
    let q = l;
    for (let k = i + 1; k < Math.min(lines.length, i + 6) && /^\s*\./.test(lines[k]); k++) q += lines[k];
    const lim = /\.limit\((\d+)\)/.exec(q);
    const m = /\.from\("([a-z_]+)"\)\s*\.select\(/.exec(q);
    if (m && lim && Number(lim[1]) > 1000) { out.push(`${f}:${i + 1}  ${m[1]} .limit(${lim[1]})`); return; }
    // a builder kept in a const and limited later (const q = …select(…); … q.gte(…).limit(1500))
    if (!m) { const later = /\b(\w+)\.[a-z]+\([^\n]*\.limit\((\d+)\)/.exec(l); if (later && Number(later[2]) > 1000) out.push(`${f}:${i + 1}  ${later[1]} … .limit(${later[2]})`); return; }
    if (!GROWING.includes(m[1])) return;
    const rest = q.slice(m.index).replace(BROAD_ONLY, "");
    // a builder kept for later filters (const q = sb.from("orders").select("*"); q.eq(…)) isn't a read by itself
    // (".is("removed_at", null)" on old orders only hides ones deleted in Printavo: it doesn't make a builder a read)
    const lb = l.replace('.is("removed_at", null)', "");
    if (/^\s*(const|let)\s+\w+\s*=\s*(\(\)\s*=>\s*)?\w+\.from\(/.test(lb) && !/"\)\.\w+\(/.test(lb.slice(lb.indexOf(".select(")))) return;
    if (!NARROW.test(rest)) out.push(`${f}:${i + 1}  ${m[1]}: the whole table, read in one go`);
  });
}
console.log(out.length ? out.join("\n") : "No reads that stop at 1,000 rows.");
