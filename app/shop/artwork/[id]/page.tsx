"use client";
import Link from "next/link";
import BackLink from "@/components/BackLink";
import CustomerPick from "@/components/CustomerPick";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { designLabel, orderGroups, type Customer, type Design, type Order } from "@/lib/pricing";
import { custLabel, fmtDate } from "@/lib/format";
import { setDesignPreview } from "@/lib/designs";
import LogoEditor from "@/components/LogoEditor";
import { colorwaysOf, nextSewCode, SEW_KINDS, sewFilesOf, tajimaName, type Brand, type SewFile } from "@/lib/brands";
import { tajimaFile } from "@/components/CustomerBrands";
import { useSticky } from "@/lib/useSticky";
import LogoResearch, { type LogoHistory, type Sew } from "@/components/LogoResearch";

/**
 * One logo, everything about it by department (Oct 28, Nick: "a layout that'll have… the separations for that logo… film
 * for that logo… DSTs"): the art on its backgrounds with its print size, colorways, where it came from and its brand on
 * the left; Embroidery (each sew file by size), Screen print (separations, films), Heat press (gang sheets) and History
 * on the right. "Find it everywhere" looks through the client's jobs for where it ran (components/LogoResearch.tsx).
 */
type D = Design & { brand_id?: string | null };
type Tab = "emb" | "sp" | "hp" | "hist";
type Sep = { id: string; number: number | null; location: string | null; garment_color: string | null; status: string | null; method: string | null; created_at: string };
type Gang = { id: string; name: string | null; status: string | null; created_at: string; data: unknown };
type Film = { id: string; name: string; file_path: string; order_id: string; created_at: string };
const fileLink = (p: string, n?: string) => `/api/files/open?${new URLSearchParams({ p, ...(n ? { n } : {}) })}`;
const BGS: [string, string][] = [["White", "#ffffff"], ["Charcoal", "#2b3140"], ["Sand", "#d8cfbd"], ["Sage", "#8a9a7b"], ["Navy", "#1f2a44"]];
const TAB_ICONS: Record<Tab, React.ReactNode> = {
  emb: <path d="M4 20L20 4M14 4h6v6M6 14l4 4" />,
  sp: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M10 4v16" /></>,
  hp: <path d="M12 3c3 4 6 6 6 10a6 6 0 01-12 0c0-4 3-6 6-10z" />,
  hist: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
};

