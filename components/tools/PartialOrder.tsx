"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { OrderStart } from "@/components/OrderStartPick";
import type { EODraft } from "@/lib/emailOrderShared";
import type { Group } from "@/lib/pricing";
import { openOrderCheck } from "@/components/tools/OrderReview";

/**
 * Create order's "Other options" (Oct 24, Nick: "sometimes it's just going to be too hard… I want to basically be able to
 * bypass the whole thing… if I just wanted you to put the sizes and quantities in, and then I'll just deal with the art
 * later… bring in the sizes only, or add the art to a blank order, or just make the mock-up"). A part of the order,
 * made in one go with no questions (the full Create order, QuickOrder, does the rest):
 *  - sizes:  the garments, colors, sizes and quantities; no prints, art or mockup
 *  - art:    the art and its prints (locations, inks); no garments yet
 *  - mockup: garments and art, straight into the Mockup Creator (no art questions)
 *  - empty:  the customer and the email's files on a blank order
 */
export type PartKind = "sizes" | "art" | "mockup" | "empty";
export const PARTIAL: Record<PartKind, { label: string; sub: string; told: string }> = {
  sizes: { label: "Bring in the sizes only", sub: "Garments, colors, sizes and quantities. No art, prints or mockup.", told: "Staff want ONLY the garments: style, color and every size quantity. Leave out prints and art (they're added later); don't ask about art. What they say about the decoration goes in notes for staff (not customer_notes or a group's description)." },
  art: { label: "Add the art to a blank order", sub: "The art and its prints (locations, inks). No garments or sizes yet.", told: "Staff want ONLY the prints and their art (location, size, inks, the art file for each). Garments are added later; don't ask about sizes." },
  mockup: { label: "Just make the mockup", sub: "The art on their garment colors, straight into the Mockup Creator. Sizes later.", told: "Staff want the garments' styles and colors and the prints with their art, to make the mockup. Don't ask questions; take your best guess." },
  empty: { label: "Empty order with the files", sub: "The customer and their files on a blank order. You fill it in.", told: "Staff only want a blank order for this customer with the job name and dates; they fill in the garments and prints themselves." },
};
const pcsOf = (gs: Group[]) => gs.reduce((n, g) => n + g.lines.reduce((m, l) => m + Object.values(l.sizes || {}).reduce((a, v) => a + (+v || 0), 0), 0), 0);

/** what a partial step needs to read the email again (kept in the Order chat for the next steps) */
export type PartialCtx = { activity: string; told?: string; note?: string; job?: string | null; jobs?: string[]; include?: string[]; exclude?: string[]; part?: { key: string; told?: string; job?: string | null; pieces?: number; names?: string[]; label?: string } | null; orderType?: string };
export const ctxOf = (activityId: string, start: OrderStart): PartialCtx => {
  const p = start.parts?.[0] || null;
  return { activity: activityId, told: start.told || "", note: start.note || "", job: start.job || null, jobs: start.jobs || [], include: start.include || [], exclude: start.exclude || [],
    part: p ? { key: p.key, told: p.told || "", job: p.job ?? null, pieces: p.pieces, names: p.names || [], label: p.label } : null, ...(p?.orderType || start.orderType ? { orderType: (p?.orderType || start.orderType) as string } : {}) };
};
/** what's on the order so far: the garments, the prints, or both */
export const doneOf = (gs: Group[]): PartKind[] => [
  ...(gs.some((g) => g.lines.some((l) => Object.keys(l.sizes || {}).length)) ? ["sizes" as const] : []),
  ...(gs.some((g) => g.imprints.length) ? ["art" as const] : []),
];

/**
 * One partial step (Oct 24 / Oct 27): read the email for just this part and make the order, or add it to the order made
 * (into). Used by the panel here and by the Order chat's "Next" (components/tools/OrderReview.tsx).
 */
