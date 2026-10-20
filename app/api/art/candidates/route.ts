import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accountForUser } from "@/lib/mail/config";
import { ewsOpen, ewsReady, ewsSearch } from "@/lib/mail/ewsBox";
import { customerPeople } from "@/lib/designMail";
import { namesForPaths } from "@/lib/printavoFileMeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Where else a reorder's art might be, for the Printavo Art Resolution Center (Oct 20, Nick: "go into my email and
 * look at the original email on the bottles and pull the original artwork… here's what I found in the old Printavo,
 * I found this in the original email, I found this in the film folder… we walk through it together"):
 *  - their logo library: logos already on file whose name matches the design (used as they are, nothing new made);
 *  - emails with the customer about the design (the whole mailbox, every year, through Exchange; and emails kept in
 *    the portal): their attached art files (pictures, PDFs, .ai, .eps, .svg; not signatures).
 * GET ?customer=<id>&q=<design name>
 */
type Cand = { source: "library" | "email"; name: string; label: string; date: string; type: string; url?: string; path?: string; design_id?: string };
const ART = /\.(png|jpe?g|gif|webp|pdf|ai|eps|svg|psd|tiff?)$/i;
const STOP = new Set(["the", "and", "for", "tee", "tees", "shirt", "shirts", "order", "reorder", "printavo"]);

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v.user || !v.isStaff) return NextResponse.json({ error: "Staff only." }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const cid = sp.get("customer") || "";
  const admin0 = createAdminClient();
  // every file on the old Printavo job (mockups, production files, line and print pictures; not Printavo's 100 px
  // thumbnails), with their real names: shown first, to say what each one is (Oct 20, Nick: "there should be the
  // mockups, there should be production files… all I want you to do is ask me what those are")
  let old: { name: string; path: string; url: string; type: string }[] = [];
  const arch = sp.get("archived") || "";
  if (arch) {
    const { data: row } = await admin0.from("archived_orders").select("files, customer_id").eq("id", arch).maybeSingle();
    if (row && (!cid || row.customer_id === cid)) {
      const paths = [...new Set(Object.entries((row.files || {}) as Record<string, string>).filter(([k, v]) => typeof v === "string" && v.startsWith("printavo/") && !/resize=width:\d+/.test(k)).map(([, v]) => v))];
      const names = await namesForPaths(admin0, paths).catch(() => ({} as Record<string, { name: string }>));
      const { data: signed } = paths.length ? await admin0.storage.from("proofs").createSignedUrls(paths, 1800) : { data: [] };
      old = paths.map((p, i) => ({ path: p, name: names[p]?.name || p.split("/").pop()!.replace(/^[a-z0-9]+-/i, ""), url: signed?.[i]?.signedUrl || "", type: /\.pdf$/i.test(p) ? "application/pdf" : /\.(png|jpe?g|gif|webp)$/i.test(p) ? "image" : "file" })).filter((x) => x.url);
    }
  }
  const q = (sp.get("q") || "").replace(/^#\d+\s*/, "").replace(/\(Printavo\)/i, "").trim();
  if (!cid || !q) return NextResponse.json({ found: [], old });
  const admin = createAdminClient();
  const words = [...new Set(q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 3);
  if (!words.length) return NextResponse.json({ found: [], old });
  const found: Cand[] = [];

  // 1. their logo library
  const { data: ds } = await admin.from("designs").select("id, number, name, preview_path, file_path, created_at").eq("customer_id", cid).is("archived_at", null).or(words.map((w) => `name.ilike.%${w}%`).join(",")).order("created_at", { ascending: false }).limit(8);
  for (const d of ds || []) {
    const p = (d.preview_path || d.file_path) as string;
    if (!p) continue;
    const { data: s } = await admin.storage.from("proofs").createSignedUrl(p, 1800);
    found.push({ source: "library", design_id: d.id as string, name: `${d.number ? `D-${d.number} ` : ""}${d.name || "Logo"}`, label: "Their logo library", date: String(d.created_at || "").slice(0, 10), type: /\.pdf$/i.test(p) ? "application/pdf" : "image/png", url: s?.signedUrl || "" });
  }

  // 2. emails kept in the portal (their files are stored here)
  const hit = (t: unknown) => { const x = String(t || "").toLowerCase(); return words.some((w) => x.includes(w)); };
  const { data: acts } = await admin.from("activities").select("id, occurred_at, subject, body, from_email, meta").eq("customer_id", cid).eq("kind", "email").order("occurred_at", { ascending: false }).limit(400);
  for (const a of (acts || []).filter((x) => hit(x.subject) || hit(x.body)).slice(0, 15)) {
    const atts = (((a.meta || {}) as { attachments?: { name: string; path: string; type?: string; size?: number; signature?: boolean }[] }).attachments || []).filter((f) => f.path && ART.test(f.name || f.path) && !f.signature && !((f.size || 0) < 40_000 && /^(image|outlook|logo)/i.test(f.name || "")));
    for (const f of atts.slice(0, 6)) {
      const { data: s } = await admin.storage.from("proofs").createSignedUrl(f.path, 1800);
      found.push({ source: "email", name: f.name, label: `${a.from_email || "Email"} · "${String(a.subject || "").slice(0, 60)}"`, date: String(a.occurred_at).slice(0, 10), type: f.type || "", url: s?.signedUrl || "", path: f.path });
    }
  }

  // 3. the whole mailbox (older years), through Exchange: emails with their people that mention the design
  const acct = await accountForUser(admin, v.user!.id).catch(() => null);
  if (acct && (await ewsReady(admin, acct).catch(() => false))) {
    const who = await customerPeople(admin, cid);
    const me = acct.email.toLowerCase();
    const seen = new Set<string>();
    const msgs: { folder: string; uid: number; subject: string; from: string; date: string }[] = [];
    for (const w of words.slice(0, 2)) {
      const r = await ewsSearch(admin, acct, me, w).catch(() => null);
      for (const c of r?.convos || []) for (const m of c.msgs) {
        if (!who.theirs([m.from, ...(m.to || []), ...(m.cc || [])].join(" ")) || seen.has(`${m.folder}:${m.uid}`)) continue;
        seen.add(`${m.folder}:${m.uid}`);
        msgs.push({ folder: m.folder, uid: m.uid, subject: m.subject, from: m.fromName || m.from, date: m.date });
      }
    }
    // the oldest first: the original artwork is usually in the first emails about a design
    msgs.sort((a, b) => a.date.localeCompare(b.date));
    const stored = new Set(found.map((f) => `${f.name}|${f.date}`));
    for (const m of msgs.slice(0, 12)) {
      const full = await ewsOpen(admin, acct, m.folder, m.uid, (id) => id).catch(() => null);
      for (const at of (full?.ews || []).filter((x) => !x.inline && ART.test(x.name) && x.size > 20_000).slice(0, 5)) {
        if (stored.has(`${at.name}|${String(m.date).slice(0, 10)}`)) continue;
        found.push({ source: "email", name: at.name, label: `${m.from} · "${String(m.subject || "").slice(0, 60)}"`, date: String(m.date).slice(0, 10), type: at.type || "", url: `/api/mail/box?${new URLSearchParams({ do: "ewsatt", id: at.id })}` });
      }
    }
  }
  return NextResponse.json({ found: found.slice(0, 30), old });
}
