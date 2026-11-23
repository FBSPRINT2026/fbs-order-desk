"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadJobCard, type JobCard } from "@/lib/jobCard";
import { statusText } from "@/lib/pricing";
import { groupPictures } from "@/lib/mockupFresh";
import type { Group } from "@/lib/types";

/**
 * The shop computers' one search (components/StationShell.tsx; Nick, Nov 23 2026: "all the employees need to be able to
 * just look at a job… a little search bar"): a job #, a customer, a PO or a job name. A whole job # finds any job, done
 * or not; words find the open ones.
 */
export type StationHit = { kind: "o" | "a"; id: string; number: string; job: string; customer: string; status: string; due: string | null };

const OPEN = ["approved", "production", "fulfillment", "ready", "quote", "quote_sent", "art", "revision", "request"];
const clean = (s: string) => String(s || "").replace(/[%,()]/g, " ").trim().slice(0, 60);

export async function stationFind(q: string): Promise<{ ok: true; hits: StationHit[] } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Staff only." };
    const admin = createAdminClient();
    const t = clean(q), num = t.replace(/^#/, "");
    if (t.length < 2) return { ok: true, hits: [] };
    const isNum = /^\d{3,7}$/.test(num);
    const { data: cs } = isNum ? { data: [] } : await admin.from("customers").select("id").or(`company.ilike.%${t}%,name.ilike.%${t}%`).limit(25);
    const cids = ((cs || []) as { id: string }[]).map((c) => c.id);
    const ors = isNum ? `number.eq.${num}` : [`nickname.ilike.%${t}%`, `po_number.ilike.%${t}%`, ...(cids.length ? [`customer_id.in.(${cids.join(",")})`] : [])].join(",");
    const aors = isNum ? `visual_id.eq.${num}` : [`nickname.ilike.%${t}%`, `po_number.ilike.%${t}%`, ...(cids.length ? [`customer_id.in.(${cids.join(",")})`] : [])].join(",");
    let oq = admin.from("orders").select("id, number, nickname, due_date, customer_id, status, delivery_method").is("discarded_at", null).or(ors);
    if (!isNum) oq = oq.in("status", OPEN);
    const [n, a] = await Promise.all([
      oq.order("due_date", { ascending: true, nullsFirst: false }).limit(25),
      admin.from("archived_orders").select("id, visual_id, nickname, due_date, customer_id, status_name").is("removed_at", null).or(aors).order("order_date", { ascending: false }).limit(isNum ? 5 : 10),
    ]);
    type N = { id: string; number: number; nickname: string; due_date: string | null; customer_id: string | null; status: string; delivery_method: string | null };
    type A = { id: string; visual_id: string; nickname: string; due_date: string | null; customer_id: string | null; status_name: string };
    const ns = (n.data || []) as N[], as = (a.data || []) as A[];
    const ids = [...new Set([...ns, ...as].map((o) => o.customer_id).filter(Boolean))] as string[];
    const { data: cc } = ids.length ? await admin.from("customers").select("id, company, name").in("id", ids) : { data: [] };
    const cust = new Map(((cc || []) as { id: string; company: string; name: string }[]).map((c) => [c.id, c.company || c.name || ""]));
    const hits: StationHit[] = [
      ...ns.map((o) => ({ kind: "o" as const, id: o.id, number: String(o.number), job: o.nickname || "", customer: cust.get(o.customer_id || "") || "", status: statusText(o.status, o.delivery_method), due: o.due_date })),
      ...as.map((o) => ({ kind: "a" as const, id: o.id, number: o.visual_id, job: o.nickname || "", customer: cust.get(o.customer_id || "") || "", status: o.status_name || "", due: o.due_date })),
    ];
    return { ok: true, hits: hits.slice(0, 25) };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** one job to look at (garments, sizes, prints, where it goes): the same card the box label and the crew's phones use,
 *  with each group's mockup picture (groupPictures: ours, a placement picture, theirs, else the logo) */
export type StationMock = { name: string; thumb: string; full: string };
export async function stationJob(kind: "o" | "a", id: string): Promise<{ ok: true; job: JobCard; mockups: StationMock[] } | { ok: false; error: string }> {
  try {
    const v = await getViewer();
    if (!v.user || !v.isStaff) return { ok: false, error: "Staff only." };
    const admin = createAdminClient();
    const job = await loadJobCard(admin, { kind, id });
    if (!job) return { ok: false, error: "That job isn't here." };
    let mockups: StationMock[] = [];
    if (kind === "o") {
      const { data: og } = await admin.from("orders").select("groups").eq("id", id).maybeSingle();
      const groups = (og?.groups || []) as Group[];
      const dIds = [...new Set(groups.flatMap((g) => (g.imprints || []).map((d) => d.design_id).filter(Boolean)))] as string[];
      const { data: ds } = dIds.length ? await admin.from("designs").select("id, preview_path").in("id", dIds) : { data: [] };
      const logos = Object.fromEntries(((ds || []) as { id: string; preview_path: string }[]).map((d) => [d.id, d.preview_path]));
      const gs = groups.map((g, i) => ({ name: g.name?.trim() || `Group ${i + 1}`, paths: groupPictures(g, false, logos) }));
      const all = [...new Set(gs.flatMap((g) => g.paths.flatMap((x) => [x, x.replace(/-thumb\.png$/, ".png")])))];
      const signed = all.length ? (await admin.storage.from("proofs").createSignedUrls(all, 3600)).data || [] : [];
      const url = new Map<string, string>(signed.filter((x) => x.signedUrl && !x.error).map((x) => [String(x.path), String(x.signedUrl)]));
      mockups = gs.flatMap((g) => g.paths.map((x) => ({ name: g.name, thumb: url.get(x) || "", full: url.get(x.replace(/-thumb\.png$/, ".png")) || url.get(x) || "" }))).filter((m) => m.thumb || m.full);
    }
    return { ok: true, job, mockups };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
