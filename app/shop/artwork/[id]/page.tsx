"use client";
import { needsDarkBackdrop } from "@/lib/lightArt";
import Link from "next/link";
import BackLink from "@/components/BackLink";
import CustomerPick from "@/components/CustomerPick";
import { use, useEffect, useMemo, useState } from "react";
import LogoDetails from "@/components/LogoDetails";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { designLabel, orderGroups, type Customer, type Design, type Order } from "@/lib/pricing";
import { custLabel, fmtDate } from "@/lib/format";
import { addColorway, setDesignPreview } from "@/lib/designs";
import LogoEditor from "@/components/LogoEditor";
import { colorwaySew, colorwaysOf, nextSewCode, SEW_KINDS, sewFilesOf, sewThreads, tajimaName, type Brand, type Colorway, type SewFile } from "@/lib/brands";
import { colorsText, colorwayUses, inkColor, logoColors, parseColors } from "@/lib/logoColors";
import { useRole } from "@/components/RoleContext";
import { tajimaFile } from "@/components/CustomerBrands";
import { useSticky } from "@/lib/useSticky";
import LogoResearch, { type LogoHistory, type Sew } from "@/components/LogoResearch";
import { LogoFace, onShirtsOf } from "@/components/LogoOnShirts";
import { heldFiles } from "@/lib/heldFiles";

/**
 * One logo, everything about it by department (Oct 28, Nick: "a layout that'll have… the separations for that logo… film
 * for that logo… DSTs"): the art on its backgrounds with its print size, colorways, where it came from and its brand on
 * the left; Embroidery (each sew file by size), Screen print (separations, films), Heat press (gang sheets) and History
 * on the right. "Find it everywhere" looks through the client's jobs for where it ran (components/LogoResearch.tsx).
 */
type D = Design & { brand_id?: string | null };
type Tab = "emb" | "sp" | "hp" | "ord" | "hist";
type Sep = { id: string; number: number | null; location: string | null; garment_color: string | null; status: string | null; method: string | null; created_at: string };
type Gang = { id: string; name: string | null; status: string | null; created_at: string; data: unknown };
type Film = { id: string; name: string; file_path: string; order_id: string; created_at: string };
const fileLink = (p: string, n?: string) => `/api/files/open?${new URLSearchParams({ p, ...(n ? { n } : {}) })}`;
/** a light logo (white ink) shows on charcoal so it can be seen; anything else on white. No made-up backgrounds or colors
 *  (Oct 28, Nick: "you're automatically adding in some variations that don't exist… we need to get rid of it") */
