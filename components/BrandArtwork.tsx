"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSticky } from "@/lib/useSticky";
import { fitLocation, locationsFor, type Design, type Group, type Imprint } from "@/lib/pricing";
import { brandPrint, colorwayFor, colorwaysOf, isDarkGarment, LANES, laneState, SEW_KINDS, sewFilesOf, sewForPrint, sewKindOf, sewThreads, type Brand, type Lane } from "@/lib/brands";

/**
 * Customer artwork → their brands (Oct 27, Nick: Cedar Promos' MEI, ShipStation / WWEX, Embark: "select, group it and
 * say, hey, add logo… search it… it just needs to be easy"; option A with the method toggle). The method picks the lane:
 * each logo shows what that department has of it (sew files, vector and colorways, a print file). Picking one fills the
 * print: the spot, the size (a sew file's own size), the colorway / threads by the brand's rule for light and dark
 * goods, and for embroidery the sew file (digitized; Needs digitizing when there is none). No mockup needed.
 * A logo is one record every department shares: screen print can grab a logo that only has sew files so far.
 */
type Props = { customerId: string; group: Group; brands: Brand[]; onAdd: (im: Imprint, label: string) => Promise<void> | void;
  /** their saved mockups and old jobs (Customer artwork's other view), as a card on the first screen */ onMockups?: () => void };
const OTHER = "other", ALL = "all";
const SIZE_GUESS: Record<string, string> = { "Left Chest": '3.5" wide', "Right Chest": '3.5" wide', "Full Front": '11" wide', "Full Back": '11" wide', "Left Sleeve": '3" wide', "Right Sleeve": '3" wide', "Upper Back (Yoke)": '10" wide' };

