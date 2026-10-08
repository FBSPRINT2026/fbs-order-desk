"use client";
import { useState } from "react";
import { attachFilms, pullReorderArt } from "@/lib/reorderArt";
import type { EODraft } from "@/lib/emailOrderShared";

/**
 * Reorder on an archived Printavo job: the same garments, sizes and prints as a new 40,000-series order, with the art
 * pulled from the old mockup and sizes from the film in Dropbox; size / ink not known for sure stay "production
 * confirms". Then the Mockup Creator builds our mockup and opens the order.
 */
export default function ArchiveReorder({ archivedId }: { archivedId: string }) {
  const [step, setStep] = useState(""), [err, setErr] = useState(""), [custId, setCustId] = useState("");
  async function go() {
    setErr(""); setStep("Copying the job…");
    try {
      const r = await fetch("/api/archive/reorder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: archivedId }) });
      const j = await r.json().catch(() => ({})) as { draft?: EODraft; customer?: { id: string; moved_at: string | null }; job?: { label: string; date: string }; error?: string };
      if (!r.ok || !j.draft || !j.customer) throw new Error(j.error || "Couldn't copy the job.");
      setCustId(j.customer.id);
      if (!j.customer.moved_at) throw new Error("move");
      const { draft, films } = await pullReorderArt(j.draft, { customerId: j.customer.id, jobLabel: j.job?.label, jobDate: j.job?.date, onStep: setStep });
      setStep("Creating the order…");
      const c = await fetch("/api/archive/reorder", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer: j.customer.id, draft, status: "quote" }) });
      const k = await c.json().catch(() => ({})) as { id?: string; error?: string };
      if (!c.ok || !k.id) throw new Error(k.error || "Couldn't create the order.");
      await attachFilms(k.id, films);
      const first = draft.groups.find((g) => g.imprints.some((x) => x.design_id));
      setStep("Opening it…");
      location.assign(first ? `/shop/artwork/mockup?order=${k.id}&group=${first.id}&auto=1` : `/shop/orders/${k.id}`);
    } catch (e) { setStep(""); setErr(e instanceof Error ? e.message : String(e)); }
  }
  return (
    <>
      <button type="button" className="btn primary" disabled={!!step} onClick={go} title="A new order with the same garments, sizes and prints; the art comes from the old mockup and the film">{step || "Reorder"}</button>
      {err && <div className="err" style={{ flexBasis: "100%" }}>{err === "move" ? <>This customer isn&apos;t in the new system yet. <a href={`/shop/customers/${custId}`}>Move them first</a>, then Reorder.</> : err}</div>}
    </>
  );
}
