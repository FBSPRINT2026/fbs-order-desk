"use client";
import { oneOfEach } from "@/lib/mockupList";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { designLabel, type Customer, type Design } from "@/lib/pricing";
import { custLabel } from "@/lib/format";
import { DESIGN_ACCEPT, PREVIEWABLE, previewUrls, uploadDesign } from "@/lib/designs";
import SearchInput from "@/components/SearchInput";
import CustomerPick from "@/components/CustomerPick";
import { LogoFace, LogoPic } from "@/components/LogoOnShirts";
import { listDrafts, setDraft } from "@/app/shop/draft-art-actions";
import { logoPrintFrom, logoShirtsFrom, logoShownFrom, type LogoPrint } from "@/lib/logoShirts";
import { guessHex } from "@/lib/mockup";
import { colorHex, deltaE } from "@/lib/inkColors";
import { useSticky } from "@/lib/useSticky";
import { laneState, type Brand } from "@/lib/brands";
import { allRows } from "@/lib/readAll";

type Mock = { id: string; number?: number | null; title: string; file_path: string; customer_id: string | null; order_id: string | null; created_at: string; starred?: boolean; design_ids?: string[]; group_id?: string | null; /** saved with its setup: can be edited again */ set?: string | null };
/** which clients: the top 10 by what they spent this year, every client, the newest first */
type Show = "top" | "all" | "recent";
/** what each client's row shows (Oct 31, Nick: "mockups or saved logos, and you'd select one of those two"): every
 *  mockup made for them, or only the logos saved to their file */
type Kind = "mockups" | "logos";
/** which of a client's logos its shelf shows (Oct 27, Nick: "toggle between active, favorites or most used") */
type LogoView = "active" | "favorites" | "used";
type Ord = { id: string; number: number; nickname: string | null; status: string; customer_id: string | null; total: number | null; created_at: string; discarded_at: string | null; draft: boolean | null; groups: { imprints?: { design_id?: string }[] }[] | null; lines?: unknown };
const ACTIVE = new Set(["request", "quote_sent", "approved", "art", "blanks", "production", "ready"]);
const SHELF = 12;

