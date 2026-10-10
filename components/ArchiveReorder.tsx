"use client";
import { useState } from "react";
import { attachFilms, pullReorderArt } from "@/lib/reorderArt";
import type { EODraft } from "@/lib/emailOrderShared";
import ColorCheck, { applyColors, checkColors, type ColorRow } from "@/components/ColorCheck";

/**
 * Reorder on an archived Printavo job: the same garments, sizes and prints as a new 40,000-series order, with the art
 * pulled from the old mockup and sizes from the film in Dropbox; size / ink not known for sure stay "production
 * confirms". Then the Mockup Creator builds our mockup and opens the order.
 */
export default function ArchiveReorder({ archivedId, small }: { archivedId: string; small?: boolean }) {
  const [step, setStep] = useState(""), [err, setErr] = useState(""), [custId, setCustId] = useState("");
  const [ask, setAsk] = useState<{ rows: ColorRow[]; done: (r: ColorRow[] | null) => void } | null>(null);
  async function go() {
    setErr(""); setStep("Copying the job…");
    try {
      const r = await fetch("/api/archive/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: archivedId }) });
      const j = await r.json().catch(() => ({})) as { draft?: EODraft; customer?: { id: string; moved_at: string | null }; job?: { label: string; date: string }; error?: string };
      if (!r.ok || !j.draft || !j.customer) throw new Error(j.error || "Couldn't copy the job.");
      setCustId(j.customer.id);
      if (!j.customer.moved_at) throw new Error("move");
      // the old job's colors checked against the style's real colors before anything is made ("Forest Green" →
      // "Heather Forest Green", "Rust/Burnt Orange" → "Heather Redwood"); not exact = asked
      setStep("Checking the shirt colors…");
      let start = j.draft;
      const cc = await checkColors(start.groups).catch(() => ({ rows: [] as ColorRow[], ask: [] as ColorRow[] }));
      let rows = cc.rows;
      if (cc.ask.length) {
        const picked = await new Promise<ColorRow[] | null>((done) => setAsk({ rows: cc.rows, done }));
        setAsk(null);
        if (!picked) { setStep(""); return; }
        rows = picked;
      }
      if (rows.length) start = { ...start, groups: applyColors(start.groups, rows) };
      const { draft, films, notes } = await pullReorderArt(start, { customerId: j.customer.id, jobLabel: j.job?.label, jobDate: j.job?.date, onStep: setStep });
      setStep("Creating the order…");
      const c = await fetch("/api/archive/reorder", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: j.customer.id, draft, status: "quote" }) });
      const k = await c.json().catch(() => ({})) as { id?: string; error?: string };
      if (!c.ok || !k.id) throw new Error(k.error || "Couldn't create the order.");
      await attachFilms(k.id, films);
      const first = draft.groups.find((g) => g.imprints.some((x) => x.design_id));
      if (notes.length) { setStep(notes.join(" ")); await new Promise((res) => setTimeout(res, 2500)); }
      setStep("Opening it…");
      location.assign(first ? `/shop/artwork/mockup?order=${k.id}&group=${first.id}&auto=1` : `/shop/orders/${k.id}`);
    } catch (e) { setStep(""); setErr(e instanceof Error ? e.message : String(e)); }
  }
  return (
    <>
      <button type="button" className={"btn primary" + (small ? " sm" : "")} disabled={!!step} onClick={go} title="A new order with the same garments, sizes and prints; the art comes from the old mockup and the film">{step || "Reorder"}</button>
      {ask && <ColorCheck rows={ask.rows} onDone={(r) => ask.done(r)} onCancel={() => ask.done(null)} />}
      {err && <div className="err" style={{ flexBasis: "100%" }}>{err === "move" ? <>This customer isn&apos;t in the new system yet. <a href={`/shop/customers/${custId}`}>Move them first</a>, then Reorder.</> : err}</div>}
    </>
  );
}
