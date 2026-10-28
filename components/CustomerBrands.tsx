"use client";
import LogoThumb from "@/components/LogoThumb";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { useRole } from "@/components/RoleContext";
import type { Design } from "@/lib/pricing";
import { colorwaysOf, LANES, laneState, nextSewCode, SEW_KINDS, sewFilesOf, tajimaName, type Brand, type BrandColor, type Lane, type SewFile, type SewKind } from "@/lib/brands";

/**
 * A customer's brands (Oct 27, Nick: Cedar Promos manages MEI, ShipStation / WWEX, Embark… "like a design firm"). Each
 * brand: its colors, its rule (which colorway on light / dark / one-color jobs), its threads, and its logos. Each logo is
 * uploaded once; the lane chips show each department's files of it: embroidery's sew files (E1, E2… named D{number}E{n}
 * for the Tajima), screen print's vector and colorways, heat press's print file. The embroidery login sees only the
 * embroidery lane. Orders pick these through Customer artwork → Brands.
 */
type D = Design & { brand_id?: string | null };
const open = (p: string) => `/api/files/open?${new URLSearchParams({ p })}`;
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const colorsText = (cs: BrandColor[]) => cs.map((c) => [c.name, c.pms || "", c.hex, c.thread || ""].join(" | ").replace(/( \| )+$/, "")).join("\n");
const parseColors = (t: string): BrandColor[] => t.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((x) => x[0]).map(([name, pms, hex, thread]) => ({ name, ...(pms ? { pms } : {}), hex: /^#?[0-9a-f]{6}$/i.test(hex || "") ? (hex.startsWith("#") ? hex : "#" + hex) : "#888888", ...(thread ? { thread } : {}) }));

/** a DST renamed for the Tajima: the file name and its LA header both say D{number}E{n} */
export async function tajimaFile(f: File, code: string): Promise<File> {
  const ext = (f.name.match(/\.[^.]+$/)?.[0] || "").toUpperCase();
  const buf = new Uint8Array(await f.arrayBuffer());
  if (ext === ".DST" && String.fromCharCode(buf[0], buf[1], buf[2]) === "LA:") buf.set(new TextEncoder().encode(code.padEnd(16, " ").slice(0, 16)), 3);
  return new File([buf], `${code}${ext === ".PDF" ? " worksheet.pdf" : ext}`, { type: f.type || "application/octet-stream" });
}

export default function CustomerBrands({ customerId }: { customerId: string }) {
  // the embroidery login sees only embroidery (Oct 27, Nick: "the embroidery login… only sees embroidery")
  const embroideryOnly = useRole().role === "embroidery";
  const sb = useMemo(() => createClient(), []);
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [ds, setDs] = useState<D[]>([]);
  const [pics, setPics] = useState<Record<string, string>>({});
  const [sel, setSel] = useSticky<string>(`brands.sel.${customerId}`, "");
  const [laneSaved, setLane] = useSticky<Lane>("brands.lane", "embroidery");
  const lane: Lane = embroideryOnly ? "embroidery" : laneSaved;
  const [edit, setEdit] = useState<{ name: string; colors: string; light: string; dark: string; one_light: string; one_dark: string; tLight: string; tDark: string; backing: string; notes: string } | null>(null);
  const [adding, setAdding] = useState(""), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [kind, setKind] = useState<SewKind>("flat"), [place, setPlace] = useState("Left chest");

  async function load() {
    const [{ data: b }, { data: d }] = await Promise.all([
      sb.from("brands").select("*").eq("customer_id", customerId).is("archived_at", null).order("sort").order("name"),
      sb.from("designs").select("*").eq("customer_id", customerId).is("archived_at", null).eq("draft", false).order("number"),
    ]);
    setBrands((b || []) as Brand[]); setDs((d || []) as D[]);
    const paths = [...new Set(((d || []) as D[]).flatMap((x) => [x.preview_path, ...colorwaysOf(x).map((c) => c.preview)]).filter(Boolean) as string[])].slice(0, 300);
    if (paths.length) { const { data: su } = await sb.storage.from("proofs").createSignedUrls(paths, 3600); setPics(Object.fromEntries(paths.map((p, i) => [p, su?.[i]?.signedUrl || ""]))); }
  }
  useEffect(() => { void load(); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (brands === null) return null;
  const brand = brands.find((b) => b.id === sel) || brands[0] || null;
  const logos = brand ? ds.filter((d) => d.brand_id === brand.id) : [];
  const loose = ds.filter((d) => !d.brand_id);

  async function addBrand() {
    const name = adding.trim();
    if (!name) return;
    setBusy("brand"); setErr("");
    const { data, error } = await sb.from("brands").insert({ customer_id: customerId, name, sort: brands!.length + 1 }).select("*").single();
    setBusy("");
    if (error) return setErr(error.message);
    setAdding(""); setBrands([...(brands || []), data as Brand]); setSel((data as Brand).id);
  }
  async function saveBrand() {
    if (!brand || !edit) return;
    setBusy("save"); setErr("");
    const row = { name: edit.name.trim() || brand.name, colors: parseColors(edit.colors), rules: { light: edit.light.trim(), dark: edit.dark.trim(), one_light: edit.one_light.trim(), one_dark: edit.one_dark.trim() }, embroidery: { light: list(edit.tLight), dark: list(edit.tDark), backing: edit.backing.trim() }, notes: edit.notes.trim() };
    const { error } = await sb.from("brands").update(row).eq("id", brand.id);
    setBusy("");
    if (error) return setErr(error.message);
    setBrands(brands!.map((b) => (b.id === brand.id ? { ...b, ...row } : b))); setEdit(null);
  }
  async function moveLogo(d: D, brandId: string | null) {
    setErr("");
    const { error } = await sb.from("designs").update({ brand_id: brandId }).eq("id", d.id);
    if (error) return setErr(error.message);
    setDs(ds.map((x) => (x.id === d.id ? { ...x, brand_id: brandId } : x)));
  }
  /** a sew file for a logo: the digitizer's DST (with its EMB and worksheet), named D{number}E{n} */
  async function addSew(d: D, files: FileList | null) {
    if (!files?.length) return;
    setBusy("sew" + d.id); setErr("");
    try {
      const { expandFiles, takeDigitized } = await import("@/lib/digitizedFiles");
      const have = sewFilesOf(d), code = nextSewCode(have), name = tajimaName(d.number, Number(code.slice(1)));
      const named = await Promise.all((await expandFiles([...files])).map((f) => tajimaFile(f, name)));
      const { set } = await takeDigitized(sb, null, named);
      const sew: SewFile = { ...set, code, kind, placement: place.trim() || undefined };
      const { data } = await sb.from("designs").select("specs").eq("id", d.id).maybeSingle();
      const sp = (data?.specs || {}) as Record<string, unknown>, em = (sp.embroidery || {}) as { files?: SewFile[] };
      const specs = { ...sp, embroidery: { ...em, files: [...(em.files || []), sew] } };
      const { error } = await sb.from("designs").update({ specs }).eq("id", d.id);
      if (error) throw new Error(error.message);
      setDs(ds.map((x) => (x.id === d.id ? { ...x, specs } : x)));
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't add the sew file."); }
    setBusy("");
  }
  async function setSewKind(d: D, i: number, k: SewKind) {
    const fs = sewFilesOf(d).map((f, j) => (j === i ? { ...f, kind: k } : f));
    const specs = { ...(d.specs || {}), embroidery: { ...((d.specs?.embroidery as object) || {}), files: fs } };
    await sb.from("designs").update({ specs }).eq("id", d.id);
    setDs(ds.map((x) => (x.id === d.id ? { ...x, specs } : x)));
  }
  const startEdit = (b: Brand) => setEdit({ name: b.name, colors: colorsText(b.colors || []), light: b.rules?.light || "", dark: b.rules?.dark || "", one_light: b.rules?.one_light || "", one_dark: b.rules?.one_dark || "", tLight: (b.embroidery?.light || []).join(", "), tDark: (b.embroidery?.dark || []).join(", "), backing: b.embroidery?.backing || "", notes: b.notes || "" });

  return (
    <section className="panel cb">
      <div className="panel-h"><h2>Brands</h2><span className="faint">{brands.length ? "Each brand's rules and logos; each department's files of a logo." : "For a customer who manages logos for several companies (a distributor)."}</span>
        <span className="spacer" />
        <span className="cb-add"><input type="text" value={adding} placeholder="New brand name" aria-label="New brand name" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addBrand(); }} /><button type="button" className="btn sm" disabled={!adding.trim() || busy === "brand"} onClick={() => void addBrand()}>Add brand</button></span>
      </div>
      {brands.length > 0 && brand && (
        <div className="panel-b">
          <div className="toolbar" data-toolbar>
            <div className="chips" role="group" aria-label="Brand">
              {brands.map((b) => <button key={b.id} type="button" className={"chip" + (brand.id === b.id ? " on" : "")} onClick={() => { setSel(b.id); setEdit(null); }}>{b.name}<span className="chip-n">{ds.filter((d) => d.brand_id === b.id).length}</span></button>)}
            </div>
            {!embroideryOnly && <div className="chips" role="group" aria-label="Department">
              {LANES.map((l) => <button key={l.id} type="button" className={"chip" + (lane === l.id ? " on" : "")} onClick={() => setLane(l.id)}>{l.label}</button>)}
            </div>}
          </div>

          {/* the brand standard: what goes on an order */}
          {!edit ? (
            <div className="cb-std">
              <div className="cb-colors">{(brand.colors || []).map((c) => <span key={c.name} className="cb-sw" title={[c.pms, c.hex, c.thread].filter(Boolean).join(" · ")}><i style={{ background: c.hex }} />{c.name}{c.pms ? <small>{c.pms}</small> : c.thread ? <small>{c.thread}</small> : null}</span>)}
                {!(brand.colors || []).length && <span className="faint">No colors yet.</span>}</div>
              <dl className="cb-rules">
                {lane !== "embroidery" && <><dt>Light goods</dt><dd>{brand.rules?.light || "—"}</dd><dt>Dark goods</dt><dd>{brand.rules?.dark || "—"}</dd>{(brand.rules?.one_light || brand.rules?.one_dark) && <><dt>One color</dt><dd>{[brand.rules.one_light, brand.rules.one_dark].filter(Boolean).join(" / ")}</dd></>}</>}
                {lane === "embroidery" && <><dt>Threads, light goods</dt><dd>{brand.embroidery?.light?.join(", ") || "—"}</dd><dt>Threads, dark goods</dt><dd>{brand.embroidery?.dark?.join(", ") || "—"}</dd>{brand.embroidery?.backing && <><dt>Backing</dt><dd>{brand.embroidery.backing}</dd></>}</>}
              </dl>
              {brand.notes && <p className="cb-notes">{brand.notes}</p>}
              <button type="button" className="btn sm ghost" onClick={() => startEdit(brand)}>Edit brand</button>
            </div>
          ) : (
            <div className="cb-edit">
              <div className="field"><label htmlFor="cb-n">Name</label><input id="cb-n" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
              <div className="field cb-wide"><label htmlFor="cb-c">Colors, one a line: name | PMS | #hex | thread</label><textarea id="cb-c" rows={4} value={edit.colors} placeholder={"Maroon | PMS 492 C | #8B2E35\nOff White | PMS Warm Gray 1 C | #FAF6EC"} onChange={(e) => setEdit({ ...edit, colors: e.target.value })} /></div>
              <div className="field"><label htmlFor="cb-l">Light goods get</label><input id="cb-l" value={edit.light} placeholder="Maroon / Black" onChange={(e) => setEdit({ ...edit, light: e.target.value })} /></div>
              <div className="field"><label htmlFor="cb-d">Dark goods get</label><input id="cb-d" value={edit.dark} placeholder="Maroon / Off White" onChange={(e) => setEdit({ ...edit, dark: e.target.value })} /></div>
              <div className="field"><label htmlFor="cb-ol">One color, light goods</label><input id="cb-ol" value={edit.one_light} placeholder="All Black" onChange={(e) => setEdit({ ...edit, one_light: e.target.value })} /></div>
              <div className="field"><label htmlFor="cb-od">One color, dark goods</label><input id="cb-od" value={edit.one_dark} placeholder="All White" onChange={(e) => setEdit({ ...edit, one_dark: e.target.value })} /></div>
              <div className="field"><label htmlFor="cb-tl">Threads, light goods</label><input id="cb-tl" value={edit.tLight} placeholder="Madeira 1743 Oxford Blue" onChange={(e) => setEdit({ ...edit, tLight: e.target.value })} /></div>
              <div className="field"><label htmlFor="cb-td">Threads, dark goods</label><input id="cb-td" value={edit.tDark} placeholder="Madeira 1801 Super White" onChange={(e) => setEdit({ ...edit, tDark: e.target.value })} /></div>
              <div className="field"><label htmlFor="cb-bk">Backing</label><input id="cb-bk" value={edit.backing} onChange={(e) => setEdit({ ...edit, backing: e.target.value })} /></div>
              <div className="field cb-wide"><label htmlFor="cb-no">Notes</label><textarea id="cb-no" rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></div>
              <div className="cb-acts"><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy === "save"} onClick={() => void saveBrand()}>{busy === "save" ? "Saving…" : "Save brand"}</button></div>
            </div>
          )}

          {/* the brand's logos, as this department sees them */}
          {logos.length ? (
            <div className="tbl-wrap"><table className="tbl cb-tbl">
              <thead><tr><th /><th>Logo</th><th>{LANES.find((l) => l.id === lane)?.label}</th><th /></tr></thead>
              <tbody>{logos.map((d) => { const st = laneState(d, lane); const sews = sewFilesOf(d); const cws = colorwaysOf(d); return (
                <tr key={d.id}>
                  <td className="cb-pic">{(cws[0]?.preview && pics[cws[0].preview]) || (d.preview_path && pics[d.preview_path]) ? <LogoThumb d={d} url={(cws[0]?.preview && pics[cws[0].preview]) || pics[d.preview_path]} /> : null}</td>
                  <td><Link href={`/shop/artwork/${d.id}`} className="ordno">D-{d.number}</Link><div className="sub">{d.name}</div></td>
                  <td>
                    <span className={"ba-st" + (st.ready ? " ok" : " need")}>{st.note}</span>
                    {lane === "embroidery" && sews.length > 0 && <div className="cb-sews">{sews.map((f, i) => (
                      <span key={i} className="cb-sew"><a href={open(f.path)} target="_blank" rel="noreferrer" data-notranslate>{f.name || f.code}</a> {f.wIn}" × {f.hIn}" · {f.stitches.toLocaleString()} st{f.placement ? ` · ${f.placement}` : ""}
                        <select aria-label="Kind of goods" value={f.kind || "flat"} onChange={(e) => void setSewKind(d, i, e.target.value as SewKind)}>{Object.entries(SEW_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                        {f.emb && <a href={open(f.emb.path)} target="_blank" rel="noreferrer">EMB</a>}{f.sheet && <a href={open(f.sheet.path)} target="_blank" rel="noreferrer">Worksheet</a>}</span>
                    ))}</div>}
                    {lane === "screen" && <div className="cb-sews">{cws.map((c) => <span key={c.name} className="cb-sew">{c.name}: {c.inks.join(", ")}</span>)}{st.ready && <a href={open(d.file_path)} target="_blank" rel="noreferrer">Vector file</a>}</div>}
                    {lane === "dtf" && st.ready && <div className="cb-sews"><a href={open(d.file_path)} target="_blank" rel="noreferrer">Print file</a></div>}
                  </td>
                  <td className="cb-row-acts">
                    {lane === "embroidery" && <label className={"btn sm" + (busy === "sew" + d.id ? " disabled" : "")} title={`Add a DST (with its EMB and worksheet, or the digitizer's zip). Named ${tajimaName(d.number, Number(nextSewCode(sews).slice(1)))} for the Tajima.`}>
                      {busy === "sew" + d.id ? "Adding…" : `Add sew file ${nextSewCode(sews)}`}<input type="file" hidden multiple accept=".dst,.emb,.pdf,.zip" onChange={(e) => { void addSew(d, e.target.files); e.target.value = ""; }} /></label>}
                    {!embroideryOnly && <select aria-label="Brand" value={d.brand_id || ""} onChange={(e) => void moveLogo(d, e.target.value || null)}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}<option value="">No brand</option></select>}
                  </td>
                </tr>
              ); })}</tbody>
            </table></div>
          ) : <p className="faint">No logos in {brand.name} yet.</p>}
          {lane === "embroidery" && logos.length > 0 && (
            <div className="cb-sewopts"><span className="faint">New sew files are for</span>
              <select aria-label="Kind of goods" value={kind} onChange={(e) => setKind(e.target.value as SewKind)}>{Object.entries(SEW_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input type="text" aria-label="Placement" value={place} placeholder="Left chest" onChange={(e) => setPlace(e.target.value)} /></div>
          )}
          {!embroideryOnly && loose.length > 0 && (
            <div className="cb-loose"><span className="faint">Add one of their logos to {brand.name}:</span>
              <select aria-label={`Add a logo to ${brand.name}`} value="" onChange={(e) => { const d = loose.find((x) => x.id === e.target.value); if (d) void moveLogo(d, brand.id); }}>
                <option value="">Pick a logo…</option>{loose.map((d) => <option key={d.id} value={d.id}>D-{d.number} {d.name}</option>)}</select></div>
          )}
          {err && <p className="err">{err}</p>}
        </div>
      )}
      {!brands.length && err && <div className="panel-b"><p className="err">{err}</p></div>}
    </section>
  );
}
