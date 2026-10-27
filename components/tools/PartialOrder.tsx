"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { OrderStart } from "@/components/OrderStartPick";
import type { EODraft } from "@/lib/emailOrderShared";
import type { Group } from "@/lib/pricing";

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

export default function PartialOrder({ activityId, start, onClose, onCreated }: { activityId: string; start: OrderStart & { partial: PartKind }; onClose: () => void; onCreated?: (id: string, number: number, label: string) => void }) {
  const [steps, setSteps] = useState<string[]>([]);
  const [made, setMade] = useState<{ id: string; number: number; url: string; note: string } | null>(null);
  const [err, setErr] = useState("");
  // the steps done on this order so far, and the one running (Oct 27, Nick: "make that be the first step. Then I can go
  // and say, okay, now bring in the art"): the panel stays open after each one and offers the next
  const [did, setDid] = useState<PartKind[]>([]);
  const [running, setRunning] = useState(true);
  const ran = useRef(false);
  const part = start.parts?.[0] || null, first = start.partial;
  const step = (s: string) => setSteps((x) => [...x, s]);
  const run = async (mode: PartKind, into?: { id: string; number: number }) => {
    const m = PARTIAL[mode];
    setRunning(true); setErr("");
    void (async () => {
      try {
        const read = async (fix = "") => {
          const told = [part ? part.told || "" : start.told || "", m.told, start.note || "", fix].filter(Boolean).join("\n");
          const r = await fetch("/api/inbox/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, told, job: part ? (part.job ?? null) : start.job || null, jobs: part ? [] : start.jobs || [], reorderOk: !!(part ? part.job : start.job), ...(part ? { part: part.key } : {}), include: start.include || [], exclude: start.exclude || [] }) }).catch(() => null);
          const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
          if (!r?.ok || !j.draft) throw new Error(j.error || "The AI couldn't read this email.");
          return j.draft as EODraft;
        };
        step(into ? `${m.label} for #${into.number}: reading the email…` : part ? `Reading the email for ${part.label}…` : "Reading the email…");
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
        d = { ...d, check: [], notes: [d.notes, start.note ? `Staff: ${start.note}` : ""].filter(Boolean).join("\n").slice(0, 2000) };
        step(mode === "sizes" ? `Found ${pcsOf(d.groups).toLocaleString("en-US")} pcs on ${d.groups.reduce((n, g) => n + g.lines.length, 0)} garment lines` : mode === "empty" ? "Setting up the blank order…" : `Found ${d.groups.reduce((n, g) => n + g.imprints.length, 0)} print${d.groups.reduce((n, g) => n + g.imprints.length, 0) === 1 ? "" : "s"}`);
        step(into ? `Adding it to #${into.number}…` : "Creating the order…");
        const r = await fetch("/api/inbox/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity: activityId, draft: d, status: "quote", ...(into ? { addTo: into.id } : {}) }) }).catch(() => null);
        const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
        if (!r?.ok || !j.id) throw new Error(j.error || (into ? `Couldn't add it to #${into.number}.` : "Couldn't create the order."));
        if (!into) {
          const ot = part?.orderType || start.orderType;
          if (ot) await createClient().from("orders").update({ order_type: ot }).eq("id", j.id).then(() => null, () => null);
        }
        let url = `/shop/orders/${j.id}?email=${activityId}`;
        if (mode === "mockup") {
          const { data: o } = await createClient().from("orders").select("groups").eq("id", j.id).maybeSingle();
          const g = ((o?.groups || []) as Group[]).find((x) => x.imprints.some((im) => im.design_id));
          if (g) url = `/shop/artwork/mockup?order=${j.id}&group=${g.id}&auto=1&email=${activityId}`;
        }
        if (into) step(mode === "art" ? "Prints and art added" : "Garments and sizes added");
        else onCreated?.(j.id, j.number, part?.label || d.nickname || m.label);
        setMade((x) => ({ id: j.id, number: j.number, url, note: [x?.note, note].filter(Boolean).join(" ") }));
        setDid((x) => [...x, mode]);
      } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
      finally { setRunning(false); }
    })();
  };
  useEffect(() => {
    if (ran.current) return; ran.current = true;
    void run(first);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const m = PARTIAL[first];
  // what's left to bring in, and the mockup once there's art and garments
  const has = (k: PartKind) => did.includes(k) || (k === "sizes" && did.includes("mockup")) || (k === "art" && did.includes("mockup"));
  const next: PartKind[] = made && !running ? (["sizes", "art"] as PartKind[]).filter((k) => !has(k)) : [];
  const mockupHref = async () => {
    if (!made) return;
    const { data: o } = await createClient().from("orders").select("groups").eq("id", made.id).maybeSingle();
    const g = ((o?.groups || []) as Group[]).find((x) => x.imprints.some((im) => im.design_id));
    window.location.assign(g ? `/shop/artwork/mockup?order=${made.id}&group=${g.id}&auto=1&email=${activityId}` : made.url);
  };
  return (
    <div className="dla-bg dock" role="dialog" aria-label="Create order">
      <div className="dla osp">
        <h3>{m.label}</h3>
        <p className="dla-sub">{part ? `${part.label}. ` : ""}{m.sub}</p>
        <ul className="po-steps">{steps.map((s, i) => <li key={i} className={i === steps.length - 1 && running && !err ? "on" : "done"}>{s}</li>)}</ul>
        {err && <p className="err">{err}</p>}
        {made && <div className="po-made">
          <b>Order #{made.number} {did.length > 1 ? "has " + did.map((k) => (k === "sizes" ? "its garments" : k === "art" ? "its prints and art" : PARTIAL[k].label.toLowerCase())).join(" and ") : "made"}.</b>
          {made.note && <span className="po-warn">{made.note}</span>}
          {/* the next step, right here (Oct 27, Nick) */}
          {next.length > 0 && <div className="po-next">
            <span className="faint">Next</span>
            {next.map((k) => <button key={k} type="button" className="btn" onClick={() => void run(k, { id: made.id, number: made.number })}>{k === "art" ? "Bring in the art" : "Bring in the sizes"}</button>)}
          </div>}
          <div className="po-next">
            {first === "mockup" && made.url.includes("/mockup")
              ? <a className="btn primary" href={made.url}>Open the Mockup Creator</a>
              : <>{has("art") && has("sizes") && <button type="button" className="btn primary" disabled={running} onClick={() => void mockupHref()}>Make the mockup</button>}
                <a className={"btn" + (has("art") && has("sizes") ? "" : " primary")} href={made.url}>Open #{made.number}</a></>}
          </div>
        </div>}
        <div className="dla-acts"><span className="spacer" /><button type="button" className="btn ghost" onClick={onClose}>{made || err ? "Close" : "Cancel"}</button></div>
      </div>
    </div>
  );
}