export default function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const sb = useMemo(() => createClient(), []);
  const [d, setD] = useState<D | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [seps, setSeps] = useState<Sep[]>([]);
  const [gangs, setGangs] = useState<Gang[]>([]);
  const [films, setFilms] = useState<Film[]>([]);
  const [sewouts, setSewouts] = useState(0);
  const [pv, setPv] = useState("");
  const [orig, setOrig] = useState("");
  const [msg, setMsg] = useState("");
  const [armed, setArmed] = useState(false);
  const [tab, setTab] = useSticky<Tab>("logo.tab", "emb");
  const [bg, setBg] = useSticky("logo.bg", "#ffffff");
  const [research, setResearch] = useState(false);
  // the logo editor (remove the white, change colors, crop): opened from here or a logo card's ✎ (?edit=1)
  const [editing, setEditing] = useState(false);
  const [sewBusy, setSewBusy] = useState(false);
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("edit") === "1") setEditing(true); }, []);

  async function load() {
    const { data } = await sb.from("designs").select("*").eq("id", id).maybeSingle();
    if (!data) return setMsg("Logo not found.");
    const des = data as D;
    setD(des);
    const paths = [des.preview_path, des.file_path].filter(Boolean);
    const { data: urls } = paths.length ? await sb.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
    setPv(des.preview_path ? urls?.[0]?.signedUrl || "" : "");
    setOrig(urls?.[des.preview_path ? 1 : 0]?.signedUrl || "");
    const [c, o, s, so, b, g] = await Promise.all([
      sb.from("customers").select("*"),
      des.customer_id ? sb.from("orders").select("*").eq("customer_id", des.customer_id).order("number", { ascending: false }) : Promise.resolve({ data: [] }),
      sb.from("separations").select("id, number, location, garment_color, status, method, created_at").eq("design_id", des.id).order("created_at", { ascending: false }),
      sb.from("sewouts").select("id", { count: "exact", head: true }).eq("design_id", des.id).is("archived_at", null),
      des.brand_id ? sb.from("brands").select("*").eq("id", des.brand_id).maybeSingle() : Promise.resolve({ data: null }),
      des.customer_id ? sb.from("gang_sheets").select("id, name, status, created_at, data").eq("customer_id", des.customer_id).is("archived_at", null).order("created_at", { ascending: false }).limit(60) : Promise.resolve({ data: [] }),
    ]);
    setCustomers(((c.data || []) as Customer[]).sort((a, b2) => custLabel(a).localeCompare(custLabel(b2))));
    const used = ((o.data || []) as Order[]).filter((x) => orderGroups(x).some((gr) => gr.imprints.some((im) => im.design_id === des.id)));
    setOrders(used);
    setSeps((s.data || []) as Sep[]);
    setSewouts(so.count || 0);
    setBrand((b.data as Brand | null) || null);
    setGangs(((g.data || []) as Gang[]).filter((x) => JSON.stringify(x.data || "").includes(des.id)));
    if (used.length) {
      const { data: af } = await sb.from("art_files").select("id, name, file_path, order_id, created_at").in("order_id", used.map((x) => x.id)).ilike("name", "Film:%");
      setFilms((af || []) as Film[]);
    } else setFilms([]);
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(p: Partial<D>) {
    if (!d) return;
    setD({ ...d, ...p });
    const { error } = await sb.from("designs").update(p).eq("id", d.id);
    setMsg(error ? "Couldn't save: " + error.message : "Saved");
  }
  async function del() {
    if (!d) return;
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3500); return; }
    await sb.storage.from("proofs").remove([d.file_path, d.preview_path].filter((x, i, a) => x && a.indexOf(x) === i));
    await sb.from("designs").delete().eq("id", d.id);
    router.push("/shop/artwork");
  }
  /** a sew file for this logo: the digitizer's DST with its EMB and sewing sheet, named D{number}E{n} for the Tajima */
  async function addSew(files: FileList | null) {
    if (!d || !files?.length) return;
    setSewBusy(true); setMsg("");
    try {
      const { expandFiles, takeDigitized } = await import("@/lib/digitizedFiles");
      const have = sewFilesOf(d), code = nextSewCode(have), name = tajimaName(d.number, Number(code.slice(1)));
      const named = await Promise.all((await expandFiles([...files])).map((f) => tajimaFile(f, name)));
      const { set } = await takeDigitized(sb, d.id, named);
      const { data } = await sb.from("designs").select("specs").eq("id", d.id).maybeSingle();
      const sp = (data?.specs || {}) as Record<string, unknown>, em = (sp.embroidery || {}) as { files?: SewFile[] };
      const specs = { ...sp, embroidery: { ...em, files: [...(em.files || []), { ...set, code, kind: "flat" }] } };
      const { error } = await sb.from("designs").update({ specs }).eq("id", d.id);
      if (error) throw new Error(error.message);
      setD({ ...d, specs: specs as Design["specs"] }); setMsg(`${name} added`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't add the sew file."); }
    setSewBusy(false);
  }
  async function setSew(i: number, p: Partial<Sew>) {
    if (!d) return;
    const fs = sewFilesOf(d).map((f, j) => (j === i ? { ...f, ...p } : f));
    await patch({ specs: { ...((d.specs || {}) as object), embroidery: { ...(((d.specs as { embroidery?: object } | null)?.embroidery) || {}), files: fs } } as Design["specs"] });
  }

  if (!d) return <div className="empty">{msg || "Loading…"}</div>;
  const ratio = d.width_px && d.height_px ? d.height_px / d.width_px : 0;
  const sp = (d.specs || {}) as { printSize?: { wIn?: number; hIn?: number; location?: string }; source?: { printavo?: string; dropbox?: string; where?: string }; history?: LogoHistory[] };
  const ps = sp.printSize, src = sp.source;
  const sews = sewFilesOf(d) as Sew[];
  const cws = colorwaysOf(d);
  const hist: { at: string; text: string; href?: string }[] = [
    ...orders.map((o) => ({ at: (o.created_at || "").slice(0, 10), text: `On #${o.number} ${o.nickname || ""} · ${orderGroups(o).flatMap((g) => g.imprints.filter((im) => im.design_id === d.id).map((im) => im.location)).join(", ")}`, href: `/shop/orders/${o.id}` })),
    ...(sp.history || []).map((h) => ({ at: h.date || "", text: `Ran on Printavo #${h.job}${h.name ? ` ${h.name}` : ""}${h.where ? ` · ${h.where}` : ""}${h.note ? ` · ${h.note}` : ""}` })),
    ...sews.map((f) => ({ at: (f.at || "").slice(0, 10), text: `${tajimaName(d.number, Number((f.code || "E1").slice(1)) || 1)} added (${f.wIn}" × ${f.hIn}")${f.lastUsed?.job ? ` from #${f.lastUsed.job}` : ""}` })),
    { at: (d.created_at || "").slice(0, 10), text: `Logo made${src?.printavo ? ` from Printavo #${src.printavo}` : src?.dropbox ? ` from Dropbox ${src.dropbox}` : ""}${d.created_by ? ` · ${d.created_by.split("@")[0]}` : ""}` },
  ].filter((h) => h.text).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  const counts: Record<Tab, number> = { emb: sews.length, sp: seps.length + films.length, hp: gangs.length, hist: hist.length };

  return (
    <>
      <BackLink href="/shop/artwork" label="Artwork" />
      {editing && <LogoEditor d={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setMsg("Logo saved"); load(); }} />}
      {research && <LogoResearch d={d} brand={brand} onClose={() => setResearch(false)} onDone={(m) => { setResearch(false); setMsg(m); load(); }} />}
      <div className="page-head">
        <div><h1>{designLabel(d)}</h1><div className="eyebrow">{custLabel(customers.find((c) => c.id === d.customer_id)) || "No customer"}{brand ? ` · ${brand.name}` : ""}</div></div>
        <div className="row"><span className="save-state">{msg}</span>
          <button type="button" className="btn primary" onClick={() => setResearch(true)} title="Look through this client's jobs for everywhere this logo ran">Find it everywhere</button>
          {d.customer_id && <Link className="btn" href={`/shop/art-builder?${new URLSearchParams({ customer: d.customer_id, into: d.id, q: (brand?.name || d.name).split(/\s*\/\s*/)[0], ...(d.brand_id ? { brand: d.brand_id } : {}) })}`} title="Pick this logo's art off a past job's file (the vector), or bring in another sew file">Pull its art from a job</Link>}
          <Link className="btn" href={`/shop/artwork/mockup?customer=${d.customer_id || ""}&design=${d.id}`}>Put on a shirt</Link>
          <button type="button" className="btn" onClick={() => setEditing(true)}>Edit logo</button>
          {orig && <a className="btn" href={orig} target="_blank" rel="noreferrer">Download</a>}
          <button className={"btn ghost danger" + (armed ? " armed" : "")} type="button" onClick={del}>{armed ? "Delete logo?" : "Delete"}</button></div>
      </div>
      <div className="lg-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-b stack">
              <div className="lg-art" style={{ background: bg }}>{pv ? <img src={pv} alt={d.name} /> : <span className="faint">No preview</span>}</div>
              <div className="lg-bgs" role="group" aria-label="Background">{BGS.map(([n, h]) => <button key={h} type="button" title={n} aria-label={n} className={bg === h ? "on" : ""} style={{ background: h }} onClick={() => setBg(h)} />)}</div>
              {ps?.wIn ? <div className="lg-size"><b>Prints {ps.wIn}&quot;{ps.hIn ? ` × ${ps.hIn}"` : " wide"}</b>{ps.location ? <span className="faint"> · {ps.location}</span> : null}</div> : null}
              <div className="sub">{/\.(svg|ai|eps|pdf)$/i.test(d.file_name) ? "Vector" : "Picture"} · {d.colors} color{d.colors === 1 ? "" : "s"}{d.inks ? ` · ${d.inks}` : ""}{ratio ? ` · 1 : ${ratio.toFixed(2)}` : ""}</div>
              {cws.length > 0 && <><div className="lg-k">Colorways</div><div className="lg-pills">{cws.map((c) => <span key={c.name} className="lg-pill">{c.name}</span>)}</div></>}
              {src && (src.printavo || src.dropbox) && <><div className="lg-k">Came from</div><div className="sub">{src.printavo ? `Printavo #${src.printavo}` : `Dropbox: ${src.dropbox}`}{src.where ? ` · ${src.where}` : ""}</div></>}
              {brand && <><div className="lg-k">Brand standard</div><div className="sub">{brand.name}{brand.rules?.light ? ` · light goods ${brand.rules.light}` : ""}{brand.rules?.dark ? ` · dark goods ${brand.rules.dark}` : ""}{brand.embroidery?.light?.length ? ` · thread ${brand.embroidery.light[0]}${brand.embroidery.dark?.length ? ` / ${brand.embroidery.dark[0]}` : ""}` : ""}</div></>}
              <label className="btn sm" style={{ cursor: "pointer", alignSelf: "flex-start" }}>{pv ? "Replace preview image" : "Add preview image"}<input type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setD(await setDesignPreview(sb, d, f)); setMsg("Preview updated"); load(); } catch (er) { setMsg(String(er)); } }} /></label>
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Details</h2></div>
            <div className="panel-b grid g2">
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="d-n">Name</label><input id="d-n" type="text" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} onBlur={(e) => patch({ name: e.target.value })} /></div>
              <div className="field" style={{ gridColumn: "1 / -1" }}><label>Customer</label><CustomerPick field value={d.customer_id || null} options={customers.map((c) => ({ id: c.id, label: custLabel(c), sub: c.company && c.name ? c.name : c.email || "" }))} placeholder="No customer: type to pick one" onPick={(v) => patch({ customer_id: v || null })} /></div>
              <div className="field"><label htmlFor="d-k">Ink colors</label><input id="d-k" type="number" min="1" max="15" value={d.colors} onChange={(e) => patch({ colors: Math.max(1, +e.target.value || 1) })} /></div>
              <div className="field"><label htmlFor="d-i">Inks / PMS</label><input id="d-i" type="text" value={d.inks} onChange={(e) => setD({ ...d, inks: e.target.value })} onBlur={(e) => patch({ inks: e.target.value })} /></div>
              {/* a distressed logo: customers whose brand standards say "fashion hit for distressed logos" print it without an underbase (Oct 16) */}
              <label className="check" style={{ gridColumn: "1 / -1" }} title="Worn / cracked texture in the art. A customer's brand standard can print distressed logos as a fashion hit (no underbase)."><input type="checkbox" checked={!!(d.specs as { distressed?: boolean } | null)?.distressed} onChange={(e) => patch({ specs: { ...((d.specs || {}) as object), distressed: e.target.checked || undefined } as Design["specs"] })} /> Distressed logo</label>
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="d-no">Notes</label><textarea id="d-no" rows={3} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} onBlur={(e) => patch({ notes: e.target.value })} /></div>
            </div>
          </section>
        </div>

        <div className="stack">
          <nav className="aa-nav ot-nav lg-nav" aria-label="Departments">
            {([["emb", "Embroidery"], ["sp", "Screen print"], ["hp", "Heat press"], ["hist", "History"]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} type="button" className={"aa-tab" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)} title={l}><svg className="ot-ic" viewBox="0 0 24 24" aria-hidden>{TAB_ICONS[k]}</svg><span className="ot-l">{l}</span>{counts[k] > 0 && <span className="aa-n">{counts[k]}</span>}</button>
            ))}
          </nav>

          {tab === "emb" && (
            <section className="panel">
              <div className="panel-h"><h2>Embroidery</h2><span className="faint">{sews.length ? "Each sew file: the DST with its EMB and sewing sheet" : "No sew files yet"}{sewouts ? ` · ${sewouts} sew-out${sewouts === 1 ? "" : "s"}` : ""}</span>
                <span className="spacer" /><label className="btn sm" style={{ cursor: "pointer" }}>{sewBusy ? "Adding…" : "+ Add sew file"}<input type="file" hidden multiple accept=".dst,.emb,.pdf,.zip" disabled={sewBusy} onChange={(e) => { void addSew(e.target.files); e.target.value = ""; }} /></label></div>
              {sews.length > 0 ? <div className="tbl-wrap"><table className="tbl lg-sew">
                <thead><tr><th>Sew file</th><th>Size</th><th>Stitches</th><th>Kind</th><th>Where it goes</th><th>Last used</th><th>Files</th></tr></thead>
                <tbody>{sews.map((f, i) => ({ f, i })).sort((a, b) => (b.f.wIn || 0) - (a.f.wIn || 0)).map(({ f, i }) => (
                  <tr key={i}>
                    <td><b className="ordno">{tajimaName(d.number, Number((f.code || "E1").slice(1)) || i + 1)}</b></td>
                    <td style={{ whiteSpace: "nowrap" }}>{f.wIn}&quot; × {f.hIn}&quot;</td>
                    <td style={{ whiteSpace: "nowrap" }}>{(f.stitches || 0).toLocaleString()}<div className="sub">{f.colors} color{f.colors === 1 ? "" : "s"}</div></td>
                    <td><select className="lg-kind" aria-label="Kind" value={f.kind || "flat"} onChange={(e) => void setSew(i, { kind: e.target.value as Sew["kind"] })}>{Object.entries(SEW_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                    <td><input type="text" aria-label="Where it goes" defaultValue={f.placement || ""} placeholder="Left Chest, Left Sleeve…" title="Every place this file sews: one file can go on several spots" onBlur={(e) => { if ((f.placement || "") !== e.target.value.trim()) void setSew(i, { placement: e.target.value.trim() || undefined }); }} /></td>
                    <td>{f.lastUsed?.job ? <span style={{ whiteSpace: "nowrap" }}>#{f.lastUsed.job}<div className="sub">{f.lastUsed.date ? fmtDate(f.lastUsed.date) : ""}</div></span> : f.lastUsed?.dropbox ? <span className="sub">Dropbox: {f.lastUsed.dropbox.split("/").slice(-2).join(" / ")}</span> : <span className="faint">—</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}><a href={fileLink(f.path, f.name)} target="_blank" rel="noreferrer">DST</a>{f.emb && <> · <a href={fileLink(f.emb.path, f.emb.name)} target="_blank" rel="noreferrer">EMB</a></>}{f.sheet && <> · <a href={fileLink(f.sheet.path, f.sheet.name)} target="_blank" rel="noreferrer">Sheet</a></>}</td>
                  </tr>
                ))}</tbody>
              </table></div> : <div className="panel-b faint">Add the digitizer&apos;s DST (with its EMB and sheet), or use Find it everywhere to bring in the ones from past jobs.</div>}
            </section>
          )}

          {tab === "sp" && (
            <section className="panel">
              <div className="panel-h"><h2>Screen print</h2><span className="faint">Separations and films for this logo</span><span className="spacer" /><Link className="btn sm" href="/shop/separations">Separations</Link></div>
              {seps.length > 0 ? <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Separation</th><th>Where</th><th>Shirt</th><th>Status</th><th>Made</th></tr></thead>
                <tbody>{seps.map((x) => <tr key={x.id}><td><Link className="ordno" href={`/shop/separations/${x.id}`}>{x.number ? `S-${x.number}` : "Separation"}</Link><div className="sub">{x.method || ""}</div></td><td>{x.location || "—"}</td><td>{x.garment_color || "—"}</td><td>{x.status || "—"}</td><td style={{ whiteSpace: "nowrap" }}>{fmtDate(x.created_at.slice(0, 10))}</td></tr>)}</tbody>
              </table></div> : <div className="panel-b faint">No separations for this logo yet.</div>}
              {films.length > 0 && <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Film</th><th>Order</th><th>Added</th></tr></thead>
                <tbody>{films.map((f) => { const o = orders.find((x) => x.id === f.order_id); return <tr key={f.id}><td><a href={fileLink(f.file_path)} target="_blank" rel="noreferrer">{f.name.replace(/^Film:\s*/, "")}</a></td><td>{o ? <Link className="ordno" href={`/shop/orders/${o.id}`}>#{o.number}</Link> : "—"}</td><td style={{ whiteSpace: "nowrap" }}>{fmtDate(f.created_at.slice(0, 10))}</td></tr>; })}</tbody>
              </table></div>}
            </section>
          )}

          {tab === "hp" && (
            <section className="panel">
              <div className="panel-h"><h2>Heat press</h2><span className="faint">Gang sheets this logo is on</span><span className="spacer" /><Link className="btn sm" href="/shop/gang-sheet/builder">Gang Sheet Builder</Link></div>
              {gangs.length > 0 ? <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Gang sheet</th><th>Status</th><th>Made</th></tr></thead>
                <tbody>{gangs.map((g) => <tr key={g.id}><td><b>{g.name || "Gang sheet"}</b></td><td>{g.status || "—"}</td><td style={{ whiteSpace: "nowrap" }}>{fmtDate(g.created_at.slice(0, 10))}</td></tr>)}</tbody>
              </table></div> : <div className="panel-b faint">{/\.svg$/i.test(d.file_name) ? "Not on a gang sheet yet. It's vector, so it prints sharp at any size." : "Not on a gang sheet yet."}</div>}
            </section>
          )}

          {tab === "hist" && (
            <section className="panel">
              <div className="panel-h"><h2>History</h2><span className="faint">Where it came from and every order it ran on</span></div>
              <div className="panel-b lg-hist">{hist.map((h, i) => (
                <div key={i} className="lg-h"><b>{h.at ? fmtDate(h.at) : "—"}</b>{h.href ? <Link href={h.href}>{h.text}</Link> : <span>{h.text}</span>}</div>
              ))}</div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