/** Artwork: every customer's logos and mockups in one place, searchable. Each logo upload gets its own number (D-10001). */
export default function ArtworkPage() {
  const sb = useMemo(() => createClient(), []);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [mockups, setMockups] = useState<Mock[]>([]);
  const [mUrls, setMUrls] = useState<Record<string, { full: string; thumb: string }>>({});
  const [orderNo, setOrderNo] = useState<Record<string, number>>({});
  const [customers, setCustomers] = useState<Customer[]>([]);
  const custOpts = useMemo(() => customers.map((c) => ({ id: c.id, label: custLabel(c), sub: c.company && c.name ? c.name : c.email || "" })), [customers]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [cust, setCust] = useState("");
  const [show0, setShow] = useSticky<Show | "logos" | "mockups">("artwork.shelves", "top");
  const show: Show = show0 === "logos" || show0 === "mockups" ? "top" : show0;
  const [kind, setKind] = useSticky<Kind>("artwork.kind", "mockups");
  const [view, setView] = useSticky<LogoView>("artwork.logoView", "used");
  const [brandPick, setBrandPick] = useSticky<Record<string, string>>("artwork.brandPick", {});
  const [brands, setBrands] = useState<Brand[]>([]);
  const [orders, setOrders] = useState<Ord[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openOrders, setOpenOrders] = useState<Set<string>>(new Set());
  /** the logos of the active order under the mouse, on its client's shelf only */
  const [hot, setHot] = useState<{ c: string; ids: Set<string> } | null>(null);
  const [nC, setNC] = useState(20);
  const [archived, setArchived] = useSticky("artwork.archived", false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ customer_id: string; name: string; colors: number; inks: string; notes: string; file: File | null; preview: File | null } | null>(null);

  // the shirt each logo was printed on, for its card (Oct 17, Nick: "MH Elem final should be on a blue background")
  const [logoShirts, setLogoShirts] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, { url: string; shirt: string }>>({});
  const [printed, setPrinted] = useState<Record<string, LogoPrint>>({});
  /** a logo being dragged onto one of its client's brands (Oct 28, Nick: "drag logos over into like MEI, ShipStation") */
  const [drag, setDrag] = useState<{ c: string; id: string } | null>(null);
  const [over, setOver] = useState("");
  useEffect(() => {
    allRows((r0, r1) => sb.from("orders").select("id, number, nickname, status, customer_id, total, created_at, discarded_at, draft, groups, lines").order("created_at", { ascending: false }).order("id").range(r0, r1), 3000)
      .then(async ({ data }) => {
        setLogoShirts(logoShirtsFrom((data || []) as never[])); setOrders(((data || []) as Ord[]).filter((o) => !o.discarded_at && !o.draft));
        setPrinted(logoPrintFrom((data || []) as never[], (c) => colorHex(c) || guessHex(c), deltaE));
        // how each logo last printed (the mockup's art), signed for the tiles
        const sh = logoShownFrom((data || []) as never[]), paths = [...new Set(Object.values(sh).map((x) => x.path))];
        if (!paths.length) return;
        const { data: sg } = await sb.storage.from("proofs").createSignedUrls(paths, 3600);
        const at = Object.fromEntries((sg || []).map((x, i) => [paths[i], x.signedUrl || ""]));
        setShown(Object.fromEntries(Object.entries(sh).filter(([, v]) => at[v.path]).map(([k, v]) => [k, { url: at[v.path], shirt: v.shirt }])));
      });
    sb.from("brands").select("*").is("archived_at", null).order("sort").then(({ data }) => setBrands((data || []) as Brand[]));
  }, [sb]);
  async function load() {
    const [d, c, m] = await Promise.all([
      sb.from("designs").select("*").eq("draft", false).order("number", { ascending: false }),
      sb.from("customers").select("*"),
      sb.from("mockups").select("id,number,title,file_path,customer_id,order_id,created_at,starred,design_ids,group_id,set:snapshot->>set").is("archived_at", null).eq("draft", false).order("created_at", { ascending: false }),
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
  useEffect(() => { setNC(20); }, [q, cust, show, archived, kind]);

  const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
  const t = q.trim().toLowerCase().replace(/^d-?(?=\d)/, "").replace(/^#/, "");
  const hit = (...xs: (string | number | null | undefined)[]) => !t || xs.some((x) => String(x ?? "").toLowerCase().includes(t));
  // only the logos saved to a customer's file (Oct 31): the rest live in the background with their mockups and orders
  const logos = designs.filter((d) => d.saved && !!d.archived_at === archived && (!cust || d.customer_id === cust) && hit(d.number, d.name, d.file_name, d.inks, d.notes, custLabel(byId[d.customer_id || ""])));
  const mocks = mockups.filter((m) => (!cust || m.customer_id === cust) && hit(m.title, custLabel(byId[m.customer_id || ""]), m.order_id ? orderNo[m.order_id] : "", ...(m.design_ids || []).map((id) => designs.find((d) => d.id === id)?.number)));
  const liveLogos = designs.filter((d) => d.saved && !d.archived_at).length;

  // ---- the shelves (Oct 27, Nick: a log of artwork, one row per client; not a task area) ----
  // how many orders each logo has been on, and the logos on each client's active orders
  const { used, activeOf, activeLogos, spend } = useMemo(() => {
    const used = new Map<string, number>(), activeOf = new Map<string, Ord[]>(), activeLogos = new Map<string, Set<string>>(), spend = new Map<string, number>();
    const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString();
    for (const o of orders) {
      const ids = new Set<string>((o.groups || []).flatMap((g) => (g.imprints || []).map((im) => im.design_id || "")).filter(Boolean));
      for (const id of ids) used.set(id, (used.get(id) || 0) + 1);
      if (o.customer_id && o.created_at >= yearAgo) spend.set(o.customer_id, (spend.get(o.customer_id) || 0) + (+(o.total || 0)));
      if (o.customer_id && ACTIVE.has(o.status)) {
        activeOf.set(o.customer_id, [...(activeOf.get(o.customer_id) || []), o]);
        for (const id of ids) activeLogos.set(id, new Set([...(activeLogos.get(id) || []), o.id]));
      }
    }
    return { used, activeOf, activeLogos, spend };
  }, [orders]);
  const brandsOf = useMemo(() => { const m = new Map<string, Brand[]>(); for (const b of brands) m.set(b.customer_id, [...(m.get(b.customer_id) || []), b]); return m; }, [brands]);
  const shelves = useMemo(() => {
    const byCust = new Map<string, Design[]>();
    for (const d of logos) if (d.customer_id) byCust.set(d.customer_id, [...(byCust.get(d.customer_id) || []), d]);
    // a client whose name matches the search shows all its logos
    if (t) for (const c of customers) if (!byCust.has(c.id) && custLabel(c).toLowerCase().includes(t)) { const all = designs.filter((d) => d.saved && d.customer_id === c.id && !!d.archived_at === archived); if (all.length) byCust.set(c.id, all); }
    const last = (ds: Design[]) => ds.reduce((m, d) => (d.created_at > m ? d.created_at : m), "");
    let rows = [...byCust.entries()].map(([id, ds]) => ({ c: byId[id], ds, last: last(ds) })).filter((r) => r.c);
    if (show === "recent") rows.sort((a, b) => b.last.localeCompare(a.last));
    else if (show === "top") rows.sort((a, b) => (spend.get(b.c.id) || 0) - (spend.get(a.c.id) || 0) || b.ds.length - a.ds.length);
    else rows.sort((a, b) => custLabel(a.c).localeCompare(custLabel(b.c)));
    if (show === "top" && !t && !cust) rows = rows.slice(0, 10);
    return rows;
  }, [logos, customers, designs, archived, t, show, spend, cust]); // eslint-disable-line react-hooks/exhaustive-deps
  /** the logos a shelf shows for the picked view (and brand) */
  function shelfLogos(cid: string, ds: Design[]): Design[] {
    const b = brandPick[cid];
    let xs = b ? ds.filter((d) => (b === "none" ? !(d as Design & { brand_id?: string | null }).brand_id : (d as Design & { brand_id?: string | null }).brand_id === b)) : ds;
    if (view === "active") xs = xs.filter((d) => activeLogos.has(d.id));
    if (view === "favorites") xs = xs.filter((d) => d.starred);
    return [...xs].sort((a, b2) => (used.get(b2.id) || 0) - (used.get(a.id) || 0) || b2.number - a.number);
  }
  const shortDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
  const LANE_TAGS = [["screen", "SP", "Screen print"], ["embroidery", "EMB", "Embroidery"], ["dtf", "HP", "Heat press"]] as const;
  // one card per mockup, its colors listed under it (Oct 22, Nick: "they should all be one mock-up with all the different
  // versions and colors underneath it"): the pictures of one save (same setup, or the same name saved in the same minute)
  const mockName = (m: Mock) => m.title.split(" — ")[0];
  const mockSets: Mock[][] = [];
  { const at = new Map<string, Mock[]>();
    for (const m of mocks) {
      const k = m.set ? `s:${m.set}` : m.order_id ? `o:${m.order_id}:${m.group_id || ""}:${m.created_at.slice(0, 16)}` : `n:${m.customer_id}:${mockName(m)}:${m.created_at.slice(0, 16)}`;
      const g = at.get(k); if (g) g.push(m); else { const n = [m]; at.set(k, n); mockSets.push(n); }
    }
    for (const g of mockSets) g.sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  // each client's mockups in one row, like the logos (Oct 31, Nick: "when you clicked on logotology, you would see all
  // the used mockups, whether that is a logo mockup or… a full mockup on the garment"), newest first
  const mockRows = (() => {
    const by = new Map<string, Mock[][]>();
    for (const g of mockSets) { const c = g[0].customer_id || ""; if (c && byId[c]) by.set(c, [...(by.get(c) || []), g]); }
    let rows = [...by.entries()].map(([id, sets]) => ({ c: byId[id], sets, last: sets.reduce((m, g) => (g[0].created_at > m ? g[0].created_at : m), "") }));
    if (show === "recent") rows.sort((a, b) => b.last.localeCompare(a.last));
    else if (show === "top") rows.sort((a, b) => (spend.get(b.c.id) || 0) - (spend.get(a.c.id) || 0) || b.sets.length - a.sets.length);
    else rows.sort((a, b) => custLabel(a.c).localeCompare(custLabel(b.c)));
    if (show === "top" && !t && !cust) rows = rows.slice(0, 10);
    return rows;
  })();
  const mockHref = (m: Mock) => (m.order_id ? `/shop/orders/${m.order_id}` : m.set ? `/shop/artwork/mockup?mockup=${m.id}` : mUrls[m.id]?.full || "");

  /** a logo filed under one of its client's brands (or none), from a drag onto the brand */
  async function fileUnder(id: string, brandId: string | null) {
    const was = designs.find((x) => x.id === id) as (Design & { brand_id?: string | null }) | undefined;
    if (!was || (was.brand_id || null) === brandId) return;
    setDesigns((ds) => ds.map((x) => (x.id === id ? ({ ...x, brand_id: brandId } as Design) : x)));
    const { error } = await sb.from("designs").update({ brand_id: brandId }).eq("id", id);
    const name = brandId ? brands.find((b) => b.id === brandId)?.name || "the brand" : "no brand";
    if (error) { setDesigns((ds) => ds.map((x) => (x.id === id ? ({ ...x, brand_id: was.brand_id ?? null } as Design) : x))); setMsg(`Couldn't file D-${was.number}: ${error.message}`); return; }
    setMsg(`D-${was.number} is under ${name} now.`);
  }

  async function save() {
    if (!form?.file) return setMsg("Choose a file to upload.");
    if (!form.customer_id) return setMsg("Pick the customer this logo belongs to.");
    setBusy(true);
    try {
      const { data: u } = await sb.auth.getUser();
      const d = await uploadDesign(sb, { ...form, file: form.file, by: u.user?.email || "", saved: true });
      setMsg(`Saved logo ${designLabel(d)}.`);
      setForm(null);
      load();
    } catch (e) { setMsg("Upload failed: " + (e instanceof Error ? e.message : String(e))); }
    setBusy(false);
  }

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">{liveLogos} saved logo{liveLogos === 1 ? "" : "s"} · {mockSets.length} mockup{mockSets.length === 1 ? "" : "s"}</div><h1>Artwork</h1></div>
        <div className="row">
          <Link className="btn" href="/shop/art-builder">Customer artwork builder</Link>
          <Link className="btn" href="/shop/artwork/mockup">Mockup Creator</Link>
          <Link className="btn" href="/shop/artwork/mockup?logo=1" title="Just the logo on its colors, no garment and no order">Logo mockup</Link>
          <button className="btn primary" type="button" onClick={() => setForm(form ? null : { customer_id: cust, name: "", colors: 1, inks: "", notes: "", file: null, preview: null })}>{form ? "Cancel" : "+ Upload logo"}</button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: -8, maxWidth: 760 }}>Every client&apos;s mockups, and the logos saved to their file with the files each department has for them. A logo is only saved when you choose to; the rest live inside their mockups and orders.</p>
      {msg && <div className="banner" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{msg}</div>}

      {form && (
        <section className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-h"><h2>Upload a logo</h2></div>
          <div className="panel-b grid g3">
            <div className="field"><label>Customer</label><CustomerPick field value={form.customer_id || null} options={custOpts} onPick={(v) => setForm({ ...form, customer_id: v || "" })} /></div>
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
        <label className="aa-search"><SearchInput placeholder="Logo, D-number or client" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <CustomerPick compact value={cust || null} options={custOpts} placeholder="All customers: type one" ariaLabel="Filter by customer" onPick={(v) => setCust(v || "")} />
        {/* one toolbar (Oct 31, Nick: "top 10, all clients, recently added on one side… all the way to the right should be
            mockups and saved logos"): which clients on the left, what their rows show on the right */}
        <div className="chips">
          {(["top", "all", "recent"] as Show[]).map((k) => <button key={k} type="button" className={"chip" + (show === k ? " on" : "")} onClick={() => setShow(k)}>{k === "top" ? "Top 10" : k === "all" ? "All clients" : "Recently added"}</button>)}
        </div>
        <span className="spacer" />
        {kind === "logos" && <label className="check" style={{ fontSize: 13 }}><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived</label>}
        <div className="chips" role="group" aria-label="Show">
          <button type="button" className={"chip" + (kind === "mockups" ? " on" : "")} onClick={() => setKind("mockups")}>Mockups <span className="chip-n">{mockSets.length}</span></button>
          <button type="button" className={"chip" + (kind === "logos" ? " on" : "")} onClick={() => setKind("logos")}>Saved logos <span className="chip-n">{liveLogos}</span></button>
        </div>
      </div>

      {kind === "mockups" && (
        <section className="art-sec as">
          <div className="as-head"><span className="faint">Client</span><span className="faint">Mockups</span></div>
          {mockRows.length ? mockRows.slice(0, nC).map(({ c, sets, last }) => {
            const act = (activeOf.get(c.id) || []).sort((a, b) => b.number - a.number);
            const xs = open.has(c.id) ? sets : sets.slice(0, SHELF);
            const ordersOpen = openOrders.has(c.id);
            return (
              <div key={c.id} className="as-row">
                <div className="as-who">
                  <div className="as-box">
                    <Link href={`/shop/customers/${c.id}`} className="as-name">{custLabel(c)}</Link>
                    <div className="as-mini"><span><b>{sets.length}</b> mockup{sets.length === 1 ? "" : "s"}</span>{last && <span><b>{shortDate(last)}</b> last made</span>}</div>
                  </div>
                  {act.length > 0 && <>
                    <div className="as-sec">Active orders</div>
                    {(ordersOpen ? act : act.slice(0, 3)).map((o) => <Link key={o.id} href={`/shop/orders/${o.id}`} className="as-ord"><span className="ordno">#{o.number}</span><span className="as-ord-n">{o.nickname || "Order"}</span></Link>)}
                    {act.length > 3 && <button type="button" className="linkbtn as-more" onClick={() => setOpenOrders((x) => { const n = new Set(x); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>{ordersOpen ? "Fewer" : `+${act.length - 3} more`}</button>}
                  </>}
                </div>
                <div className="as-logos">
                  {xs.map((g) => { const m = g[0], logo = / — Logo · /.test(m.title || ""), href = mockHref(m); return (
                    <a key={m.id} href={href || undefined} className="as-tile as-mk" title={`${m.number ? `M-${m.number} · ` : ""}${mockName(m)}${g.length > 1 ? ` · ${g.length} colors` : ""}`}>
                      <span className="as-pic">{mUrls[m.id]?.thumb ? <img src={mUrls[m.id].thumb} alt="" /> : <span className="as-ext">{logo ? "LOGO" : "MOCKUP"}</span>}{g.some((x) => x.starred) && <span className="as-star" title="Customer favorite">★</span>}{g.length > 1 && <span className="as-mk-n">{g.length}</span>}</span>
                      <span className="as-lab"><span>{m.number ? `M-${m.number}` : logo ? "Logo mockup" : "Mockup"}</span>{m.order_id && orderNo[m.order_id] ? <b>#{orderNo[m.order_id]}</b> : null}</span>
                      <span className="as-mk-t">{mockName(m)}</span>
                    </a>
                  ); })}
                  {sets.length > SHELF && <button type="button" className="as-tile as-mk as-plus" onClick={() => setOpen((x) => { const n = new Set(x); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>{open.has(c.id) ? "Fewer" : `+${sets.length - SHELF}`}</button>}
                </div>
              </div>
            );
          }) : <div className="aa-empty">{mockups.length ? "No mockups match." : "No mockups yet. Make one in the Mockup Creator."}</div>}
          {mockRows.length > nC && <button type="button" className="btn" style={{ alignSelf: "center" }} onClick={() => setNC(nC + 20)}>Show more clients ({mockRows.length - nC} more)</button>}
        </section>
      )}

      {kind === "logos" && (
        <section className="art-sec as">
          <div className="as-head"><span className="faint">Client</span>
            <span className="faint">{archived ? "Archived saved logos" : "Saved logos"}</span>
            <div className="chips" role="group" aria-label="Which logos">
              {(["active", "favorites", "used"] as LogoView[]).map((k) => <button key={k} type="button" className={"chip" + (view === k ? " on" : "")} onClick={() => setView(k)}>{k === "active" ? "Active" : k === "favorites" ? "Favorites" : "Most used"}</button>)}
            </div>
          </div>
          {shelves.length ? shelves.slice(0, nC).map(({ c, ds, last }) => {
            const bs = brandsOf.get(c.id) || [];
            const act = (activeOf.get(c.id) || []).sort((a, b) => b.number - a.number);
            const xs = shelfLogos(c.id, ds), more = open.has(c.id) ? xs : xs.slice(0, SHELF);
            const ordersOpen = openOrders.has(c.id);
            return (
              <div key={c.id} className="as-row">
                <div className="as-who">
                  <div className="as-box">
                    <Link href={`/shop/customers/${c.id}`} className="as-name">{custLabel(c)}</Link>
                    <div className="as-mini"><span><b>{ds.length}</b> logo{ds.length === 1 ? "" : "s"}</span>{last && <span><b>{shortDate(last)}</b> last added</span>}</div>
                  </div>
                  {bs.length > 0 && <>
                    {/* back to all of the client's logos after picking a brand (Oct 28, Nick) */}
                    <button type="button" className={"btn sm as-all" + (brandPick[c.id] ? "" : " on") + (over === "none" && drag?.c === c.id ? " over" : "")} aria-pressed={!brandPick[c.id]} title="All their logos (drop a logo here to take it off its brand)" onClick={() => setBrandPick({ ...brandPick, [c.id]: "" })}
                      onDragOver={(e) => { if (drag?.c !== c.id) return; e.preventDefault(); setOver("none"); }} onDragLeave={() => setOver((x) => (x === "none" ? "" : x))} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain") || drag?.id || ""; setDrag(null); setOver(""); if (id) void fileUnder(id, null); }}><svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="1.5" y="1.5" width="5" height="5" rx="1" /><rect x="9.5" y="1.5" width="5" height="5" rx="1" /><rect x="1.5" y="9.5" width="5" height="5" rx="1" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /></svg> All artwork</button>
                    <div className="as-sec">Brands</div>
                    {bs.map((b) => { const on = brandPick[c.id] === b.id; const dropHere = drag?.c === c.id; return (
                      <button key={b.id} type="button" className={"as-brand" + (on ? " on" : "") + (over === b.id && dropHere ? " over" : "")} aria-pressed={on} title={on ? "Show every logo" : `Show ${b.name}'s logos`} onClick={() => setBrandPick({ ...brandPick, [c.id]: on ? "" : b.id })}
                        onDragOver={(e) => { if (!dropHere) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(b.id); }} onDragLeave={() => setOver((x) => (x === b.id ? "" : x))} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain") || drag?.id || ""; setDrag(null); setOver(""); if (id) void fileUnder(id, b.id); }}>
                        <span>{b.name}</span>
                      </button>
                    ); })}
                  </>}
                  {act.length > 0 && <>
                    <div className="as-sec">Active orders</div>
                    {(ordersOpen ? act : act.slice(0, 3)).map((o) => { const ids = new Set<string>((o.groups || []).flatMap((g) => (g.imprints || []).map((im) => im.design_id || "")).filter(Boolean)); return (
                      <Link key={o.id} href={`/shop/orders/${o.id}`} className="as-ord" onMouseEnter={() => setHot({ c: c.id, ids })} onMouseLeave={() => setHot(null)} onFocus={() => setHot({ c: c.id, ids })} onBlur={() => setHot(null)}>
                        <span className="ordno">#{o.number}</span><span className="as-ord-n">{o.nickname || "Order"}</span>
                      </Link>
                    ); })}
                    {act.length > 3 && <button type="button" className="linkbtn as-more" onClick={() => setOpenOrders((x) => { const n = new Set(x); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>{ordersOpen ? "Fewer" : `+${act.length - 3} more`}</button>}
                  </>}
                </div>
                <div className="as-logos">
                  {more.map((d) => { const n = used.get(d.id) || 0; return (
                    <Link key={d.id} href={`/shop/artwork/${d.id}`} className={"as-tile" + (hot && hot.c === c.id ? (hot.ids.has(d.id) ? " hot" : " dim") : "") + (drag?.id === d.id ? " drag" : "")} title={`D-${d.number} ${d.name || ""}${bs.length ? " · drag onto a brand to file it there" : ""}`.trim()}
                      draggable={bs.length > 0} onDragStart={(e) => { if (!bs.length) return; e.dataTransfer.setData("text/plain", d.id); e.dataTransfer.effectAllowed = "move"; setDrag({ c: c.id, id: d.id }); }} onDragEnd={() => { setDrag(null); setOver(""); }}>
                      <span className="as-pic">{urls[d.id] || shown[d.id] ? <LogoFace d={d} urls={urls} shirt={logoShirts[d.id]} shown={shown[d.id] ? { ...shown[d.id], shirt: printed[d.id]?.shirt || shown[d.id].shirt } : null} printed={printed[d.id]} /> : <span className="as-ext">{(d.file_name.split(".").pop() || "file").toUpperCase()}</span>}{d.starred && <span className="as-star" title="Favorite">★</span>}</span>
                      <span className="as-lanes">{LANE_TAGS.map(([lane, short, label]) => { const st = laneState(d, lane); return <span key={lane} className={"as-ln" + (st.ready ? " has" : "")} title={`${label}: ${st.ready ? st.note : "no file yet"}`}>{short}</span>; })}</span>
                      <span className="as-lab"><span>D-{d.number}</span>{view === "used" && n > 0 && <b>{n}×</b>}</span>
                    </Link>
                  ); })}
                  {xs.length > SHELF && <button type="button" className="as-tile as-plus" onClick={() => setOpen((x) => { const n = new Set(x); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>{open.has(c.id) ? "Fewer" : `+${xs.length - SHELF}`}</button>}
                  {!xs.length && <span className="faint as-none">{brandPick[c.id] ? "No logos for this brand here." : view === "active" ? "No logos on open orders." : view === "favorites" ? "No favorites yet: star a logo on its page." : "No logos."}</span>}
                </div>
              </div>
            );
          }) : <div className="aa-empty">{designs.some((d) => d.saved) ? "No saved logos match." : "No saved logos yet. Upload a customer's logo, or save one from its page."}</div>}
          {shelves.length > nC && <button type="button" className="btn" style={{ alignSelf: "center" }} onClick={() => setNC(nC + 20)}>Show more clients ({shelves.length - nC} more)</button>}
          <p className="faint as-key">Under each logo, green means that department has its file: SP films / vector, EMB a sew file, HP a print file.</p>
        </section>
      )}

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
    </>
  );
}
