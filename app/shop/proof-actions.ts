"use server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { orderGroups, type GLine, type Imprint, type Order } from "@/lib/pricing";

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

export async function restoreVersion(proofId: string, which: "ours" | "theirs"): Promise<{ ok: true; open?: string } | { ok: false; error: string }> {
  try {
    const { user, isStaff, email } = await getViewer();
    if (!user || !isStaff) return { ok: false, error: "Only shop staff can do that." };
    const admin = createAdminClient();
    const { data: pf } = await admin.from("proofs").select("*").eq("id", proofId).maybeSingle();
    if (!pf) return { ok: false, error: "Proof not found." };
    const { data: od } = await admin.from("orders").select("*").eq("id", pf.order_id).maybeSingle();
    if (!od) return { ok: false, error: "Order not found." };
    const o = od as Order;
    const { data: mk } = await admin.from("mockups").select("*").eq("proof_id", proofId).maybeSingle();
    const groups = orderGroups(o);
    const gid = (which === "theirs" ? (pf.customer_change as { group_id?: string } | null)?.group_id : null) || mk?.group_id;
    const g = groups.find((x) => x.id === gid) || (groups.length === 1 ? groups[0] : null);
    if (!g) return { ok: false, error: "Couldn't tell which group this proof is for." };
    const snap = (which === "theirs" ? pf.customer_change : mk?.snapshot) as Snap | null;
    if (!snap?.imprints) return { ok: false, error: which === "theirs" ? "The customer's version wasn't saved with this proof." : "This version was made before versions were saved (Oct 15), so it can't be brought back. Its picture is still here." };

    // garments: the style and color go back on each garment line (matched by line, or the only line); quantities stay
    const one = snap.lines.length === 1 && g.lines.length >= 1;
    const lines = g.lines.map((l, i) => {
      const s = snap.lines.find((x) => x.id && x.id === l.id) || (one ? snap.lines[0] : snap.lines[i]);
      return s ? { ...l, style: s.style, brand: s.brand, color: s.color, garment: s.garment } : l;
    });
    const at = new Date().toISOString();
    let ng = { ...g, lines, imprints: snap.imprints.map((d) => ({ ...d })) };

    if (which === "ours") {
      if (!mk) return { ok: false, error: "This proof has no saved mockup." };
      ng = { ...ng, mockupSize: snap.mockupSize || g.mockupSize, mockupThumbs: snap.mockupThumbs?.length ? snap.mockupThumbs : [String(mk.file_path).replace(/\.png$/, "-thumb.png")], mockupAt: at };
      // the newer versions step aside (archived, not deleted)
      const { data: live } = await admin.from("mockups").select("id, proof_id").eq("order_id", o.id).eq("group_id", g.id).is("archived_at", null);
      const ids = ((live || []) as { id: string; proof_id: string | null }[]);
      if (ids.length) {
        await admin.from("mockups").update({ archived_at: at }).in("id", ids.map((x) => x.id));
        const pids = ids.map((x) => x.proof_id).filter(Boolean) as string[];
        if (pids.length) await admin.from("proofs").update({ archived_at: at }).in("id", pids);
      }
      // a copy of that version is the current proof again, waiting on the customer
      const { data: np } = await admin.from("proofs").insert({ order_id: o.id, title: pf.title, file_path: pf.file_path, file_type: pf.file_type }).select("id").single();
      await admin.from("mockups").insert({ customer_id: mk.customer_id, order_id: o.id, group_id: g.id, proof_id: np?.id || null, title: mk.title, file_path: mk.file_path, design_ids: mk.design_ids || [], created_by: email, snapshot: snap });
    }
    const all = groups.map((x) => (x.id === g.id ? ng : x));
    const { error } = await admin.from("orders").update({ groups: all, updated_at: at }).eq("id", o.id);
    if (error) return { ok: false, error: error.message };
    await admin.from("order_events").insert({ order_id: o.id, kind: "proof_restored", detail: which === "ours" ? `Went back to an earlier proof: ${pf.title}` : `Used the customer's own version: ${pf.title}`, actor: email });
    return which === "theirs" ? { ok: true, open: `/shop/artwork/mockup?order=${o.id}&group=${g.id}` } : { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }; }
}
