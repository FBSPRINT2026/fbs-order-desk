"use client";
import { oneOfEach } from "@/lib/mockupList";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { designLabel, type Customer, type Design } from "@/lib/pricing";
import { custLabel, fmtDateLong } from "@/lib/format";
import { DESIGN_ACCEPT, PREVIEWABLE, previewUrls, uploadDesign } from "@/lib/designs";
import SearchInput from "@/components/SearchInput";
import { LogoPic, ShirtView, onShirtsOf } from "@/components/LogoOnShirts";
import { listDrafts, setDraft } from "@/app/shop/draft-art-actions";
import { logoShirtsFrom } from "@/lib/logoShirts";
import { useSticky } from "@/lib/useSticky";

type Mock = { id: string; title: string; file_path: string; customer_id: string | null; order_id: string | null; created_at: string; starred?: boolean; design_ids?: string[] };
type Show = "all" | "logos" | "mockups";
const STEP = 24;

/** Artwork: every customer's logos and mockups in one place, searchable. Each logo upload gets its own number (D-10001). */
export default function ArtworkPage() {
  const sb = useMemo(() => createClient(), []);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [mockups, setMockups] = useState<Mock[]>([]);
  const [mUrls, setMUrls] = useState<Record<string, { full: string; thumb: string }>>({});
  const [orderNo, setOrderNo] = useState<Record<string, number>>({});
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [cust, setCust] = useState("");
  const [show, setShow] = useSticky<Show>("artwork.show", "all");
  const [archived, setArchived] = useSticky("artwork.archived", false);
  const [nL, setNL] = useState(STEP);
  const [nM, setNM] = useState(STEP);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ customer_id: string; name: string; colors: number; inks: string; notes: string; file: File | null; preview: File | null } | null>(null);

  // the shirt each logo was printed on, for its card (Oct 17, Nick: "MH Elem final should be on a blue background")
  const [logoShirts, setLogoShirts] = useState<Record<string, string>>({});
  useEffect(() => {
    sb.from("orders").select("groups, lines, created_at").order("created_at", { ascending: false }).limit(3000)
      .then(({ data }) => setLogoShirts(logoShirtsFrom((data || []) as never[])));
  }, [sb]);
  async function load() {
    const [d, c, m] = await Promise.all([
      sb.from("designs").select("*").eq("draft", false).order("number", { ascending: false }),
      sb.from("customers").select("*"),
      sb.from("mockups").select("id,title,file_path,customer_id,order_id,created_at,starred,design_ids").is("archived_at", null).eq("draft", false).order("created_at", { ascending: false }),
    ]);
    const list = (d.data || []) as Design[];
    const ml = oneOfEach((m.data || []) as Mock[]);
    setDesigns(list);
    setMockups(ml);
    setCustomers(((c.data || []) as Customer[]).sort((a, b) => custLabel(a).localeCompare(custLabel(b))));
    setUrls(await previewUrls(sb, list));
    const oids = [...new Set(ml.map((x) => x.order_id).filter(Boolean))] as string[];
    if (oids.length) {
      const { data: os } = await sb.from("orders").select("id,number").in("id", oids);
      setOrderNo(Object.fromEntries(((os || []) as { id: string; number: number }[]).map((o) => [o.id, o.number])));
    }
    if (ml.length) {
      const paths = ml.flatMap((x) => [x.file_path, x.file_path.replace(/\.png$/, "-thumb.png")]);
      const { data: sg } = await sb.storage.from("proofs").createSignedUrls(paths, 3600);
      const out: Record<string, { full: string; thumb: string }> = {};
      ml.forEach((x, i) => { const full = sg?.[i * 2]?.signedUrl || ""; out[x.id] = { full, thumb: sg?.[i * 2 + 1]?.signedUrl || full }; });
      setMUrls(out);
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Drafts (Oct 17, Nick): art the portal made for quotes that haven't gone out. Keep one into the library or take it off;
  // ones no one uses for 60 days are archived by themselves (archive_stale_drafts, daily)
  type Draft = Awaited<ReturnType<typeof listDrafts>>["items"][number];
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsOpen, setDraftsOpen] = useSticky("artwork.draftsOpen", true);
  useEffect(() => { listDrafts().then((r) => setDrafts(r.items || [])); }, []);
  async function decideDraft(d: Draft, keep: boolean) {
    setDrafts((x) => x.filter((y) => y.id !== d.id));
    const r = await setDraft(d.kind, d.id, keep);
    if (!r.ok) { setMsg(r.error || "Couldn't do that."); setDrafts((x) => [d, ...x]); return; }
    if (keep) load();
  }
  useEffect(() => { setNL(STEP); setNM(STEP); }, [q, cust, show, archived]);

  const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
  const t = q.trim().toLowerCase().replace(/^d-?(?=\d)/, "").replace(/^#/, "");
  const hit = (...xs: (string | number | null | undefined)[]) => !t || xs.some((x) => String(x ?? "").toLowerCase().includes(t));
  const logos = designs.filter((d) => !!d.archived_at === archived && (!cust || d.customer_id === cust) && hit(d.number, d.name, d.file_name, d.inks, d.notes, custLabel(byId[d.customer_id || ""])));
  const mocks = mockups.filter((m) => (!cust || m.customer_id === cust) && hit(m.title, custLabel(byId[m.customer_id || ""]), m.order_id ? orderNo[m.order_id] : "", ...(m.design_ids || []).map((id) => designs.find((d) => d.id === id)?.number)));
  const liveLogos = designs.filter((d) => !d.archived_at).length;

  async function save() {
    if (!form?.file) return setMsg("Choose a file to upload.");
    if (!form.customer_id) return setMsg("Pick the customer this logo belongs to.");
    setBusy(true);
    try {
      const { data: u } = await sb.auth.getUser();
      const d = await uploadDesign(sb, { ...form, file: form.file, by: u.user?.email || "" });
      setMsg(`Saved logo ${designLabel(d)}.`);
      setForm(null);
      load();
    } catch (e) { setMsg("Upload failed: " + (e instanceof Error ? e.message : String(e))); }
    setBusy(false);
  }

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">{liveLogos} logo{liveLogos === 1 ? "" : "s"} · {mockups.length} mockup{mockups.length === 1 ? "" : "s"}</div><h1>Artwork</h1></div>
        <div className="row">
          <Link className="btn" href="/shop/artwork/mockup">Mockup Creator</Link>
          <button className="btn primary" type="button" onClick={() => setForm(form ? null : { customer_id: cust, name: "", colors: 1, inks: "", notes: "", file: null, preview: null })}>{form ? "Cancel" : "+ Upload logo"}</button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: -8, maxWidth: 760 }}>Every customer&apos;s logos and mockups. Each logo has a number (D-10001) and lives on the customer&apos;s account, so it can go on any garment, location or order.</p>
      {msg && <div className="banner" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{msg}</div>}

      {form && (
        <section className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-h"><h2>Upload a logo</h2></div>
          <div className="panel-b grid g3">
            <div className="field"><label htmlFor="dz-c">Customer</label><select id="dz-c" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}><option value="">Choose…</option>{customers.map((c) => <option key={c.id} value={c.id}>{custLabel(c)}</option>)}</select></div>
            <div className="field"><label htmlFor="dz-n">Logo name</label><input id="dz-n" type="text" placeholder="Main logo, Back print 2026…" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="dz-k">Ink colors</label><input id="dz-k" type="number" min="1" max="15" value={form.colors} onChange={(e) => setForm({ ...form, colors: Math.max(1, +e.target.value || 1) })} /></div>
            <div className="field"><label htmlFor="dz-f">Art file (PNG, JPG, SVG, PDF, AI, EPS…)</label><input id="dz-f" type="file" accept={DESIGN_ACCEPT} onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })} /></div>
            {form.file && !PREVIEWABLE.test(form.file.type) && <div className="field"><label htmlFor="dz-p">Preview image (PNG or JPG, used for mockups)</label><input id="dz-p" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => setForm({ ...form, preview: e.target.files?.[0] || null })} /></div>}
            <div className="field"><label htmlFor="dz-i">Inks / PMS</label><input id="dz-i" type="text" placeholder="White, Navy, PMS 186 C" value={form.inks} onChange={(e) => setForm({ ...form, inks: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="dz-no">Notes</label><input id="dz-no" type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <div className="panel-b" style={{ paddingTop: 0 }}><button className="btn primary" type="button" disabled={busy} onClick={save}>{busy ? "Uploading…" : "Save logo"}</button></div>
        </section>
      )}

      <div className="toolbar art-tools">
        <label className="aa-search"><SearchInput placeholder="Search logos and mockups" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <select aria-label="Filter by customer" value={cust} onChange={(e) => setCust(e.target.value)} style={{ maxWidth: 240 }}><option value="">All customers</option>{customers.map((c) => <option key={c.id} value={c.id}>{custLabel(c)}</option>)}</select>
        <div className="chips">
          {(["all", "logos", "mockups"] as Show[]).map((k) => <button key={k} type="button" className={"chip" + (show === k ? " on" : "")} onClick={() => setShow(k)}>{k === "all" ? "All" : k === "logos" ? `Logos (${logos.length})` : `Mockups (${mocks.length})`}</button>)}
        </div>
        {show !== "mockups" && <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived logos</label>}
      </div>

      {drafts.filter((d) => !cust || d.customer_id === cust).length > 0 && (
        <section className="art-sec art-drafts">
          <div className="aa-sec-h"><button type="button" className="linkbtn" onClick={() => setDraftsOpen((x) => !x)} aria-expanded={draftsOpen}><h3>{draftsOpen ? "▾" : "▸"} Drafts</h3></button><span className="faint">{drafts.filter((d) => !cust || d.customer_id === cust).length} · made for quotes that haven&apos;t gone out. They join the library when the order is sent; unused for 60 days, they&apos;re archived.</span></div>
          {draftsOpen && (
            <div className="design-grid">
              {drafts.filter((d) => !cust || d.customer_id === cust).map((d) => {
                const gone = new Date(new Date(d.order?.updated_at && d.order.updated_at > d.created_at ? d.order.updated_at : d.created_at).getTime() + 60 * 864e5);
                return (
                  <div key={d.kind + d.id} className="design-card draft">
                    <div className={"dc-img" + (d.kind === "mockup" ? " mock" : "")}>{d.url ? (d.kind === "logo" ? <LogoPic url={d.url} alt={d.label} /> : <img src={d.url} alt={d.label} />) : <span>{d.kind === "logo" ? "LOGO" : "MOCKUP"}</span>}<span className="dc-draft">Draft</span></div>
                    <div className="dc-b">
                      <b>{d.label}</b>
                      <span className="faint">{custLabel(byId[d.customer_id || ""]) || "No customer"}{d.order ? <> · <Link href={`/shop/orders/${d.order.id}`}>#{d.order.number}</Link></> : " · no open order"}</span>
                      <span className="faint">Archived {gone.toLocaleDateString(undefined, { month: "short", day: "numeric" })} if unused</span>
                      <span className="dc-acts"><button type="button" className="btn sm" onClick={() => decideDraft(d, true)}>Keep</button><button type="button" className="btn sm ghost" onClick={() => decideDraft(d, false)}>Take off</button></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
      {show !== "mockups" && (
        <section className="art-sec">
          <div className="aa-sec-h"><h3>{archived ? "Archived logos" : "Logos"}</h3><span className="faint">{logos.length} {q || cust ? "match" + (logos.length === 1 ? "" : "es") : "total"}</span></div>
          {logos.length ? (
            <div className="design-grid">
              {logos.slice(0, nL).map((d) => (
                <Link key={d.id} href={`/shop/artwork/${d.id}`} className={"design-card" + (d.starred ? " starred" : "")}>
                  <div className="dc-img">{urls[d.id] ? <LogoPic url={urls[d.id]} alt={d.name} shirt={logoShirts[d.id]} /> : <span>{(d.file_name.split(".").pop() || "file").toUpperCase()}</span>}
                    {/* on its first background, like the customer page (Oct 17, Nick: "looks great in the customer page but crappy on the artwork page") */}
                    {(() => { const v = onShirtsOf(d)[0]; return v && urls[d.id] ? <ShirtView className="main" url={urls[d.id]} shirt={v.shirt} ink={v.ink} /> : null; })()}
                    {d.starred && <span className="dc-fav" title="Customer favorite">★</span>}</div>
                  <div className="dc-b"><b>D-{d.number}</b><span>{d.name || "Untitled"}</span><span className="faint">{custLabel(byId[d.customer_id || ""]) || "No customer"} · {d.colors} color{d.colors > 1 ? "s" : ""}</span></div>
                </Link>
              ))}
            </div>
          ) : <div className="aa-empty">{designs.length ? "No logos match." : "No logos yet. Upload a customer's logo to get started."}</div>}
          {logos.length > nL && <button type="button" className="btn" style={{ alignSelf: "center" }} onClick={() => setNL(nL + STEP)}>Show more logos ({logos.length - nL} more)</button>}
        </section>
      )}

      {show !== "logos" && (
        <section className="art-sec">
          <div className="aa-sec-h"><h3>Mockups</h3><span className="faint">{mocks.length} {q || cust ? "match" + (mocks.length === 1 ? "" : "es") : "total"}</span></div>
          {mocks.length ? (
            <div className="design-grid">
              {mocks.slice(0, nM).map((m) => (
                <a key={m.id} href={mUrls[m.id]?.full} target="_blank" rel="noreferrer" className={"design-card" + (m.starred ? " starred" : "")}>
                  <div className="dc-img mock">{mUrls[m.id]?.thumb ? <img src={mUrls[m.id].thumb} alt={m.title} /> : <span>MOCKUP</span>}{m.starred && <span className="dc-fav" title="Customer favorite">★</span>}</div>
                  <div className="dc-b"><b>{m.title}</b><span className="faint">{custLabel(byId[m.customer_id || ""]) || "No customer"}{m.order_id && orderNo[m.order_id] ? ` · Order #${orderNo[m.order_id]}` : ""}</span><span className="faint">{fmtDateLong(m.created_at.slice(0, 10))}</span></div>
                </a>
              ))}
            </div>
          ) : <div className="aa-empty">{mockups.length ? "No mockups match." : "No mockups yet. Make one in the Mockup Creator."}</div>}
          {mocks.length > nM && <button type="button" className="btn" style={{ alignSelf: "center" }} onClick={() => setNM(nM + STEP)}>Show more mockups ({mocks.length - nM} more)</button>}
        </section>
      )}
    </>
  );
}