export default function BrandArtwork({ customerId, group, brands, onAdd, onMockups }: Props) {
  const sb = useMemo(() => createClient(), []);
  const used = group.imprints.find((x) => x.method)?.method as Lane | undefined;
  const [laneSaved, setLaneSaved] = useSticky<Lane>("custart.lane", "embroidery");
  const [laneHere, setLaneHere] = useState<Lane | null>(used || null);
  const lane = laneHere || laneSaved;
  const setLane = (l: Lane) => { setLaneHere(l); setLaneSaved(l); };
  // the brand first, then its logos (Oct 27, Nick: "click the brand first… you go Peter, and then… MEI, ShipStation, then
  // go into there" → option 3). null = the brands; a pop-up's place isn't remembered
  const [tab, setTab] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [ds, setDs] = useState<Design[] | null>(null);
  const [pics, setPics] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<Design | null>(null);
  // long sleeves list their upper arms and cuffs; Left / Right Sleeve stay pickable too (Oct 27, Nick)
  const locs = (() => { const l = locationsFor(group.lines); return l.includes("Left Upper Arm") ? [...l, "Left Sleeve", "Right Sleeve"] : l; })();
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
  // one thread (or colorway) for the print, picked here from the brand's two; a color change is made on the order after,
  // with its Color change button (Oct 27, Nick: "just add location and thread… drop down between their two brand
  // standards… then you should click a button that says color change")
  const dark = lines.length > 0 && lines.every((l) => isDarkGarment(l));
  const [side, setSide] = useState<"light" | "dark">("light");
  const others = (ds || []).filter((d) => !bOf(d));
  // a search looks through all of their logos (and brand names); else the brand picked
  const shown = (ds || []).filter((d) => (t ? `d-${d.number} ${d.number} ${d.name} ${brandById(bOf(d))?.name || ""}`.toLowerCase().includes(t) : tab === ALL || (tab === OTHER ? !bOf(d) : bOf(d) === tab)));
  // a brand's logos first in the lane they're ready in
  const sorted = [...shown].sort((a, b) => Number(laneState(b, lane).ready) - Number(laneState(a, lane).ready));
  const picOf = (d: Design) => { const cw = colorwayFor(d, brandById(bOf(d)), dark); return (cw?.preview && pics[cw.preview]) || (d.preview_path && pics[d.preview_path]) || ""; };

  // picking a logo: its sew file for these goods, its colorway by the brand's rule, a size to start from
  const kind = sewKindOf(group.lines);
  useEffect(() => {
    if (!pick) return;
    const fs = sewFilesOf(pick), best = sewForPrint(pick, brandById(bOf(pick)), dark, kind);
    setSewIx(Math.max(0, best ? fs.indexOf(best) : 0));
    setCwName(colorwayFor(pick, brandById(bOf(pick)), dark)?.name || "");
    setSide(dark ? "dark" : "light");
    setSize(lane === "embroidery" ? "" : SIZE_GUESS[loc] || "");
    setErr("");
  }, [pick?.id, lane]); // eslint-disable-line react-hooks/exhaustive-deps

  const brand = pick ? brandById(bOf(pick)) : null;
  const sews = pick ? sewFilesOf(pick) : [];
  const sew = lane === "embroidery" ? sews[sewIx] || null : null;
  const cws = pick ? colorwaysOf(pick) : [];
  const threads = (side: "light" | "dark") => (sewThreads(sew, side).length ? sewThreads(sew, side) : brand?.embroidery[side] || []);

  async function add() {
    if (!pick) return;
    setBusy(true); setErr("");
    try {
      const im = brandPrint({ design: pick, brand, method: lane, location: loc, lines: group.lines, size: size.trim(), sew, colorway: cws.find((c) => c.name === cwName) || null, darkOf: () => (lane === "embroidery" ? side === "dark" : false) });
      await onAdd(im, `D-${pick.number} ${pick.name}${brand ? ` (${brand.name})` : ""}`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't add it."); setBusy(false); }
  }

  const cover = (list: Design[]) => list.map((d) => picOf(d)).find(Boolean) || "";
  const ruleOf = (b: Brand) => {
    const r = b.rules, e = b.embroidery;
    return (lane === "embroidery" && (e.light?.length || e.dark?.length) ? [e.light?.length ? `Light goods: ${e.light.join(", ")}` : "", e.dark?.length ? `Dark goods: ${e.dark.join(", ")}` : ""]
      : [r.light ? `Light goods: ${r.light}` : "", r.dark ? `Dark goods: ${r.dark}` : "", r.one_light || r.one_dark ? `One color: ${[r.one_light, r.one_dark].filter(Boolean).join(" / ")}` : ""]).filter(Boolean).join(" · ");
  };
  const open = (id: string) => { setTab(id); setPick(null); };
  const cur = tab && tab !== ALL && tab !== OTHER ? brandById(tab) : null;

  return (
    <div className="ba">
      <input type="search" className="ba-q" placeholder={brands.length ? "Find a logo: name, brand or D-number" : "Find a logo: name or D-number"} value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} aria-label="Find a logo" />
      {!t && tab === null ? (
        // the first screen: their brands as cards, then their other logos, mockups and old jobs
        ds === null ? <p className="faint">Loading their brands…</p> : (
          <div className="ba-brands">
            {brands.map((b) => { const list = (ds || []).filter((d) => bOf(d) === b.id), u = cover(list), cw = list.reduce((n, d) => n + colorwaysOf(d).length, 0), sw = list.reduce((n, d) => n + sewFilesOf(d).length, 0); return (
              <button key={b.id} type="button" className="ba-bc" onClick={() => open(b.id)}>
                <span className={"ba-bc-pic" + (dark ? " dark" : "")}>{u ? <img src={u} alt="" /> : <span>{b.name.slice(0, 2).toUpperCase()}</span>}</span>
                <span className="ba-bc-t"><b>{b.name}</b><span>{list.length ? `${list.length} logo${list.length === 1 ? "" : "s"}` : "No logos yet"}{cw ? ` · ${cw} colorways` : ""}{sw ? ` · ${sw} sew file${sw === 1 ? "" : "s"}` : ""}</span></span>
              </button>
            ); })}
            {others.length > 0 && (
              <button type="button" className="ba-bc" onClick={() => open(OTHER)}>
                <span className={"ba-bc-pic" + (dark ? " dark" : "")}>{cover(others) ? <img src={cover(others)} alt="" /> : <span>···</span>}</span>
                <span className="ba-bc-t"><b>{brands.length ? "Other logos" : "Their logos"}</b><span>{others.length} logo{others.length === 1 ? "" : "s"}{brands.length ? ", no brand" : ""}</span></span>
              </button>
            )}
            {onMockups && (
              <button type="button" className="ba-bc" onClick={onMockups}>
                <span className="ba-bc-pic ic"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8.5 4 3 7l2.2 4 2.8-1.2V20h8V9.8l2.8 1.2L21 7l-5.5-3c-.8 1.6-2 2.5-3.5 2.5S9.3 5.6 8.5 4z" /></svg></span>
                <span className="ba-bc-t"><b>Mockups and old jobs</b><span>A mockup from another order, or an old job&apos;s files</span></span>
              </button>
            )}
          </div>
        )
      ) : (
        <>
          {!t && (
            <div className="ba-crumb">
              <button type="button" className="linkbtn" onClick={() => { setTab(null); setPick(null); }}>{brands.length ? "← All brands" : "← Back"}</button>
              <b>{cur ? cur.name : tab === OTHER ? (brands.length ? "Other logos" : "Their logos") : "All logos"}</b>
              {cur && ruleOf(cur) && <span className="faint">{ruleOf(cur)}</span>}
            </div>
          )}
          {ds === null ? <p className="faint">Loading their logos…</p> : !sorted.length ? <p className="faint">{q ? "Nothing matches." : tab === ALL ? "No logos on their account yet." : "No logos in this brand yet. Add them on the customer's Artwork page."}</p> : (
            <div className="ca-grid">
              {sorted.map((d) => { const st = laneState(d, lane); const u = picOf(d); return (
                <button key={d.id} type="button" className={"ca-card" + (pick?.id === d.id ? " on" : "")} onClick={() => setPick(d)}>
                  <span className={"ca-pic logo" + (dark ? " dark" : "")}>{u ? <img src={u} alt="" /> : null}</span>
                  <b>{d.name || "Logo"}</b>
                  <span className="faint">D-{d.number}{(t || tab === ALL) && bOf(d) ? ` · ${brandById(bOf(d))?.name || ""}` : ""}</span>
                  <span className={"ba-st" + (st.ready ? " ok" : " need")}>{st.note}</span>
                </button>
              ); })}
            </div>
          )}
        </>
      )}
      {pick && (
        <div className="ca-use">
          <div className="ba-addh">
            <b>Add D-{pick.number} {pick.name}</b>
            {/* how it's decorated: picks the department's files (sew file, colorways) */}
            <span className="ba-seg" role="group" aria-label="How it's decorated">
              {LANES.map((l) => <button key={l.id} type="button" className={lane === l.id ? "on" : ""} aria-pressed={lane === l.id} onClick={() => setLane(l.id)}>{l.label}</button>)}
            </span>
          </div>
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
              (() => { const opts = (["light", "dark"] as const).filter((k) => threads(k).length).filter((k, i, a) => i === 0 || threads(k).join() !== threads(a[0]).join());
                return opts.length ? (
                  <div className="field"><label htmlFor="ba-th">Thread</label>
                    <select id="ba-th" value={opts.includes(side) ? side : opts[0]} onChange={(e) => setSide(e.target.value as "light" | "dark")}>{opts.map((k) => <option key={k} value={k}>{threads(k).join(", ")}</option>)}</select></div>
                ) : <div className="field"><label>Thread</label><div className="ba-val">{pick.inks || "Not set for this brand"}</div></div>; })()
            ) : (
              <div className="field"><label htmlFor="ba-cw">Colorway</label>
                {cws.length ? <select id="ba-cw" value={cwName} onChange={(e) => setCwName(e.target.value)}>{cws.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.inks.join(", ")})</option>)}</select>
                  : <div className="ba-val">{pick.inks || "As the art"}</div>}
              </div>
            )}
          </div>
          <span className="faint">Garments that take another {lane === "embroidery" ? "thread" : "color"}: add a color change on the print after.</span>
          {lane === "embroidery" && !sews.length && <span className="ca-warn">No sew file for this logo yet: it goes on stamped Needs digitizing (stitches and price confirmed after the sew-out).</span>}
          {lane === "screen" && !laneState(pick, "screen").ready && <span className="ca-warn">No vector art for screen printing yet: it goes on as the art on file, for separations.</span>}
          {err && <span className="err">{err}</span>}
          <div className="cba-acts"><button type="button" className="btn primary" disabled={busy} onClick={() => void add()}>{busy ? "Adding…" : "Add to group"}</button></div>
        </div>
      )}
    </div>
  );
}
