"use server";
import { mockupHref } from "@/lib/mockupFresh";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orderGroups, type GLine, type Imprint, type Order } from "@/lib/pricing";
import { approveAnotherWay, remindProofs, sendProofs, unapproveArt as unapproveArtLib } from "@/lib/proofs";

/**
 * Going back in time on a group's mockups (Oct 15, Nick: "if the customer makes their own changes… have the history
 * of edits and be able to go back in time"). Nothing is overwritten or deleted: going back adds a new version.
 *
 * - "ours": an earlier proof we made. Its garments (style, color) and prints go back on the group, its mockup is the
 *   current one again, and a copy of that proof is put up for the customer (the newer version is archived).
 * - "theirs": the version the customer made in their Mockup Creator. Its garments and prints go on the group, and the
 *   shop opens the Mockup Creator to check it can print and save the new proof.
 */
type Snap = { lines: (Pick<GLine, "style" | "brand" | "color" | "garment"> & { id?: string })[]; imprints: Imprint[]; mockupSize?: string | null; mockupThumbs?: string[] };

export async function restoreVersion(proofId: string, which: "ours" | "theirs", mockupId?: string): Promise<{ ok: true; open?: string } | { ok: false; error: string }> {
  try {
    const { user, isStaff, email } = await getViewer();
    if (!user || !isStaff) return { ok: false, error: "Only shop staff can do that." };
    const admin = createAdminClient();
    // going back to a mockup save (the Mockup history), or to a proof's mockup
    const { data: pf0 } = proofId ? await admin.from("proofs").select("*").eq("id", proofId).maybeSingle() : { data: null };
    const { data: mk0 } = mockupId ? await admin.from("mockups").select("*").eq("id", mockupId).maybeSingle() : { data: null };
    const pf = pf0 || (mk0 ? { order_id: mk0.order_id, title: mk0.title, file_path: mk0.file_path, file_type: "image/png", customer_change: null } : null);
    if (!pf) return { ok: false, error: "Proof not found." };
    const { data: od } = await admin.from("orders").select("*").eq("id", pf.order_id).maybeSingle();
    if (!od) return { ok: false, error: "Order not found." };
    const o = od as Order;
    const mk = mk0 || (pf0?.mockup_id ? (await admin.from("mockups").select("*").eq("id", pf0.mockup_id).maybeSingle()).data : (await admin.from("mockups").select("*").eq("proof_id", proofId).maybeSingle()).data);
    const groups = orderGroups(o);
    const gid = (which === "theirs" ? (pf.customer_change as { group_id?: string } | null)?.group_id : null) || mk?.group_id;
    const g = groups.find((x) => x.id === gid) || (groups.length === 1 ? groups[0] : null);
    if (!g) return { ok: false, error: "Couldn't tell which group this proof is for." };
    const snap = (which === "theirs" ? pf.customer_change : mk?.snapshot) as Snap | null;
    if (!snap?.imprints) return { ok: false, error: which === "theirs" ? "The customer's version wasn't saved with this proof." : "This version was made before versions were saved (Oct 15), so it can't be brought back. Its picture is still here." };

    // garments: the style and color go back on each garment line (matched by line, or the only line); quantities stay
    const one = snap.lines.length === 1 && g.lines.length >= 1;
    const lines = g.lines.map((l, i) => {
      // the customer never sees the shop's own pieces, so their version only reaches those by id
      const s = snap.lines.find((x) => x.id && x.id === l.id) || (l.shopUse ? undefined : one ? snap.lines[0] : snap.lines[i]);
      return s ? { ...l, style: s.style, brand: s.brand, color: s.color, garment: s.garment } : l;
    });
    const at = new Date().toISOString();
    let ng = { ...g, lines, imprints: snap.imprints.map((d) => ({ ...d })) };

    if (which === "ours") {
      if (!mk) return { ok: false, error: "This proof has no saved mockup." };
      ng = { ...ng, mockupSize: snap.mockupSize || g.mockupSize, mockupThumbs: snap.mockupThumbs?.length ? snap.mockupThumbs : [String(mk.file_path).replace(/\.png$/, "-thumb.png")], mockupAt: at, mockupArt: undefined };
      // the newer versions step aside (archived, not deleted)
      const { data: live } = await admin.from("mockups").select("id, proof_id").eq("order_id", o.id).eq("group_id", g.id).is("archived_at", null);
      const ids = ((live || []) as { id: string; proof_id: string | null }[]);
      if (ids.length) {
        await admin.from("mockups").update({ archived_at: at }).in("id", ids.map((x) => x.id));
        const pids = ids.map((x) => x.proof_id).filter(Boolean) as string[];
        if (pids.length) await admin.from("proofs").update({ archived_at: at }).in("id", pids);
      }
      // that mockup is the current one again (a new mockup row); it goes to the customer when they're sent the next version
      await admin.from("mockups").insert({ customer_id: mk.customer_id, order_id: o.id, group_id: g.id, proof_id: null, title: mk.title, file_path: mk.file_path, design_ids: mk.design_ids || [], created_by: email, snapshot: snap });
    }
    const all = groups.map((x) => (x.id === g.id ? ng : x));
    const { error } = await admin.from("orders").update({ groups: all, updated_at: at }).eq("id", o.id);
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert({ order_id: o.id, kind: "proof_restored", detail: which === "ours" ? `Went back to an earlier mockup: ${pf.title}` : `Used the customer's own version: ${pf.title}`, actor: email });
    return which === "theirs" ? { ok: true, open: mockupHref(o.id, g) } : { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}

/**
 * Use a sent version again (Nov 2, Nick: "oh no, I want version one back again"): every mockup of that version becomes the
 * current mockup again (the newer ones step aside, archived, not deleted), and the order's prints and garments go back to
 * how they were in it. Nothing is sent: the Versions list shows it as not sent yet, to send as the next version or mark
 * approved.
 */
export async function bringBackVersion(orderId: string, version: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { user, isStaff, email } = await getViewer();
    if (!user || !isStaff) return { ok: false, error: "Only shop staff can do that." };
    const admin = createAdminClient();
    const { data: ps } = await admin.from("proofs").select("id, mockup_id").eq("order_id", orderId).eq("version", version);
    const mids = [...new Set(((ps || []) as { mockup_id: string | null }[]).map((p) => p.mockup_id).filter(Boolean))] as string[];
    if (!mids.length) return { ok: false, error: `Version ${version} has no saved mockups to bring back. Its pictures are still here.` };
    const { data: ms } = await admin.from("mockups").select("*").in("id", mids).order("created_at");
    const mks = (ms || []) as { id: string; customer_id: string | null; group_id: string | null; title: string; file_path: string; design_ids: string[] | null; snapshot: Snap | null }[];
    const { data: od } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!od) return { ok: false, error: "Order not found." };
    const o = od as Order;
    const groups = orderGroups(o);
    const at = new Date().toISOString();
    const byGroup = new Map<string, typeof mks>();
    for (const m of mks) { const gid = m.group_id || (groups.length === 1 ? groups[0].id : ""); if (!gid) continue; byGroup.set(gid, [...(byGroup.get(gid) || []), m]); }
    if (!byGroup.size) return { ok: false, error: "Couldn't tell which group this version is for." };
    const all = groups.map((g) => {
      const list = byGroup.get(g.id);
      const snap = list?.find((m) => m.snapshot?.imprints)?.snapshot;
      if (!list || !snap?.imprints) return g;
      const one = snap.lines.length === 1;
      const lines = g.lines.map((l, i) => { const x = snap.lines.find((y) => y.id && y.id === l.id) || (l.shopUse ? undefined : one ? snap.lines[0] : snap.lines[i]); return x ? { ...l, style: x.style, brand: x.brand, color: x.color, garment: x.garment } : l; });
      return { ...g, lines, imprints: snap.imprints.map((d) => ({ ...d })), mockupSize: snap.mockupSize || g.mockupSize, mockupThumbs: list.map((m) => String(m.file_path).replace(/\.png$/, "-thumb.png")), mockupAt: at, mockupArt: undefined };
    });
    for (const [gid, list] of byGroup) {
      const { data: live } = await admin.from("mockups").select("id, proof_id").eq("order_id", orderId).eq("group_id", gid).is("archived_at", null);
      const rows = (live || []) as { id: string; proof_id: string | null }[];
      if (rows.length) await admin.from("mockups").update({ archived_at: at }).in("id", rows.map((x) => x.id));
      await admin.from("mockups").insert(list.map((m) => ({ customer_id: m.customer_id, order_id: orderId, group_id: gid, proof_id: null, title: m.title, file_path: m.file_path, design_ids: m.design_ids || [], created_by: email, snapshot: m.snapshot })));
    }
    const { error } = await admin.from("orders").update({ groups: all, updated_at: at }).eq("id", orderId);
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert({ order_id: orderId, kind: "proof_restored", detail: `Went back to Version ${version}`, actor: email });
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}

async function me() {
  const v = await getViewer();
  if (!v.user || !v.isStaff) throw new Error("Only shop staff can do that.");
  const { data } = await v.supabase.from("staff").select("name").eq("email", v.email).maybeSingle();
  return { email: v.email, name: (data?.name as string) || v.email.split("@")[0] };
}
const run = async <T,>(f: () => Promise<T>) => { try { return await f(); } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "Something went wrong." }; } };

/** Send the current mockups to the customer as the next proof version (emailed). */
export async function sendProofVersion(orderId: string, note = "") { return run(async () => sendProofs(createAdminClient(), orderId, await me(), note)); }
/** Remind the customer to review the proof waiting on them (emailed). */
export async function remindProof(orderId: string) { return run(async () => remindProofs(createAdminClient(), orderId, await me())); }
/** The customer approved another way: overrides every other approval. */
export async function approveArtAnotherWay(orderId: string, note: string) { return run(async () => approveAnotherWay(createAdminClient(), orderId, await me(), note)); }
export async function unapproveArt(orderId: string) { return run(async () => unapproveArtLib(createAdminClient(), orderId, await me())); }
