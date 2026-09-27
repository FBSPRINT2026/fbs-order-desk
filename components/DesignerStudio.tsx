"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { designLabel, type Customer, type Design } from "@/lib/pricing";
import { custLabel } from "@/lib/format";
import { previewUrls } from "@/lib/designs";
import { myLogos } from "@/app/portal/request-actions";
import { loadDesignerDoc, saveDesignerLogo } from "@/lib/designerSave";
import type { DesignDoc } from "@/lib/designerArt";
import ShirtDesigner from "@/components/ShirtDesigner";

/** The shirt designer as its own page: staff at /shop/artwork/designer, customers at /portal/designer. */
export default function DesignerStudio({ portal = false, backHref, mockupHref }: { portal?: boolean; backHref: string; mockupHref: string }) {
  const sb = useMemo(() => createClient(), []);
  const sp = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState(sp.get("customer") || "");
  const [designs, setDesigns] = useState<Design[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [start, setStart] = useState<{ doc?: DesignDoc | null; imageUrl?: string; name?: string } | null>(sp.get("design") ? null : {});
  const [saved, setSaved] = useState<Design | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (portal) {
      myLogos().then((r) => { if (r.ok) { setCustomerId(r.customerId); setDesigns(r.designs as Design[]); setUrls(r.urls); } });
      return;
    }
    sb.from("customers").select("*").then(({ data }) => setCustomers(((data || []) as Customer[]).sort((a, b) => custLabel(a).localeCompare(custLabel(b)))));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (portal) return;
    if (!customerId) { setDesigns([]); setUrls({}); return; }
    sb.from("designs").select("*").eq("customer_id", customerId).is("archived_at", null).order("number", { ascending: false }).then(async ({ data }) => {
      const list = (data || []) as Design[];
      setDesigns(list);
      setUrls(await previewUrls(sb, list));
    });
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // opening an existing logo: its layers if it was made here, else the picture
  useEffect(() => {
    const id = sp.get("design");
    if (!id || start) return;
    const d = designs.find((x) => x.id === id);
    if (!d) return;
    loadDesignerDoc(sb, d, portal).then((doc) => setStart(doc ? { doc, name: d.name } : { imageUrl: urls[d.id], name: d.name }));
  }, [designs, urls]); // eslint-disable-line react-hooks/exhaustive-deps

  const logos = designs.filter((d) => urls[d.id]).map((d) => ({ id: d.id, name: designLabel(d), url: urls[d.id] }));
  const mockLink = (d: Design) => `${mockupHref}${mockupHref.includes("?") ? "&" : "?"}design=${d.id}${portal ? "" : `&customer=${d.customer_id}`}`;

  return (
    <>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div>
          <Link className="faint" href={backHref} style={{ fontSize: 13, textDecoration: "none" }}>← Artwork</Link>
          <h1>Shirt designer</h1>
        </div>
        {!portal && (
          <div className="field" style={{ minWidth: 260 }}>
            <label htmlFor="sd-cust">Customer (the design is saved to their account)</label>
            <select id="sd-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Choose a customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{custLabel(c)}</option>)}
            </select>
          </div>
        )}
      </div>
      {saved && (
        <div className="confirm-bar" style={{ marginBottom: 12 }}>
          <span>Saved <b>{designLabel(saved)}</b> to {portal ? "your logos" : "the customer's logos"}.</span>
          <Link className="btn sm primary" href={mockLink(saved)}>Put it on a shirt</Link>
          <button type="button" className="btn sm" onClick={() => { setSaved(null); setStart({}); setRound((r) => r + 1); }}>Start a new design</button>
          <button type="button" className="btn sm ghost" onClick={() => setSaved(null)}>Keep editing</button>
        </div>
      )}
      {start ? (
        <ShirtDesigner key={round} start={start} logos={logos}
          onSave={async (out) => {
            try {
              const { data: u } = await sb.auth.getUser();
              const r = await saveDesignerLogo(sb, out, { portal, customerId, by: u.user?.email || "" });
              setDesigns((x) => [r.design, ...x]);
              if (r.url) setUrls((x) => ({ ...x, [r.design.id]: r.url }));
              setSaved(r.design);
              window.scrollTo({ top: 0, behavior: "smooth" });
            } catch (e) { return e instanceof Error ? e.message : "Couldn't save the design."; }
          }} />
      ) : <div className="empty">Opening the design…</div>}
    </>
  );
}
