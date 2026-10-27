"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { fitLocation, locationsFor, type Design, type Group, type Imprint } from "@/lib/pricing";
import { brandPrint, colorwayFor, colorwaysOf, isDarkGarment, LANES, laneState, pickSewFile, SEW_KINDS, sewFilesOf, sewKindOf, type Brand, type Lane } from "@/lib/brands";

/**
 * Customer artwork → their brands (Oct 27, Nick: Cedar Promos' MEI, ShipStation / WWEX, Embark: "select, group it and
 * say, hey, add logo… search it… it just needs to be easy"; option A with the method toggle). The method picks the lane:
 * each logo shows what that department has of it (sew files, vector and colorways, a print file). Picking one fills the
 * print: the spot, the size (a sew file's own size), the colorway / threads by the brand's rule for light and dark
 * goods, and for embroidery the sew file (digitized; Needs digitizing when there is none). No mockup needed.
 * A logo is one record every department shares: screen print can grab a logo that only has sew files so far.
 */
type Props = { customerId: string; group: Group; brands: Brand[]; onAdd: (im: Imprint, label: string) => Promise<void> | void };
const OTHER = "other", ALL = "all";
const SIZE_GUESS: Record<string, string> = { "Left Chest": '3.5" wide', "Right Chest": '3.5" wide', "Full Front": '11" wide', "Full Back": '11" wide', "Left Sleeve": '3" wide', "Right Sleeve": '3" wide', "Upper Back (Yoke)": '10" wide' };