export async function partialStep(ctx: PartialCtx, mode: PartKind, into: { id: string; number: number } | null, step: (s: string) => void) {
  const m = PARTIAL[mode], part = ctx.part || null, activityId = ctx.activity;
  const read = async (fix = "") => {
    const told = [part ? part.told || "" : ctx.told || "", m.told, ctx.note || "", fix].filter(Boolean).join("\n");
    const r = await fetch("/api/inbox/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, told, job: part ? (part.job ?? null) : ctx.job || null, jobs: part ? [] : ctx.jobs || [], reorderOk: !!(part ? part.job : ctx.job), ...(part ? { part: part.key } : {}), include: ctx.include || [], exclude: ctx.exclude || [] }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    if (!r?.ok || !j.draft) throw new Error(j.error || "The AI couldn't read this email.");
    return j.draft as EODraft;
  };
  step(into ? `${m.label} for #${into.number}: reading the job…` : part ? `Reading the email for ${part.label}…` : "Reading the email…");
  let d = await read();
  let note = "";
  // sizes: the sheets' own total checked in code (the same check as the full Create order)
  if ((mode === "sizes" || mode === "mockup") && part?.pieces && pcsOf(d.groups) !== part.pieces) {
    const got = pcsOf(d.groups);
    step(`The lines add to ${got.toLocaleString("en-US")} pcs but the sheets say ${part.pieces.toLocaleString("en-US")}: reading the sheets again…`);
    d = await read(`COUNT CHECK: ${d.countNote ? d.countNote + " " : ""}the size sheets for this order total ${part.pieces} pieces (${(part.names || []).join(", ")}), but your garment lines added to ${got}. Read each size sheet again on its own, check each against its own total, then add them. Don't count any size twice.`);
    if (pcsOf(d.groups) !== part.pieces) note = `Check the quantities: the size sheets say ${part.pieces.toLocaleString("en-US")} pcs, the order has ${pcsOf(d.groups).toLocaleString("en-US")}.${d.countNote ? ` ${d.countNote}` : ""}`;
  }
  if (mode === "sizes") d = { ...d, groups: d.groups.map((g) => ({ ...g, imprints: [] })), art: {} };
  if (mode === "art") d = { ...d, groups: d.groups.map((g) => ({ ...g, lines: [] })) };
  if (mode === "empty") d = { ...d, groups: d.groups.slice(0, 1).map((g) => ({ ...g, lines: [], imprints: [], name: "" })), art: {}, mockups: {}, questions: [], check: [] };
  d = { ...d, check: [], notes: [d.notes, ctx.note ? `Staff: ${ctx.note}` : ""].filter(Boolean).join("\n").slice(0, 2000) };
  step(mode === "sizes" ? `Found ${pcsOf(d.groups).toLocaleString("en-US")} pcs on ${d.groups.reduce((n, g) => n + g.lines.length, 0)} garment lines` : mode === "empty" ? "Setting up the blank order…" : `Found ${d.groups.reduce((n, g) => n + g.imprints.length, 0)} print${d.groups.reduce((n, g) => n + g.imprints.length, 0) === 1 ? "" : "s"}`);
  step(into ? `Adding it to #${into.number}…` : "Creating the order…");
  const r = await fetch("/api/inbox/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, draft: d, status: "quote", ...(into ? { addTo: into.id } : {}) }) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
  if (!r?.ok || !j.id) throw new Error(j.error || (into ? `Couldn't add it to #${into.number}.` : "Couldn't create the order."));
  if (!into && ctx.orderType) await createClient().from("orders").update({ order_type: ctx.orderType }).eq("id", j.id).then(() => null, () => null);
  let url = `/shop/orders/${j.id}?email=${activityId}`;
  if (mode === "mockup") {
    const { data: o } = await createClient().from("orders").select("groups").eq("id", j.id).maybeSingle();
    const g = ((o?.groups || []) as Group[]).find((x) => x.imprints.some((im) => im.design_id));
    if (g) url = `/shop/artwork/mockup?order=${j.id}&group=${g.id}&auto=1&email=${activityId}`;
  }
  step(into ? (mode === "art" ? "Prints and art added" : "Garments and sizes added") : `#${j.number} made`);
  return { id: j.id as string, number: j.number as number, url, note, label: part?.label || d.nickname || m.label };
}

export default function PartialOrder({ activityId, start, onClose, onCreated }: { activityId: string; start: OrderStart & { partial: PartKind }; onClose: () => void; onCreated?: (id: string, number: number, label: string) => void }) {
  const [steps, setSteps] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const ran = useRef(false);
  const part = start.parts?.[0] || null, first = start.partial, m = PARTIAL[first];
  const step = (s: string) => setSteps((x) => [...x, s]);
  // the order made: the Order chat opens on the right and stays on every page (Oct 27, Nick: "you're supposed to stay
  // open, ask me what to do next, and then I can talk through the order with AI"); it offers the next step (bring in
  // the art / the sizes, make the mockup) and takes anything said. This page goes to the order.
  useEffect(() => {
    if (ran.current) return; ran.current = true;
    void (async () => {
      try {
        const ctx = ctxOf(activityId, start);
        const made = await partialStep(ctx, first, null, step);
        onCreated?.(made.id, made.number, made.label);
        openOrderCheck(made.id, [...stepsRef.current, ...(made.note ? [made.note] : [])], { activity: activityId }, { ctx, done: first === "mockup" ? ["sizes", "art"] : [first] });
        onClose();
        window.location.assign(made.url);
      } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const stepsRef = useRef<string[]>([]);
  stepsRef.current = steps;
  return (
    <div className="dla-bg dock" role="dialog" aria-label="Create order">
      <div className="dla osp">
        <h3>{m.label}</h3>
        <p className="dla-sub">{part ? `${part.label}. ` : ""}{m.sub}</p>
        <ul className="po-steps">{steps.map((s, i) => <li key={i} className={i === steps.length - 1 && !err ? "on" : "done"}>{s}</li>)}</ul>
        {err && <p className="err">{err}</p>}
        {!err && <p className="faint">When it&apos;s made, the order opens with the Order chat on the right for the next step.</p>}
        <div className="dla-acts"><span className="spacer" /><button type="button" className="btn ghost" onClick={onClose}>{err ? "Close" : "Cancel"}</button></div>
      </div>
    </div>
  );
}