async function isLightArt(url: string): Promise<boolean> {
  try {
    const im = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const c = document.createElement("canvas"); c.width = 64; c.height = Math.max(1, Math.round((64 * (im.naturalHeight || 1)) / (im.naturalWidth || 1)));
    const g = c.getContext("2d", { willReadFrequently: true }); if (!g) return false;
    g.drawImage(im, 0, 0, c.width, c.height);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 128) n++;
    // see-through art with light parts that would vanish on white (lib/lightArt.ts); a picture with a white background
    // is opaque, so it stays on white
    return n > 0 && n < (px.length / 4) * 0.97 && needsDarkBackdrop(px);
  } catch { return false; }
}
const TAB_ICONS: Record<Tab, React.ReactNode> = {
  emb: <path d="M4 20L20 4M14 4h6v6M6 14l4 4" />,
  sp: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M10 4v16" /></>,
  hp: <path d="M12 3c3 4 6 6 6 10a6 6 0 01-12 0c0-4 3-6 6-10z" />,
  ord: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 9h6M9 13h6M9 17h4" /></>,
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
  const [cwUrls, setCwUrls] = useState<string[]>([]);
  // the logo on the shirt picked for it (Edit logo → Backgrounds / Put on a shirt): its saved picture's link
  const [shirtUrl, setShirtUrl] = useState("");
  const [shown, setShown] = useState(-1); // -1: the logo's own art; else that colorway
  const [lightArt, setLightArt] = useState(false);
  const [research, setResearch] = useState(false);
  // the logo editor (remove the white, change colors, crop): opened from here or a logo card's ✎ (?edit=1)
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(false);
  const [sewBusy, setSewBusy] = useState(false);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [colEdit, setColEdit] = useState<string | null>(null);
  const [cwEdit, setCwEdit] = useState<number | null>(null);
  const [cwBusy, setCwBusy] = useState(false);
  const [cwDark, setCwDark] = useState<boolean[]>([]);
  const role = useRole().role;
  const canUnlock = !role || role === "owner" || role === "admin";
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
    const cwp = colorwaysOf(des).map((c) => c.preview || "");
    const { data: cu } = cwp.some(Boolean) ? await sb.storage.from("proofs").createSignedUrls(cwp.map((x) => x || des.preview_path || "x"), 3600) : { data: [] };
    setCwUrls(cwp.map((x, i) => (x ? cu?.[i]?.signedUrl || "" : "")));
    const sv = onShirtsOf(des)[0]?.path || "";
    setShirtUrl(sv ? (await sb.storage.from("proofs").createSignedUrl(sv, 3600)).data?.signedUrl || "" : "");
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
    if (des.customer_id) { const { data: bs } = await sb.from("brands").select("*").eq("customer_id", des.customer_id).is("archived_at", null).order("sort"); setBrands((bs || []) as Brand[]); }
    setGangs(((g.data || []) as Gang[]).filter((x) => JSON.stringify(x.data || "").includes(des.id)));
    if (used.length) {
      const { data: af } = await sb.from("art_files").select("id, name, file_path, order_id, created_at").in("order_id", used.map((x) => x.id)).ilike("name", "Film:%");
      setFilms((af || []) as Film[]);
    } else setFilms([]);
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownUrl = shown >= 0 ? cwUrls[shown] || "" : pv;
  // each colorway's picture on a dark backdrop when it has light parts (the same test as the big picture)
  useEffect(() => { let on = true; void Promise.all(cwUrls.map((u) => (u ? isLightArt(u) : Promise.resolve(false)))).then((v) => { if (on) setCwDark(v); }); return () => { on = false; }; }, [cwUrls]);
  useEffect(() => { let on = true; setLightArt(false); if (shownUrl) void isLightArt(shownUrl).then((v) => { if (on) setLightArt(v); }); return () => { on = false; }; }, [shownUrl]);

  async function patch(p: Partial<D>) {
    if (!d) return;
    setD({ ...d, ...p });
    const { error } = await sb.from("designs").update(p).eq("id", d.id);
    setMsg(error ? "Couldn't save: " + error.message : "Saved");
  }
  async function del() {
    if (!d) return;
    if ((d.specs as { master?: unknown } | null)?.master) { setMsg("A master logo can't be deleted."); return; }
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
      const { set } = await takeDigitized(sb, d.id, named, { link: false });
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

  /** change some of the logo's specs (fresh from the database, so nothing another tab saved is lost) */
  async function setSpecs(p: Record<string, unknown>) {
    if (!d) return;
    const { data } = await sb.from("designs").select("specs").eq("id", d.id).maybeSingle();
    const specs = { ...((data?.specs || d.specs || {}) as Record<string, unknown>), ...p };
    for (const k of Object.keys(p)) if (p[k] === undefined) delete specs[k];
    await patch({ specs: specs as Design["specs"] });
  }
  async function setCw(i: number, p: Partial<Colorway>) {
    if (!d) return;
    const list = colorwaysOf(d).map((c, j) => { if (j !== i) return c; const n = { ...c, ...p }; if (!n.sew) delete n.sew; return n; });
    await setSpecs({ colorways: list });
  }
  async function addCw(f: File | null) {
    if (!d || !f) return;
    setCwBusy(true);
    try { await addColorway(sb, d, f, { name: f.name.replace(/\.[^.]+$/, "") }); setMsg("Colorway added"); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't add the colorway."); }
    setCwBusy(false);
  }
  async function setBrandOf(id: string | null) {
    if (!d) return;
    await patch({ brand_id: id } as Partial<D>);
    setBrand(brands.find((b) => b.id === id) || null);
  }
  /** a master logo is set in stone: it can't be deleted, archived or have its art replaced (the database refuses too) */
  async function setMaster(on: boolean) {
    if (!on && !canUnlock) { setMsg("Only an owner or admin can unlock a master logo."); return; }
    const { data: u } = await sb.auth.getUser();
    await setSpecs({ master: on ? { at: new Date().toISOString(), by: u.user?.email || "" } : undefined });
    setMsg(on ? "Locked as a master logo" : "Unlocked");
  }

  if (!d) return <div className="empty">{msg || "Loading…"}</div>;
  const sp = (d.specs || {}) as { printSize?: { wIn?: number; hIn?: number; location?: string }; source?: { printavo?: string; dropbox?: string; where?: string }; history?: LogoHistory[] };
  const src = sp.source;
  const sews = sewFilesOf(d) as Sew[];
  const cws = colorwaysOf(d);
  const hist: { at: string; text: string; href?: string }[] = [
    ...orders.map((o) => ({ at: (o.created_at || "").slice(0, 10), text: `On #${o.number} ${o.nickname || ""} · ${orderGroups(o).flatMap((g) => g.imprints.filter((im) => im.design_id === d.id).map((im) => im.location)).join(", ")}`, href: `/shop/orders/${o.id}` })),
    ...(sp.history || []).map((h) => ({ at: h.date || "", text: `Ran on Printavo #${h.job}${h.name ? ` ${h.name}` : ""}${h.where ? ` · ${h.where}` : ""}${h.note ? ` · ${h.note}` : ""}` })),
    ...sews.map((f) => ({ at: (f.at || "").slice(0, 10), text: `${tajimaName(d.number, Number((f.code || "E1").slice(1)) || 1)} added (${f.wIn}" × ${f.hIn}")${f.lastUsed?.job ? ` from #${f.lastUsed.job}` : ""}` })),
    { at: (d.created_at || "").slice(0, 10), text: `Logo made${src?.printavo ? ` from Printavo #${src.printavo}` : src?.dropbox ? ` from Dropbox ${src.dropbox}` : ""}${d.created_by ? ` · ${d.created_by.split("@")[0]}` : ""}` },
  ].filter((h) => h.text).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  const colors = logoColors(d, brand);
  // "Last used" only when a sew file has one (a column that's only sometimes needed, house rule)
  const anyUsed = sews.some((f) => f.lastUsed?.job || f.lastUsed?.dropbox);
  const master = (d.specs as { master?: { at?: string; by?: string } | null } | null)?.master || null;
  // every print of this logo on an order: where it went and how big (a logo's size lives with each use, Oct 31, Nick)
  const uses = orders.flatMap((o) => orderGroups(o).flatMap((g) => g.imprints.filter((im) => im.design_id === d.id).map((im) => ({ o, where: im.location, size: im.size, method: im.method === "embroidery" ? "Embroidery" : im.method === "screen" ? "Screen print" : im.method === "dtf" ? "Heat press" : im.method, colors: im.inks }))));
  const counts: Record<Tab, number> = { emb: sews.length, sp: seps.length + films.length, hp: gangs.length, ord: uses.length, hist: hist.length };

  return (
    <>
      <BackLink href="/shop/artwork" label="Artwork" />
      {editing && <LogoEditor d={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setMsg("Logo saved"); load(); }} />}
      {details && <LogoDetails d={d} onClose={() => setDetails(false)} onSaved={(x) => { setDetails(false); setD(x as D); setMsg("Details saved"); }} />}
      {research && <LogoResearch d={d} brand={brand} onClose={() => setResearch(false)} onDone={(m) => { setResearch(false); setMsg(m); load(); }} />}
      <div className="page-head">
        <div>
          <div className="lgx-title"><h1>{designLabel(d)}</h1>{master && <span className="lgx-master" title={`Master logo: it can't be deleted or have its art replaced${master.by ? ` (locked by ${master.by.split("@")[0]})` : ""}`}><LockIcon />Master logo</span>}</div>
          <div className="eyebrow">{custLabel(customers.find((c) => c.id === d.customer_id)) || "No customer"}{brand ? ` › ${brand.name} brand` : ""} · {/\.(svg|ai|eps|pdf)$/i.test(d.file_name) ? "Vector" : "Picture"}{cws.length ? ` · ${cws.length} colorway${cws.length === 1 ? "" : "s"}` : ""}</div>
        </div>
        <div className="row"><span className="save-state">{msg}</span>
          <button type="button" className="btn primary" onClick={() => setResearch(true)} title="Look through this client's jobs for everywhere this logo ran">Find it everywhere</button>
          {d.customer_id && !master && <Link className="btn" href={`/shop/art-builder?${new URLSearchParams({ customer: d.customer_id, into: d.id, q: (brand?.name || d.name).split(/\s*\/\s*/)[0], ...(d.brand_id ? { brand: d.brand_id } : {}) })}`} title="Pick this logo's art out of a job's files">Pull its art from a job</Link>}
          <Link className="btn" href={`/shop/artwork/mockup?customer=${d.customer_id || ""}&design=${d.id}`}>Put on a shirt</Link>
          {!master && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit logo</button>}
          {orig && <a className="btn" href={orig} target="_blank" rel="noreferrer">Download</a>}
          {!master && <button className={"btn ghost danger" + (armed ? " armed" : "")} type="button" onClick={del}>{armed ? "Delete logo?" : "Delete"}</button>}</div>
      </div>

      {/* 1. the logo: its art as on file, and every color it comes in (Oct 31, Nick: "here's the logo, here's the colors… very visual") */}
      <section className="panel">
        <div className="panel-h"><h2>The logo</h2><span className="faint">As the customer sent it, and every color it comes in</span></div>
        <div className="panel-b lgx-logo">
          <div className="lgx-art-w">
            <div className={"lg-art lgx-art" + (shown < 0 && onShirtsOf(d).length && pv ? " on-shirt" : lightArt ? " dark" : "")}>{shown < 0 && onShirtsOf(d).length && pv
              ? <LogoFace d={d} urls={{ [d.id]: pv, ...(shirtUrl ? { [onShirtsOf(d)[0].path as string]: shirtUrl } : {}) }} />
              : shownUrl ? <img src={shownUrl} alt={d.name} /> : <span className="faint">No preview</span>}</div>
            {shown >= 0 && <div className="lgx-showing"><span>Showing <b>{cws[shown]?.name}</b></span><button type="button" className="linkbtn" onClick={() => setShown(-1)}>As on file</button></div>}
          </div>
          <div className="lgx-side">
            <div className="lgx-k">Logo colors{!colEdit && <button type="button" className="linkbtn" onClick={() => setColEdit(colorsText(colors))}>Edit</button>}</div>
            {colEdit !== null ? (
              <div className="lgx-coledit">
                <div className="field"><label htmlFor="lgx-c">One a line: name | PMS | #hex</label><textarea id="lgx-c" rows={5} value={colEdit} placeholder={"Maroon | PMS 492 C | #8B2E35\nOff White | PMS Warm Gray 1 C | #FAF6EC"} onChange={(e) => setColEdit(e.target.value)} /></div>
                <div className="row"><button type="button" className="btn ghost sm" onClick={() => setColEdit(null)}>Cancel</button><button type="button" className="btn primary sm" onClick={() => { void setSpecs({ colors: parseColors(colEdit) }); setColEdit(null); }}>Save colors</button></div>
              </div>
            ) : colors.length ? (
              <div className="lgx-sws">{colors.map((c) => (
                <div key={c.name} className="lgx-sw"><span className="lgx-chip" style={{ background: c.hex }} /><b>{c.name}</b><span>{c.pms || " "}</span><small data-notranslate>{c.hex}</small></div>
              ))}</div>
            ) : <p className="faint">No colors yet: add them, or add colorways and their inks fill this in.</p>}
            <div className="lgx-own">
              <span className="lgx-k0">Belongs to</span>
              <span>{custLabel(customers.find((c) => c.id === d.customer_id)) || "No customer"}</span>
              {d.customer_id && <><span className="faint">›</span>
                <select aria-label="Brand" className="lgx-brand" value={d.brand_id || ""} onChange={(e) => void setBrandOf(e.target.value || null)}>
                  <option value="">No brand</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></>}
              <span className="lgx-sep" />
              <label className={"lgx-lock" + (master ? " on" : "")} title={master ? (canUnlock ? "Locked: it can't be deleted or have its art replaced. Turn off to unlock." : "Locked: only an owner or admin can unlock a master logo") : "Make it a master logo: set in stone, it can't be deleted or have its art replaced"}>
                <LockIcon /><span>Master logo</span>
                <input type="checkbox" role="switch" checked={!!master} disabled={!!master && !canUnlock} onChange={(e) => void setMaster(e.target.checked)} /><i aria-hidden />
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* 2. colorways: each version of the logo, when the brand uses it, and the sew file that stitches it */}
      <section className="panel">
        <div className="panel-h"><h2>Colorways</h2><span className="faint">Each version of the logo, and when the brand uses it</span><span className="spacer" />
          <label className="btn sm" style={{ cursor: "pointer" }}>{cwBusy ? "Adding…" : "+ Add colorway"}<input type="file" hidden accept=".svg,.pdf,.ai,.eps,.png,.jpg,.jpeg,.webp" disabled={cwBusy} onChange={(e) => { void addCw(e.target.files?.[0] || null); e.target.value = ""; }} /></label></div>
        <div className="panel-b">
          {cws.length ? <div className="lgx-cws">{cws.map((c, i) => {
            const uses = colorwayUses(c, brand), sew = colorwaySew(d, c);
            return (
              <div key={c.name + i} className={"lgx-cw" + (shown === i ? " on" : "")}>
                <button type="button" className={"lgx-pic" + (cwDark[i] ? " dark" : "")} onClick={() => setShown(shown === i ? -1 : i)} title="Show it big">{cwUrls[i] ? <img src={cwUrls[i]} alt={c.name} /> : <span className="faint">No picture</span>}</button>
                <div className="lgx-bar" aria-hidden>{(c.inks.length ? c.inks : ["?"]).map((ink, j) => <i key={j} style={{ background: inkColor(ink, colors).hex }} />)}</div>
                {cwEdit === i ? (
                  <div className="lgx-cwb lgx-cwedit">
                    <div className="field"><label htmlFor={`cwn${i}`}>Name</label><input id={`cwn${i}`} type="text" defaultValue={c.name} onBlur={(e) => void setCw(i, { name: e.target.value.trim() || c.name })} /></div>
                    <div className="field"><label htmlFor={`cwi${i}`}>Inks / PMS</label><input id={`cwi${i}`} type="text" defaultValue={c.inks.join(", ")} placeholder="PMS 492 C, Black" onBlur={(e) => void setCw(i, { inks: e.target.value.split(/\s*,\s*/).filter(Boolean) })} /></div>
                    <button type="button" className="btn sm" onClick={() => setCwEdit(null)}>Done</button>
                  </div>
                ) : (
                  <div className="lgx-cwb">
                    <div className="lgx-cwt"><b>{c.name}</b><button type="button" className="linkbtn" onClick={() => setCwEdit(i)}>Edit</button></div>
                    {uses.length ? <div className="lgx-uses">{uses.map((u) => <span key={u} className="lgx-use">{u}</span>)}</div> : null}
                    <div className="sub">{c.inks.join(", ") || "No inks named"}</div>
                    <div className="lgx-cwf">
                      {sews.length ? <select aria-label={`Sew file for ${c.name}`} value={c.sew || ""} onChange={(e) => void setCw(i, { sew: e.target.value || undefined })} title="The sew file that stitches this colorway: an order with it gets this DST">
                        <option value="">No sew file</option>{sews.map((f, j) => <option key={j} value={f.code || ""}>Sews as {tajimaName(d.number, Number((f.code || "E1").slice(1)) || j + 1)}</option>)}
                      </select> : null}
                      {c.file && <a href={fileLink(c.file.path, c.file.name)} target="_blank" rel="noreferrer">{/\.(svg|ai|eps|pdf)$/i.test(c.file.name) ? "Vector" : "File"}</a>}
                    </div>
                    {sew && <div className="sub" title="Its sew file's threads">{sewThreads(sew).join(" + ")}</div>}
                  </div>
                )}
              </div>
            );
          })}</div> : <p className="faint">No colorways yet. Add each version of the logo (its file in those colors), or bring in the same art in other colors and pick &quot;Add as a colorway&quot;.</p>}
        </div>
      </section>

      {/* 3. files and history: what each department has of it, and where it's been used (sizes live with each use) */}
      <section className="panel">
        <div className="panel-h"><h2>Files and history</h2><span className="faint">What each department has of this logo, and where it&apos;s been used</span></div>
        <nav className="aa-nav ot-nav lg-nav lgx-nav" aria-label="Departments">
          {([["emb", "Embroidery"], ["sp", "Screen print"], ["hp", "Heat press"], ["ord", "Orders"], ["hist", "History"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" className={"aa-tab" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)} title={l}><svg className="ot-ic" viewBox="0 0 24 24" aria-hidden>{TAB_ICONS[k]}</svg><span className="ot-l">{l}</span>{counts[k] > 0 && <span className="aa-n">{counts[k]}</span>}</button>
          ))}
        </nav>

          {tab === "emb" && (
            <div className="lgx-tab">
              <div className="panel-h"><span className="faint">{sews.length ? "Each sew file: the DST with its EMB and sewing sheet, made at one size for one spot" : "No sew files yet"}{sewouts ? ` · ${sewouts} sew-out${sewouts === 1 ? "" : "s"}` : ""}</span>
                <span className="spacer" /><label className="btn sm" style={{ cursor: "pointer" }}>{sewBusy ? "Adding…" : "+ Add sew file"}<input type="file" hidden multiple accept=".dst,.emb,.pdf,.zip" disabled={sewBusy} onChange={(e) => { void addSew(heldFiles(e.target.files)); e.target.value = ""; }} /></label></div>
              {sews.length > 0 ? <div className="tbl-wrap"><table className="tbl lg-sew">
                <thead><tr><th>Sew file</th><th>Colorway</th><th>Where · size</th><th>Threads</th><th>Stitches</th><th>Goods</th>{anyUsed && <th>Last used</th>}<th>Files</th></tr></thead>
                <tbody>{sews.map((f, i) => ({ f, i })).sort((a, b) => (a.f.code || "").localeCompare(b.f.code || "", undefined, { numeric: true })).map(({ f, i }) => (
                  <tr key={i}>
                    <td><b className="ordno">{tajimaName(d.number, Number((f.code || "E1").slice(1)) || i + 1)}</b></td>
                    <td>{cws.filter((c) => c.sew && c.sew === f.code).map((c) => c.name).join(", ") || <span className="faint">—</span>}</td>
                    <td><input type="text" aria-label="Where it goes" defaultValue={f.placement || ""} placeholder="Left chest, Left sleeve…" title="Every place this file sews: one file can go on several spots" onBlur={(e) => { if ((f.placement || "") !== e.target.value.trim()) void setSew(i, { placement: e.target.value.trim() || undefined }); }} /><div className="sub" style={{ whiteSpace: "nowrap" }}>{f.wIn}&quot; × {f.hIn}&quot;</div></td>
                    <td>{sewThreads(f).length ? sewThreads(f).map((t, k) => <div key={k} className="lgx-th">{t}</div>) : <span className="faint">{f.colors} color{f.colors === 1 ? "" : "s"}</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{(f.stitches || 0).toLocaleString()}</td>
                    <td><select className="lg-kind" aria-label="Kind" value={f.kind || "flat"} onChange={(e) => void setSew(i, { kind: e.target.value as Sew["kind"] })}>{Object.entries(SEW_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                    {anyUsed && <td>{f.lastUsed?.job ? <span style={{ whiteSpace: "nowrap" }}>#{f.lastUsed.job}<div className="sub">{f.lastUsed.date ? fmtDate(f.lastUsed.date) : ""}</div></span> : f.lastUsed?.dropbox ? <span className="sub">Dropbox: {f.lastUsed.dropbox.split("/").slice(-2).join(" / ")}</span> : <span className="faint">—</span>}</td>}
                    <td style={{ whiteSpace: "nowrap" }}><a href={fileLink(f.path, f.name)} target="_blank" rel="noreferrer">DST</a>{f.emb && <> · <a href={fileLink(f.emb.path, f.emb.name)} target="_blank" rel="noreferrer">EMB</a></>}{f.sheet && <> · <a href={fileLink(f.sheet.path, f.sheet.name)} target="_blank" rel="noreferrer">Sheet</a></>}</td>
                  </tr>
                ))}</tbody>
              </table></div> : <div className="panel-b faint">Add the digitizer&apos;s DST (with its EMB and sheet), or use Find it everywhere to bring in the ones from past jobs.</div>}
            </div>
          )}

          {tab === "sp" && (
            <div className="lgx-tab">
              <div className="panel-h"><span className="faint">Separations and films for this logo</span><span className="spacer" /><Link className="btn sm" href="/shop/separations">Separations</Link></div>
              {seps.length > 0 ? <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Separation</th><th>Where</th><th>Shirt</th><th>Status</th><th>Made</th></tr></thead>
                <tbody>{seps.map((x) => <tr key={x.id}><td><Link className="ordno" href={`/shop/separations/${x.id}`}>{x.number ? `S-${x.number}` : "Separation"}</Link><div className="sub">{x.method || ""}</div></td><td>{x.location || "—"}</td><td>{x.garment_color || "—"}</td><td>{x.status || "—"}</td><td style={{ whiteSpace: "nowrap" }}>{fmtDate(x.created_at.slice(0, 10))}</td></tr>)}</tbody>
              </table></div> : <div className="panel-b faint">No separations for this logo yet.</div>}
              {films.length > 0 && <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Film</th><th>Order</th><th>Added</th></tr></thead>
                <tbody>{films.map((f) => { const o = orders.find((x) => x.id === f.order_id); return <tr key={f.id}><td><a href={fileLink(f.file_path)} target="_blank" rel="noreferrer">{f.name.replace(/^Film:\s*/, "")}</a></td><td>{o ? <Link className="ordno" href={`/shop/orders/${o.id}`}>#{o.number}</Link> : "—"}</td><td style={{ whiteSpace: "nowrap" }}>{fmtDate(f.created_at.slice(0, 10))}</td></tr>; })}</tbody>
              </table></div>}
            </div>
          )}

          {tab === "hp" && (
            <div className="lgx-tab">
              <div className="panel-h"><span className="faint">Gang sheets this logo is on</span><span className="spacer" /><Link className="btn sm" href="/shop/gang-sheet/builder">Gang Sheet Builder</Link></div>
              {gangs.length > 0 ? <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Gang sheet</th><th>Status</th><th>Made</th></tr></thead>
                <tbody>{gangs.map((g) => <tr key={g.id}><td><b>{g.name || "Gang sheet"}</b></td><td>{g.status || "—"}</td><td style={{ whiteSpace: "nowrap" }}>{fmtDate(g.created_at.slice(0, 10))}</td></tr>)}</tbody>
              </table></div> : <div className="panel-b faint">{/\.svg$/i.test(d.file_name) ? "Not on a gang sheet yet. It's vector, so it prints sharp at any size." : "Not on a gang sheet yet."}</div>}
            </div>
          )}

          {tab === "ord" && (
            <div className="lgx-tab">
              <div className="panel-h"><span className="faint">Every order it&apos;s on, with where it went and how big</span></div>
              {uses.length ? <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Order</th><th>Where · size</th><th>How</th><th>Made</th></tr></thead>
                <tbody>{uses.map((u, i) => <tr key={i}><td><Link className="ordno" href={`/shop/orders/${u.o.id}`}>#{u.o.number}</Link><div className="sub">{u.o.nickname || ""}</div></td><td><b>{u.where || "—"}</b>{u.size ? <span style={{ whiteSpace: "nowrap" }}> · {u.size}</span> : null}{u.colors ? <div className="sub">{u.colors}</div> : null}</td><td>{u.method}</td><td style={{ whiteSpace: "nowrap" }}>{fmtDate((u.o.created_at || "").slice(0, 10))}</td></tr>)}</tbody>
              </table></div> : <div className="panel-b faint">Not on an order here yet. Find it everywhere looks through their Printavo jobs.</div>}
            </div>
          )}

          {tab === "hist" && (
            <div className="lgx-tab">
              <div className="panel-h"><span className="faint">Where it came from and every order it ran on</span></div>
              <div className="panel-b lg-hist">{hist.map((h, i) => (
                <div key={i} className="lg-h"><b>{h.at ? fmtDate(h.at) : "—"}</b>{h.href ? <Link href={h.href}>{h.text}</Link> : <span>{h.text}</span>}</div>
              ))}</div>
            </div>
          )}
      </section>

      {/* the logo's details (name, customer, notes): the same fields as before, under everything */}
      <section className="panel">
        <div className="panel-h"><h2>Details</h2><span className="spacer" />
          <button type="button" className="btn sm" onClick={() => setDetails(true)} title="What it prints and sews in, where it goes, a set size: all optional">Fill in its details</button>
          {!master && <label className="btn sm" style={{ cursor: "pointer" }}>{pv ? "Replace preview image" : "Add preview image"}<input type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setD(await setDesignPreview(sb, d, f)); setMsg("Preview updated"); load(); } catch (er) { setMsg(String(er)); } }} /></label>}</div>
        <div className="panel-b grid g2 lgx-details">
          <div className="field"><label htmlFor="d-n">Name</label><input id="d-n" type="text" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} onBlur={(e) => patch({ name: e.target.value })} /></div>
          <div className="field"><label>Customer</label><CustomerPick field value={d.customer_id || null} options={customers.map((c) => ({ id: c.id, label: custLabel(c), sub: c.company && c.name ? c.name : c.email || "" }))} placeholder="No customer: type to pick one" onPick={(v) => patch({ customer_id: v || null })} /></div>
          <div className="field"><label htmlFor="d-k">Ink colors</label><input id="d-k" type="number" min="1" max="15" value={d.colors} onChange={(e) => patch({ colors: Math.max(1, +e.target.value || 1) })} /></div>
          <div className="field"><label htmlFor="d-i">Inks / PMS</label><input id="d-i" type="text" value={d.inks} onChange={(e) => setD({ ...d, inks: e.target.value })} onBlur={(e) => patch({ inks: e.target.value })} /></div>
          {src && (src.printavo || src.dropbox) && <div className="sub" style={{ gridColumn: "1 / -1" }}>Came from {src.printavo ? `Printavo #${src.printavo}` : `Dropbox: ${src.dropbox}`}{src.where ? ` · ${src.where}` : ""}</div>}
          <label className="check" style={{ gridColumn: "1 / -1" }} title="Worn / cracked texture in the art. A customer's brand standard can print distressed logos as a fashion hit (no underbase)."><input type="checkbox" checked={!!(d.specs as { distressed?: boolean } | null)?.distressed} onChange={(e) => void setSpecs({ distressed: e.target.checked || undefined })} /> Distressed</label>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="d-no">Notes</label><textarea id="d-no" rows={3} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} onBlur={(e) => patch({ notes: e.target.value })} /></div>
        </div>
      </section>
    </>
  );
}

function LockIcon() {
  return <svg className="lgx-lockic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
}