export default function BrandArtwork({ customerId, group, brands, onAdd }: Props) {
  const sb = useMemo(() => createClient(), []);
  const used = group.imprints.find((x) => x.method)?.method as Lane | undefined;
  const [laneSaved, setLaneSaved] = useSticky<Lane>("custart.lane", "embroidery");
  const [laneHere, setLaneHere] = useState<Lane | null>(used || null);
  const lane = laneHere || laneSaved;
  const setLane = (l: Lane) => { setLaneHere(l); setLaneSaved(l); };
  const [tabSaved, setTab] = useSticky<string>(`custart.brand.${customerId}`, brands[0]?.id || ALL);
  // a remembered brand that's gone: their first brand
  const tab = tabSaved === ALL || tabSaved === OTHER || brands.some((b) => b.id === tabSaved) ? tabSaved : brands[0]?.id || ALL;
  const [q, setQ] = useState("");
  const [ds, setDs] = useState<Design[] | null>(null);
  const [pics, setPics] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<Design | null>(null);
  const locs = locationsFor(group.lines);
  const [loc, setLoc] = useState(fitLocation("Left Chest", group.lines));
  const [size, setSize] = useState(""), [sewIx, setSewIx] = useState(0), [cwName, setCwName] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await sb.from("designs").select("*").eq("customer_id", customerId).is("archived_at", null).eq("draft", false).order("number", { ascending: true }).limit(400);
      if (!live) return;
      const list = (data || []) as (Design & { brand_id?: string | null })[];
      setDs(list);
      const paths = [...new Set(list.flatMap((d) => [d.preview_path, ...colorwaysOf(d).map((c) => c.preview)]).filter(Boolean) as string[])].slice(0, 300);
      if (paths.length) { const { data: su } = await sb.storage.from("proofs").createSignedUrls(paths, 3600); if (live) setPics(Object.fromEntries(paths.map((p, i) => [p, su?.[i]?.signedUrl || ""]))); }
    })();
    return () => { live = false; };
  }, [sb, customerId]);

  const bOf = (d: Design) => ((d as Design & { brand_id?: string | null }).brand_id || null);
  const brandById = (id: string | null) => brands.find((b) => b.id === id) || null;
  const t = q.trim().toLowerCase();
  const lines = group.lines.filter((l) => (l.color || "").trim());
  // light or dark goods: read off the color's name, and a click flips one (a color we don't know reads as light)
  const ck = (c: string) => c.trim().toLowerCase();
  const [flip, setFlip] = useState<Record<string, boolean>>({});
  const darkOf = (c: string) => (ck(c) in flip ? flip[ck(c)] : isDarkGarment({ color: c }));
  const colors = [...new Map(lines.map((l) => [ck(l.color), l.color.trim()])).values()];
  const dark = lines.length > 0 && lines.every((l) => darkOf(l.color));
  const mixed = lines.some((l) => darkOf(l.color)) && !dark;
  const others = (ds || []).filter((d) => !bOf(d));
  const shown = (ds || []).filter((d) => (tab === ALL || (tab === OTHER ? !bOf(d) : bOf(d) === tab)) && (!t || `d-${d.number} ${d.number} ${d.name}`.toLowerCase().includes(t)));
  // a brand's logos first in the lane they're ready in
  const sorted = [...shown].sort((a, b) => Number(laneState(b, lane).ready) - Number(laneState(a, lane).ready));
  const picOf = (d: Design) => { const cw = colorwayFor(d, brandById(bOf(d)), dark); return (cw?.preview && pics[cw.preview]) || (d.preview_path && pics[d.preview_path]) || ""; };

  // picking a logo: its sew file for these goods, its colorway by the brand's rule, a size to start from
  const kind = sewKindOf(group.lines);
  useEffect(() => {
    if (!pick) return;
    const fs = sewFilesOf(pick), best = pickSewFile(fs, kind);
    setSewIx(Math.max(0, best ? fs.indexOf(best) : 0));
    setCwName(colorwayFor(pick, brandById(bOf(pick)), dark)?.name || "");
    setSize(lane === "embroidery" ? "" : SIZE_GUESS[loc] || "");
    setErr("");
  }, [pick?.id, lane]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (pick) setCwName(colorwayFor(pick, brandById(bOf(pick)), dark)?.name || ""); }, [dark]); // eslint-disable-line react-hooks/exhaustive-deps
  const brand = pick ? brandById(bOf(pick)) : null;
  const sews = pick ? sewFilesOf(pick) : [];
  const sew = lane === "embroidery" ? sews[sewIx] || null : null;
  const cws = pick ? colorwaysOf(pick) : [];
  const threads = (side: "light" | "dark") => (sew?.threads?.[side]?.length ? sew.threads[side]! : brand?.embroidery[side] || []);

  async function add() {
    if (!pick) return;
    setBusy(true); setErr("");
    try {
      const im = brandPrint({ design: pick, brand, method: lane, location: loc, lines: group.lines, size: size.trim(), sew, colorway: cws.find((c) => c.name === cwName) || null, darkOf });
      await onAdd(im, `D-${pick.number} ${pick.name}${brand ? ` (${brand.name})` : ""}`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't add it."); setBusy(false); }
  }

  return (
    <div className="ba">
      {/* the method picks the lane: each department sees its own files first */}
      <div className="toolbar ba-lane" data-toolbar>
        <div className="chips" role="group" aria-label="How it's decorated">
          {LANES.map((l) => <button key={l.id} type="button" className={"chip" + (lane === l.id ? " on" : "")} aria-pressed={lane === l.id} onClick={() => setLane(l.id)}>{l.label}</button>)}
        </div>
      </div>
      <div className="toolbar" data-toolbar>
        <div className="chips" role="group" aria-label="Brand">
          {brands.map((b) => { const n = (ds || []).filter((d) => bOf(d) === b.id).length; return <button key={b.id} type="button" className={"chip" + (tab === b.id ? " on" : "")} onClick={() => { setTab(b.id); setPick(null); }}>{b.name}{ds ? <span className="chip-n">{n}</span> : null}</button>; })}
          {others.length > 0 && <button type="button" className={"chip" + (tab === OTHER ? " on" : "")} onClick={() => { setTab(OTHER); setPick(null); }}>Other<span className="chip-n">{others.length}</span></button>}
          <button type="button" className={"chip" + (tab === ALL ? " on" : "")} onClick={() => { setTab(ALL); setPick(null); }}>All</button>
        </div>
        <input type="search" className="ca-q" placeholder="Find: name or D-number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a logo" />
      </div>
      {(() => { const b = brandById(tab); if (!b) return null; const r = b.rules; const e = b.embroidery;
        const rule = lane === "embroidery" ? [e.light?.length ? `Light goods: ${e.light.join(", ")}` : "", e.dark?.length ? `Dark goods: ${e.dark.join(", ")}` : ""] : [r.light ? `Light goods: ${r.light}` : "", r.dark ? `Dark goods: ${r.dark}` : "", r.one_light || r.one_dark ? `One color: ${[r.one_light, r.one_dark].filter(Boolean).join(" / ")}` : ""];
        return rule.some(Boolean) ? <p className="ba-rule"><b>{b.name} rule</b> {rule.filter(Boolean).join(" · ")}</p> : null; })()}
      {ds === null ? <p className="faint">Loading their logos…</p> : !sorted.length ? <p className="faint">{q ? "Nothing matches." : tab === ALL ? "No logos on their account yet." : "No logos in this brand yet. Add them on the customer's Artwork page."}</p> : (
        <div className="ca-grid">
          {sorted.map((d) => { const st = laneState(d, lane); const u = picOf(d); return (
            <button key={d.id} type="button" className={"ca-card" + (pick?.id === d.id ? " on" : "")} onClick={() => setPick(d)}>
              <span className={"ca-pic logo" + (dark ? " dark" : "")}>{u ? <img src={u} alt="" /> : null}</span>
              <b>{d.name || "Logo"}</b>
              <span className="faint">D-{d.number}{tab === ALL && bOf(d) ? ` · ${brandById(bOf(d))?.name || ""}` : ""}</span>
              <span className={"ba-st" + (st.ready ? " ok" : " need")}>{st.note}</span>
            </button>
          ); })}
        </div>
      )}
      {pick && (
        <div className="ca-use">
          <b>Add D-{pick.number} {pick.name} as {LANES.find((l) => l.id === lane)?.label.toLowerCase()}</b>
          <div className="ba-row">
            <div className="field"><label htmlFor="ba-loc">Location</label>
              <select id="ba-loc" value={loc} onChange={(e) => { setLoc(e.target.value); if (lane !== "embroidery" && (!size || Object.values(SIZE_GUESS).includes(size))) setSize(SIZE_GUESS[e.target.value] || ""); }}>
                {[...new Set([...locs, loc])].map((l) => <option key={l}>{l}</option>)}
              </select></div>
            {lane === "embroidery" && sews.length > 0 ? (
              <div className="field"><label htmlFor="ba-sew">Size (sew file)</label>
                <select id="ba-sew" value={sewIx} onChange={(e) => setSewIx(Number(e.target.value))}>
                  {sews.map((f, i) => <option key={i} value={i}>{[f.code || `File ${i + 1}`, `${f.wIn}" × ${f.hIn}"`, SEW_KINDS[f.kind || "flat"], `${f.stitches.toLocaleString()} st`].join(" · ")}</option>)}
                </select></div>
            ) : (
              <div className="field"><label htmlFor="ba-size">Size</label><input id="ba-size" type="text" value={size} placeholder={'3.5" wide'} onChange={(e) => setSize(e.target.value)} /></div>
            )}
            {lane === "embroidery" ? (
              <div className="field ba-ro"><label>Threads</label><div className="ba-val" title={mixed ? `Dark goods: ${threads("dark").join(", ")}` : undefined}>{(dark ? threads("dark") : threads("light")).join(", ") || "Not set for this brand"}</div></div>
            ) : (
              <div className="field"><label htmlFor="ba-cw">Colorway</label>
                {cws.length ? <select id="ba-cw" value={cwName} onChange={(e) => setCwName(e.target.value)}>{cws.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.inks.join(", ")})</option>)}</select>
                  : <div className="ba-val">{pick.inks || "As the art"}</div>}
              </div>
            )}
          </div>
          {colors.length > 0 && (
            <div className="ba-goods"><span className="faint">Goods (click to switch):</span>
              {colors.map((c) => <button key={c} type="button" className={"ba-g" + (darkOf(c) ? " dk" : "")} title={darkOf(c) ? "Dark goods: gets the dark version. Click if it's light." : "Light goods: gets the light version. Click if it's dark."} onClick={() => setFlip((f) => ({ ...f, [ck(c)]: !darkOf(c) }))}>{c}<small>{darkOf(c) ? "dark" : "light"}</small></button>)}
            </div>
          )}
          {mixed && (() => {
            const other = lane === "embroidery" ? threads("dark").join(", ") : colorwayFor(pick, brand, true)?.name;
            return other ? <span className="faint">This group has light and dark goods: the dark ones ({[...new Set(lines.filter((l) => darkOf(l.color)).map((l) => l.color))].join(", ")}) get {other}.</span> : null;
          })()}
          {lane === "embroidery" && !sews.length && <span className="ca-warn">No sew file for this logo yet: it goes on stamped Needs digitizing (stitches and price confirmed after the sew-out).</span>}
          {lane === "screen" && !laneState(pick, "screen").ready && <span className="ca-warn">No vector art for screen printing yet: it goes on as the art on file, for separations.</span>}
          {err && <span className="err">{err}</span>}
          <div className="ca-acts"><button type="button" className="btn primary" disabled={busy} onClick={() => void add()}>{busy ? "Adding…" : "Add to group"}</button></div>
        </div>
      )}
    </div>
  );
}
