import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orderGroups, ST, type Order } from "@/lib/pricing";

/**
 * Can this order's art go to separations yet? The one check behind every "Request Separations" button (the
 * production calendar's job panel, the order page, the Mockup Creator), so separations are never made on art that
 * isn't finished:
 *
 * 1. The order is approved (not still a quote or a request).
 * 2. The art is approved: every proof sent to the customer is approved (none waiting, no change request without a
 *    newer proof after it), or someone on staff marked it approved another way (a call, an email), with a note saying
 *    how. A proof sent after that mark needs approving again.
 * 3. The art is final: each screen-print location has a saved design with an art file (not a quick text that was
 *    never saved, not an archived design).
 *
 * Requesting makes one separation per screen-print location that doesn't have one yet; its design (and so the art
 * file) is attached, and it opens in the Separation Center under Working.
 */
export type SepStage = "working" | "printed" | "archived";
export type SepItem = {
  groupId: string; group: string; imprintId: string; location: string; colors: number; garments: string[]; widthIn?: number;
  designId: string | null; design: string; problem: string;
  sep: { id: string; number: number; stage: SepStage } | null;
};
export type ArtGate = {
  ok: boolean; reasons: string[];
  approved: { via: "proof" | "staff"; by: string; at: string; note: string } | null;
  items: SepItem[]; ready: number;
};

const stageOf = (s: string): SepStage => (s === "films" ? "printed" : s === "cancelled" ? "archived" : "working");

export async function artGate(admin: SupabaseClient, orderId: string): Promise<{ order: Order | null; gate: ArtGate }> {
  const none: ArtGate = { ok: false, reasons: ["That order doesn't exist."], approved: null, items: [], ready: 0 };
  const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!o) return { order: null, gate: none };
  const order = o as Order;
  const [{ data: proofs }, { data: marks }, { data: seps }] = await Promise.all([
    admin.from("proofs").select("id, title, status, created_at, decided_at, decided_name").eq("order_id", orderId).order("created_at"),
    admin.from("order_events").select("detail, actor, created_at").eq("order_id", orderId).eq("kind", "art_approved").order("created_at", { ascending: false }).limit(1),
    admin.from("separations").select("id, number, status, imprint_id").eq("order_id", orderId).neq("status", "cancelled"),
  ]);
  const reasons: string[] = [];

  // 1. the order
  if (ST[order.status]?.type === "quote" || order.status === "request") reasons.push("The quote isn't approved yet.");

  // 2. the art approval
  const ps = (proofs || []) as { id: string; title: string; status: string; created_at: string; decided_at: string | null; decided_name: string | null }[];
  const lastProof = ps.length ? ps[ps.length - 1].created_at : "";
  const mark = (marks || [])[0] as { detail: string; actor: string; created_at: string } | undefined;
  const staffOk = !!mark && mark.created_at > lastProof;
  const pending = ps.filter((p) => p.status === "pending");
  const changes = ps.filter((p) => p.status === "changes" && !ps.some((q) => q.created_at > p.created_at));
  const yes = ps.filter((p) => p.status === "approved");
  let approved: ArtGate["approved"] = null;
  if (staffOk) {
    // saved as "Name: how they approved"
    const k = (mark!.detail || "").indexOf(": ");
    const by = k > 0 ? mark!.detail.slice(0, k) : mark!.actor, note = k > 0 ? mark!.detail.slice(k + 2) : mark!.detail || "";
    approved = { via: "staff", by, at: mark!.created_at, note };
  } else if (pending.length) reasons.push(pending.length === 1 ? `Waiting on the customer to approve the proof "${pending[0].title}".` : `Waiting on the customer to approve ${pending.length} proofs.`);
  else if (changes.length) reasons.push(`The customer asked for changes on "${changes[0].title}". Send the revised proof.`);
  else if (!yes.length) reasons.push(ps.length ? "No proof has been approved." : "No proof has gone to the customer yet.");
  else { const last = yes.slice().sort((a, b) => (b.decided_at || "").localeCompare(a.decided_at || ""))[0]; approved = { via: "proof", by: last.decided_name || "the customer", at: last.decided_at || "", note: last.title }; }

  // 3. the art itself, per screen-print location
  const groups = orderGroups(order);
  const screen = groups.flatMap((g) => g.imprints.filter((im) => im.method === "screen").map((im) => ({ g, im })));
  const ids = [...new Set(screen.map((x) => x.im.design_id).filter((x): x is string => !!x && !x.startsWith("qt-")))];
  const { data: ds } = ids.length ? await admin.from("designs").select("id, number, name, file_path, archived_at").in("id", ids) : { data: [] };
  const dmap = new Map(((ds || []) as { id: string; number: number; name: string; file_path: string; archived_at: string | null }[]).map((d) => [d.id, d]));
  const sepRows = (seps || []) as { id: string; number: number; status: string; imprint_id: string | null }[];
  const items: SepItem[] = screen.map(({ g, im }, i) => {
    const d = im.design_id ? dmap.get(im.design_id) : undefined;
    const s = sepRows.find((x) => x.imprint_id === im.id);
    const problem = !im.design_id ? "No artwork on this location yet." : im.design_id.startsWith("qt-") ? "The text on this location was never saved as a design." : !d ? "Its design can't be found." : d.archived_at ? `D-${d.number} is archived.` : !d.file_path ? `D-${d.number} has no art file.` : "";
    return {
      groupId: g.id, group: g.name || `Group ${groups.indexOf(g) + 1}`, imprintId: im.id, location: im.location || `Imprint ${i + 1}`, colors: im.colors || 0,
      widthIn: parseFloat(String(im.size || "").replace(/[^\d.]/g, " ").trim().split(/\s+/)[0]) || undefined,
      garments: [...new Set(g.lines.map((l) => l.color).filter(Boolean))], designId: d?.id || null, design: d ? `D-${d.number}${d.name ? " " + d.name : ""}` : "", problem,
      sep: s ? { id: s.id, number: s.number, stage: stageOf(s.status) } : null,
    };
  });
  if (!screen.length) reasons.push("This order has no screen-print locations.");
  const ready = reasons.length ? 0 : items.filter((x) => !x.sep && !x.problem).length;
  return { order, gate: { ok: !reasons.length, reasons, approved, items, ready } };
}

