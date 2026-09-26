"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { designLabel, type Customer, type Design } from "@/lib/pricing";
import { custLabel } from "@/lib/format";
import { DESIGN_ACCEPT, PREVIEWABLE, previewUrls, uploadDesign } from "@/lib/designs";

/** Artwork: every customer design (logo) in one place. Each upload gets its own design number. */
export default function ArtworkPage() {
  const sb = useMemo(() => createClient(), []);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [cust, setCust] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ customer_id: string; name: string; colors: number; inks: string; notes: string; file: File | null; preview: File | null } | null>(null);

  async function load() {
    const [d, c] = await Promise.all([
      sb.from("designs").select("*").order("number", { ascending: false }),
      sb.from("customers").select("*"),
    ]);
    const list = (d.data || []) as Design[];
    setDesigns(list);
    setCustomers(((c.data || []) as Customer[]).sort((a, b) => custLabel(a).localeCompare(custLabel(b))));
    setUrls(await previewUrls(sb, list));
  }
  useEffect(() => { load(); }, []);

  const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
  const shown = designs.filter((d) => (!cust || d.customer_id === cust) && (!q.trim() || [designLabel(d), d.inks, d.notes, custLabel(byId[d.customer_id || ""])].join(" ").toLowerCase().includes(q.trim().toLowerCase())));

  async function save() {
    if (!form?.file) return setMsg("Choose a file to upload.");
    if (!form.customer_id) return setMsg("Pick the customer this design belongs to.");
    setBusy(true);
    try {
      const { data: u } = await sb.auth.getUser();
      const d = await uploadDesign(sb, { ...form, file: form.file, by: u.user?.email || "" });
      setMsg(`Saved ${designLabel(d)}.`);
      setForm(null);
      load();
    } catch (e) { setMsg("Upload failed: " + (e instanceof Error ? e.message : String(e))); }
    setBusy(false);
  }

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">{designs.length} designs</div><h1>Artwork</h1></div>
        <div className="row">
          <button className="btn primary" type="button" onClick={() => setForm(form ? null : { customer_id: cust, name: "", colors: 1, inks: "", notes: "", file: null, preview: null })}>{form ? "Cancel" : "+ Upload design"}</button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: -8, maxWidth: 760 }}>Each logo or piece of art is its own design with a number (D-10001). It lives on the customer&apos;s account, so you can put it on any garment and location, on any order.</p>
      {msg && <div className="banner" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{msg}</div>}

      {form && (
        <section className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-h"><h2>Upload a design</h2></div>
          <div className="panel-b grid g3">
            <div className="field"><label htmlFor="dz-c">Customer</label><select id="dz-c" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}><option value="">Choose…</option>{customers.map((c) => <option key={c.id} value={c.id}>{custLabel(c)}</option>)}</select></div>
            <div className="field"><label htmlFor="dz-n">Design name</label><input id="dz-n" type="text" placeholder="Main logo, Back print 2026…" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="dz-k">Ink colors</label><input id="dz-k" type="number" min="1" max="15" value={form.colors} onChange={(e) => setForm({ ...form, colors: Math.max(1, +e.target.value || 1) })} /></div>
            <div className="field"><label htmlFor="dz-f">Art file (PNG, JPG, SVG, PDF, AI, EPS…)</label><input id="dz-f" type="file" accept={DESIGN_ACCEPT} onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} /></div>
            {form.file && !PREVIEWABLE.test(form.file.type) && <div className="field"><label htmlFor="dz-p">Preview image (PNG or JPG, used for mockups)</label><input id="dz-p" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => setForm({ ...form, preview: e.target.files?.[0] || null })} /></div>}
            <div className="field"><label htmlFor="dz-i">Inks / PMS</label><input id="dz-i" type="text" placeholder="White, Navy, PMS 186 C" value={form.inks} onChange={(e) => setForm({ ...form, inks: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="dz-no">Notes</label><input id="dz-no" type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <div className="panel-b" style={{ paddingTop: 0 }}><button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? "Uploading…" : "Save design"}</button></div>
        </section>
      )}

      <div className="toolbar">
        <input type="search" placeholder="Search designs, inks, customers…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter by customer" value={cust} onChange={(e) => setCust(e.target.value)} style={{ maxWidth: 260 }}><option value="">All customers</option>{customers.map((c) => <option key={c.id} value={c.id}>{custLabel(c)}</option>)}</select>
      </div>
      {shown.length ? (
        <div className="design-grid">
          {shown.map((d) => (
            <Link key={d.id} href={`/shop/artwork/${d.id}`} className="design-card">
              <div className="dc-img">{urls[d.id] ? <img src={urls[d.id]} alt={d.name} /> : <span>{(d.file_name.split(".").pop() || "file").toUpperCase()}</span>}</div>
              <div className="dc-b"><b>D-{d.number}</b><span>{d.name || "Untitled"}</span><span className="faint">{custLabel(byId[d.customer_id || ""]) || "No customer"} · {d.colors} color{d.colors > 1 ? "s" : ""}</span></div>
            </Link>
          ))}
        </div>
      ) : <div className="empty">{designs.length ? "No designs match." : "No designs yet. Upload a customer's logo to get started."}</div>}
    </>
  );
}
