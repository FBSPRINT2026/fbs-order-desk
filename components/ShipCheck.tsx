"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { shipAll, shipCheck, shipPart } from "@/app/shop/parts-actions";

/**
 * Ship, for an order that isn't ready to ship yet (Nick, Nov 19 2026: "this order is not complete. It's missing its
 * embroidery… Do you want to ship it anyway?… are you shipping all of it or just partial of it?"). Ready to ship already:
 * it goes straight on. A part not printed: ship all of it (every part marked printed, the order to Shipping) or part of it
 * (it stays In Production, partly shipped). Everything printed but not Ready yet (Fulfillment): ship it now.
 * Opened from Outbound's Ship and the order's Production menu.
 */
export default function ShipCheck({ number, onClose, onReady }: { number: string; onClose: () => void; onReady: () => void }) {
  const [c, setC] = useState<Awaited<ReturnType<typeof shipCheck>> | null>(null);
  const [how, setHow] = useState<"all" | "part">("all"), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  useEffect(() => { void shipCheck(number).then((r) => { if (r.ok && r.ready) { onReady(); return; } setC(r); }); }, [number]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null;
  async function go() {
    if (!c || !c.ok) return;
    setBusy(true); setErr("");
    const r = how === "part" && c.left.length ? await shipPart(c.id) : await shipAll(c.id);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onReady();
  }
  const many = c.ok && c.words.length > 1;
  return createPortal(
    <div className="dla-bg" role="dialog" aria-modal="true" aria-labelledby="shc-t" onClick={onClose}>
      <div className="dla shc" onClick={(e) => e.stopPropagation()}>
        {!c.ok ? <><h3 id="shc-t">Can&apos;t ship it</h3><p className="dla-sub">{c.error}</p><div className="dla-acts"><button type="button" className="btn" onClick={onClose}>Close</button></div></> : <>
          <h3 id="shc-t">{c.left.length ? `#${c.number} isn't finished` : `Ship #${c.number} now?`}</h3>
          <p className="dla-sub">{c.left.length
            ? <>{c.words.join(" and ")} {many ? "aren't" : "isn't"} printed yet{c.job ? ` on ${c.job}` : ""}. Ship anyway?</>
            : <>Everything&apos;s printed, but it isn&apos;t marked ready to ship yet ({c.status === "fulfillment" ? "it's in Fulfillment" : "it's In Production"}). Shipping it moves it to Shipping.</>}</p>
          {c.left.length > 0 && <>
            <div className="shc-l">What are you shipping?</div>
            <div className="shc-opts" role="radiogroup">
              <button type="button" role="radio" aria-checked={how === "all"} className={"shc-opt" + (how === "all" ? " on" : "")} onClick={() => setHow("all")}><b>All of it</b><span>Marks the {c.words.join(" and ").toLowerCase()} printed too, takes {many ? "them" : "it"} off the schedule, and the order ships</span></button>
              <button type="button" role="radio" aria-checked={how === "part"} className={"shc-opt" + (how === "part" ? " on" : "")} onClick={() => setHow("part")}><b>Part of it</b><span>Ship what&apos;s done; the rest stays In Production as Partly shipped and ships when it&apos;s printed</span></button>
            </div>
          </>}
          {err && <div className="pv-err">{err}</div>}
          <div className="dla-acts"><button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void go()}>{busy ? "One moment…" : !c.left.length ? "Ship it" : how === "all" ? "Mark all printed and ship" : "Ship part of it"}</button></div>
        </>}
      </div>
    </div>, document.body);
}