/** Make the missing separations (all of them, or just `only` locations) once the gate is open. */
export async function requestSeparations(admin: SupabaseClient, orderId: string, by: string, only?: string[]) {
  const { order, gate } = await artGate(admin, orderId);
  if (!order) return { ok: false as const, error: "That order doesn't exist.", gate };
  if (!gate.ok) return { ok: false as const, error: gate.reasons[0], gate };
  const want = gate.items.filter((x) => !x.sep && (!only || only.includes(x.imprintId)));
  const blocked = want.filter((x) => x.problem);
  const go = want.filter((x) => !x.problem);
  if (!go.length) return { ok: false as const, error: blocked[0] ? `${blocked[0].location}: ${blocked[0].problem}` : "Every location already has a separation.", gate };
  const rows = go.map((x) => ({
    order_id: order.id, group_id: x.groupId, imprint_id: x.imprintId, location: x.location, design_id: x.designId, customer_id: order.customer_id,
    garment_color: x.garments[0] || "", due_date: order.due_date, requested_by: by, status: "requested", settings: { garments: x.garments, ...(x.widthIn ? { widthIn: x.widthIn } : {}) },
  }));
  const { error } = await admin.from("separations").insert(rows);
  if (error) return { ok: false as const, error: error.message, gate };
  await admin.from("order_events").insert({ order_id: order.id, kind: "seps_requested", detail: go.map((x) => x.location).join(", "), actor: by });
  const after = (await artGate(admin, orderId)).gate;
  return { ok: true as const, made: go.length, skipped: blocked.map((x) => `${x.location}: ${x.problem}`), gate: after };
}
