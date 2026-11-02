"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { draftArtCount, keepOrderArt } from "@/app/shop/draft-art-actions";

/**
 * The order's draft art, kept in the customer's library from the Art & production tab (Nov 1, Nick: the note on top of
 * every order "is annoying… move that to the art page… save to customer's files, and then would you like to assign it
 * to a sub account like MEI… or make new, like Sugar and Sage"): where it goes (the customer's own logos, one of their
 * brands, or a new brand), then Save. Until then it joins their library when the order is sent or approved.
 */
export default function DraftArtKeep({ orderId, customerId, customer, onKept }: { orderId: string; customerId?: string | null; customer: string; onKept?: (msg: string) => void }) {
  const sb = useState(() => createClient())[0];
  const [n, setN] = useState({ logos: 0, mockups: 0 });
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [to, setTo] = useState<string>(""); // "" = the customer's own, a brand id, or "new"
  const [nb, setNb] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { void draftArtCount(orderId).then((r) => setN({ logos: r.logos, mockups: r.mockups })); }, [orderId]);
  useEffect(() => {
    if (!customerId) return;
    void sb.from("brands").select("id, name").eq("customer_id", customerId).is("archived_at", null).order("sort").order("name").then(({ data }) => setBrands((data || []) as { id: string; name: string }[]));
  }, [sb, customerId]);
  if (!n.logos && !n.mockups) return null;
  const what = [n.logos ? `${n.logos} logo${n.logos === 1 ? "" : "s"}` : "", n.mockups ? `${n.mockups} mockup${n.mockups === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
  const save = async () => {
    if (to === "new" && !nb.trim()) return setErr("Type the new brand's name.");
    setBusy(true); setErr("");
    const r = await keepOrderArt(orderId, to === "new" ? { newBrand: nb.trim() } : to ? { brandId: to } : undefined);
    setBusy(false);
    if (!r.ok) return setErr(r.error || "Couldn't save it.");
    const where = to === "new" ? nb.trim() : brands.find((b) => b.id === to)?.name || customer;
    setN({ logos: 0, mockups: 0 });
    onKept?.(`Saved to ${where}'s library.`);
  };
  return (
    <section className="panel dak">
      <div className="panel-h"><h2>Draft art</h2><span className="faint">{what} made for this order, not in {customer}&apos;s library yet</span></div>
      <div className="panel-b">
        <p className="dak-say">It joins their library when the order is sent or approved, or save it now:</p>
        <div className="dak-k">Save to</div>
        <div className="chips dak-to" role="radiogroup" aria-label="Save to">
          <button type="button" role="radio" aria-checked={to === ""} className={"chip" + (to === "" ? " on" : "")} onClick={() => setTo("")}>{customer}</button>
          {brands.map((b) => <button key={b.id} type="button" role="radio" aria-checked={to === b.id} className={"chip" + (to === b.id ? " on" : "")} onClick={() => setTo(b.id)}>{b.name}</button>)}
          <button type="button" role="radio" aria-checked={to === "new"} className={"chip" + (to === "new" ? " on" : "")} onClick={() => setTo("new")}>+ New brand</button>
        </div>
        <div className="dak-row">
          {to === "new" && <input className="dak-in" autoFocus value={nb} onChange={(e) => setNb(e.target.value)} placeholder="Brand name, e.g. Sugar & Sage" aria-label="New brand name" onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />}
          <button type="button" className="btn primary sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save to their library"}</button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </section>
  );
}
