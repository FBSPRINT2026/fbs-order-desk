"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LOCATIONS, METHODS, designLabel, newImprint, orderGroups, uid, type Customer, type Design, type Garment, type Imprint, type Method, type Order } from "@/lib/pricing";
import { custLabel } from "@/lib/format";
import { previewUrls, uploadDesign } from "@/lib/designs";
import { logoUploadUrl, mockupUploadUrls, myLogos, portalCatalog, saveMyLogo, saveMyMockup } from "@/app/portal/request-actions";
import { starMyDesign } from "@/app/portal/actions";
import { PREVIEWABLE_TYPES } from "@/lib/pricing";
import DesignSearch from "@/components/DesignSearch";
import { PMS_HEX, WILFLEX_HEX, closestInk, closestPms, colorHex, detectColors, recolor } from "@/lib/inkColors";
import { PHOTO_H, PHOTO_W, PX_PER_IN, basePlacement, maxWidthFor, viewsFor, biggerSpot, guessHex, measureGarment, printWidth, smallerSpot, spotFor, type Fit, ssImg, teeSvg, type View } from "@/lib/mockup";

type Line = { id: string; style: string; brand: string; color: string; garment: string };
type Offset = { dx: number; dy: number };
/** Per imprint: colors found in the logo and the ink each one prints as. */
type Side = "front" | "back" | "sleeve";
const SIDES: { id: Side; label: string }[] = [{ id: "front", label: "Front" }, { id: "back", label: "Back" }, { id: "sleeve", label: "Sleeves" }];
type Paint = { design: string; sources: { hex: string; share: number }[]; map: Record<string, { name: string; hex: string }>;
  /** several logo colors set to the same ink: true = print them as one color (one screen), false = keep separate */ unite?: boolean };
/** Ink names for the imprint from the logo's color choices (same ink twice counts once when the colors are united). */
const inkNames = (pt: Paint, map = pt.map) => {
  const names = pt.sources.map((x) => map[x.hex]).filter((x) => x && x.name !== "none").map((x) => x!.name);
  return pt.unite === false ? names : [...new Set(names)];
};
/** Rows to show for a logo's colors: united colors that share an ink sit on one row. */
const colorRows = (pt: Paint) => {
  const rows: { hexes: string[]; cur?: { name: string; hex: string } }[] = [];
  for (const x of pt.sources) {
    const cur = pt.map[x.hex];
    const row = pt.unite && cur && cur.name !== "none" ? rows.find((r) => r.cur?.name === cur.name) : undefined;
    if (row) row.hexes.push(x.hex); else rows.push({ hexes: [x.hex], cur });
  }
  return rows;
};
/** Inks that more than one logo color is set to. */
const sharedInks = (pt?: Paint) => { if (!pt) return []; const n = pt.sources.map((x) => pt.map[x.hex]?.name).filter((x) => x && x !== "none") as string[]; return [...new Set(n.filter((x, i) => n.indexOf(x) !== i))]; };


function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("Couldn't load " + src.slice(0, 60)));
    im.src = src;
  });
}

/** Mockup builder: garment photos from S&S for each color, the customer's designs placed by location and print size. */
/** portal = the customer's own builder: their account only, no order, saved through the portal's server actions. */
export default function MockupBuilder({ portal = false, backHref }: { portal?: boolean; backHref?: string }) {
  const sp = useSearchParams();
  const orderId = portal ? "" : sp.get("order") || "";
  const groupId = sp.get("group") || "";
  const sb = useMemo(() => createClient(), []);

  const [order, setOrder] = useState<Order | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState(sp.get("customer") || "");
  const [catalog, setCatalog] = useState<Garment[]>([]);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Line[]>([{ id: uid(), style: "", brand: "", color: "", garment: "" }]);
  const [imprints, setImprints] = useState<Imprint[]>([]);
  const [groupName, setGroupName] = useState("");
  const [active, setActive] = useState(0);
  const [offsets, setOffsets] = useState<Record<string, Offset>>({});
  const [paints, setPaints] = useState<Record<string, Paint>>({});
  const [grid, setGrid] = useState(false);
  const [tab, setTab] = useState<"" | Side>("");
  // close-ups fill the column between the photos and the Imprints panel
  const cuRef = useRef<HTMLDivElement>(null);
  const [cuSize, setCuSize] = useState(230);
  useEffect(() => {
    const el = cuRef.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      // two across, each exactly as wide as the front / back photo above it
      setCuSize(Math.max(120, Math.floor((el.clientWidth - 14) / 2)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
  const [want, setWant] = useState<Record<string, number>>({}); // width (in) someone tried to drag past the location's max
  const [askUploaded, setAskUploaded] = useState(false);
  const [keepLoc, setKeepLoc] = useState<string[]>([]); // imprints where staff said "keep this location"
  const [pop, setPop] = useState<{ id: string; src: string; x: number; y: number; open?: string } | null>(null);
  const [painted, setPainted] = useState<Record<string, string>>({});
  const imgCache = useRef(new Map<string, HTMLImageElement>());
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ title: string; url: string }[]>([]);
  const refreshed = useRef(new Set<number>());

  // load the order group (or start blank), catalog and customers
  useEffect(() => {
    (async () => {
      if (portal) {
        // the customer's own account; catalog comes without our costs
        const [cat, cu] = await Promise.all([portalCatalog(), sb.from("customers").select("*")]);
        setCatalog(cat as unknown as Garment[]);
        const mine = (cu.data || []) as Customer[];
        setCustomers(mine);
        if (mine[0]) setCustomerId(mine[0].id);
        return;
      }
      const [cat, cu] = await Promise.all([sb.from("garments").select("*"), sb.from("customers").select("*")]);
      setCatalog((cat.data || []) as Garment[]);
      setCustomers(((cu.data || []) as Customer[]).sort((a, b) => custLabel(a).localeCompare(custLabel(b))));
      if (orderId) {
        const { data } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
        if (!data) return setMsg("Order not found.");
        const o = data as Order;
        setOrder(o);
        setCustomerId(o.customer_id || "");
        const groups = orderGroups(o);
        const g = groups.find((x) => x.id === groupId) || groups[0];
        if (g) {
          setGroupName(g.name || `Group ${groups.indexOf(g) + 1}`);
          setLines(g.lines.filter((l) => l.style || l.color).map((l) => ({ id: l.id, style: l.style, brand: l.brand, color: l.color, garment: l.garment })));
          setImprints(g.imprints.map((d) => ({ ...d })));
        }
      }
    })();
  }, [sb, orderId, groupId, portal]);

  // the customer's designs
  useEffect(() => {
    (async () => {
      if (!customerId) { setDesigns([]); setUrls({}); return; }
      if (portal) {
        const r = await myLogos();
        if (r.ok) { setDesigns(r.designs as Design[]); setUrls(r.urls); } else setMsg(r.error);
        return;
      }
      const { data } = await sb.from("designs").select("*").eq("customer_id", customerId).order("number", { ascending: false });
      const list = (data || []) as Design[];
      setDesigns(list);
      setUrls(await previewUrls(sb, list));
    })();
  }, [sb, customerId, portal]);

  // find the colors in each imprint's logo when its design changes
  useEffect(() => {
    imprints.forEach(async (im) => {
      const d = designs.find((x) => x.id === im.design_id);
      if (!d || !urls[d.id]) return;
      if (paints[im.id]?.design === d.id) return;
      try {
        const img = imgCache.current.get(d.id) || (await loadImg(urls[d.id]));
        imgCache.current.set(d.id, img);
        const sources = detectColors(img);
        setPaints((p) => ({ ...p, [im.id]: { design: d.id, sources, map: {} } }));
      } catch { /* preview not loadable */ }
    });
  }, [imprints, designs, urls]);

  // repaint logos whenever an ink choice changes
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const im of imprints) {
      const pt = paints[im.id];
      if (!pt || !Object.keys(pt.map).length) continue;
      const img = imgCache.current.get(pt.design);
      if (!img) continue;
      const targets: Record<string, string> = {};
      Object.entries(pt.map).forEach(([src, v]) => { targets[src] = v.name === "none" ? "none" : v.hex; });
      next[im.id] = recolor(img, pt.sources.map((x) => x.hex), targets);
    }
    setPainted(next);
  }, [paints, imprints]);

  /** Set several logo colors at once (e.g. every color to its closest standard ink). */
  function setInks(id: string, picks: Record<string, { name: string; hex: string } | null>) {
    setPaints((p) => {
      const pt = p[id];
      if (!pt) return p;
      const map = { ...pt.map };
      for (const [k, v] of Object.entries(picks)) { if (v) map[k] = v; else delete map[k]; }
      const inks = inkNames(pt, map);
      setImprints((xs) => xs.map((x) => (x.id === id ? { ...x, inks: inks.length ? inks.join(", ") : x.inks, colors: inks.length && x.method !== "dtf" && x.colors < 11 ? inks.length : x.colors } : x)));
      return { ...p, [id]: { ...pt, map } };
    });
  }
  /** Answer "print these as one color?" for an imprint's logo. */
  const setUnite = (id: string, unite: boolean) => setPaints((p) => {
    const pt = p[id]; if (!pt) return p;
    const np = { ...pt, unite };
    const inks = inkNames(np);
    setImprints((xs) => xs.map((x) => (x.id === id ? { ...x, inks: inks.length ? inks.join(", ") : x.inks, colors: inks.length && x.method !== "dtf" && x.colors < 11 ? inks.length : x.colors } : x)));
    return { ...p, [id]: np };
  });
  /** Logo colors still printing "as uploaded" (no standard ink picked), per imprint. */
  const unsetColors = (im: Imprint) => { const pt = paints[im.id]; return pt && pt.design === im.design_id ? pt.sources.filter((x) => !pt.map[x.hex]).map((x) => x.hex) : []; };
  const matchStandard = (im: Imprint) => setInks(im.id, Object.fromEntries(unsetColors(im).map((h) => [h, closestInk(h)])));
  /** Grow a print; past the location's max it stops at the max and offers a bigger location. */
  const growTo = (im: Imprint, inches: number) => {
    const cap = maxWidthFor(im.location, ratioOf(designOf(im)));
    setWant((w) => { const n = { ...w }; if (inches > cap + 0.05) n[im.id] = inches; else delete n[im.id]; return n; });
    const v = Math.max(0.5, Math.min(cap, Math.round(inches * 100) / 100));
    setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, size: `${v}" wide` } : x)));
    return v;
  };

  function setInk(im: Imprint, src: string, v: { name: string; hex: string } | null) {
    setPaints((p) => {
      const pt = p[im.id];
      if (!pt) return p;
      const map = { ...pt.map };
      if (v) map[src] = v; else delete map[src];
      const np = { ...p, [im.id]: { ...pt, map } };
      // keep the imprint's ink list and color count in step with the choices
      const inks = inkNames(pt, map);
      setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, inks: inks.length ? inks.join(", ") : x.inks, colors: inks.length && x.method !== "dtf" && x.colors < 11 ? inks.length : x.colors } : x)));
      return np;
    });
  }
  const artUrl = (im: Imprint) => { const d = designs.find((x) => x.id === im.design_id); return painted[im.id] || (d ? urls[d.id] : ""); };

  const garmentFor = (l: Line) => catalog.find((g) => g.style.toLowerCase() === l.style.trim().toLowerCase() && (!l.brand || g.brand.toLowerCase() === l.brand.toLowerCase()))
    || catalog.find((g) => g.style.toLowerCase() === l.style.trim().toLowerCase());

  // styles pulled from S&S before photos were saved: refresh them once to get the color photos
  useEffect(() => {
    lines.forEach((l) => {
      const g = garmentFor(l);
      if (!g?.ss_style_id || refreshed.current.has(g.ss_style_id)) return;
      if (g.color_images && Object.keys(g.color_images).length) return;
      refreshed.current.add(g.ss_style_id);
      fetch(`/api/ss/lookup?styleid=${g.ss_style_id}`).then((r) => r.json()).then((j) => {
        if (j.garment) setCatalog((c) => c.map((x) => (x.id === j.garment.id ? j.garment : x)));
      }).catch(() => {});
    });
  }, [lines, catalog]);

  const photo = (l: Line, view: View) => {
    const g = garmentFor(l);
    const ci = g?.color_images?.[l.color] || Object.entries(g?.color_images || {}).find(([k]) => k.toLowerCase() === l.color.toLowerCase())?.[1];
    const p = ci ? (view === "front" ? ci.front : ci.back) : "";
    return p ? ssImg(p) : teeSvg(guessHex(l.color), view);
  };

  // Each S&S photo frames the shirt a little differently: measure the outline once per photo and place everything on it
  const [fits, setFits] = useState<Record<string, Fit | null>>({});
  const fitFor = (l: Line | undefined, v: View) => { if (!l) return null; const u = photo(l, v); return u.startsWith("data:") ? null : fits[u] || null; };
  useEffect(() => {
    for (const l of lines) for (const v of ["front", "back"] as View[]) {
      const u = photo(l, v);
      if (u.startsWith("data:") || u in fits) continue;
      setFits((f) => ({ ...f, [u]: null }));
      loadImg(u).then((img) => { const fit = measureGarment(img, v); setFits((f) => ({ ...f, [u]: fit })); }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, catalog]);

  const designOf = (im: Imprint) => designs.find((d) => d.id === im.design_id);
  /** The colors printed at a location: each logo color with the ink it's set to (or as uploaded), else the imprint's typed inks. */
  const inkList = (im: Imprint): { hex: string; name: string }[] => {
    const pt = paints[im.id];
    if (pt && pt.design === im.design_id && pt.sources.length) {
      return colorRows(pt).map((row) => row.cur || { name: "", hex: row.hexes[0] })
        .filter((t) => t.name !== "none")
        .map((t) => ({ hex: t.hex || "#888888", name: t.name || `As uploaded (${t.hex.toUpperCase()})` }));
    }
    return im.inks.split(",").map((z) => z.trim()).filter(Boolean).map((n) => ({ name: n, hex: colorHex(n) || "" }));
  };
  const ratioOf = (d?: Design) => (d?.width_px && d?.height_px ? d.height_px / d.width_px : 0);
  const place = (im: Imprint, view?: View, fit?: Fit | null) => {
    const d = designOf(im);
    const r = ratioOf(d) || 0.6;
    const wIn = printWidth(im.size, im.location, ratioOf(d));
    const drop = im.drop && !isNaN(+im.drop) ? +im.drop : null;
    const b = basePlacement(im.location, wIn, r, drop, scale, view, fit === undefined ? fitFor(line, view || viewsFor(im.location)[0]) : fit);
    // hand moves are stored in reference-photo pixels; scale them to this photo
    const o0 = offsets[im.id] || { dx: 0, dy: 0 }, o = { dx: o0.dx * b.k, dy: o0.dy * b.k };
    if (b.clip) {
      // sleeves: moves are along the sleeve (dx = across the fold, dy = toward the hem), turned to the sleeve's angle on each photo
      const a = (b.rot * Math.PI) / 180;
      return { ...b, x: b.x + o.dx * Math.cos(a) - o.dy * Math.sin(a), y: b.y + o.dx * Math.sin(a) + o.dy * Math.cos(a), wIn, hIn: wIn * r, d };
    }
    return { ...b, x: b.x + o.dx, y: b.y + o.dy, wIn, hIn: wIn * r, d };
  };
  // imprint tabs: front, back, sleeves
  const sideOf = (loc: string): Side => (viewsFor(loc).length > 1 ? "sleeve" : spotFor(loc).view);
  const curTab: Side = tab || (["front", "back", "sleeve"] as Side[]).find((t) => imprints.some((im) => sideOf(im.location) === t)) || "front";
  const locsFor = (t: Side) => LOCATIONS.filter((z) => sideOf(z) === t);
  const views: View[] = (["front", "back"] as View[]).filter((v) => imprints.some((im) => viewsFor(im.location).includes(v)));
  const line = lines[active] || lines[0];
  // designs are sized on a Large: adult L (22" chest) or youth L (18" chest) for youth styles
  const isYouthStyle = (l?: Line) => { const z = (l && garmentFor(l)?.sizes) || []; return z.includes("YL") && !z.includes("L"); };
  const scale = isYouthStyle(line) ? 22 / 18 : 1;
  const shirtHex = (l?: Line) => { if (!l) return "#9aa1ab"; const g = garmentFor(l); const ci = g?.color_images?.[l.color]; return (ci?.hex && /^#?[0-9a-f]{6}$/i.test(ci.hex) ? (ci.hex.startsWith("#") ? ci.hex : "#" + ci.hex) : "") || guessHex(l.color); };

  /** One close-up box for an imprint (used under the photos and, smaller, beside them for the selected tab). */
  const closeUp = (im: Imprint, size: number) => {
                const d = designOf(im); const r = ratioOf(d) || 0.6;
                const wIn = printWidth(im.size, im.location, ratioOf(d));
                const o = offsets[im.id] || { dx: 0, dy: 0 };
                const sp = spotFor(im.location);
                return (
                  <CloseUp key={im.id + size} size={size} title={im.location} hex={shirtHex(line)} url={artUrl(im)} wIn={wIn} hIn={wIn * r} colors={inkList(im)}
                    onPick={(rx, ry, x, y) => pickColor(im.id, rx, ry, x, y)}
                    maxW={sp.maxW} maxH={sp.maxH} topAlign={!!sp.top || !!(im.drop && !isNaN(+im.drop))} fold={viewsFor(im.location).length > 1} offIn={{ x: o.dx / (PX_PER_IN * scale), y: o.dy / (PX_PER_IN * scale) }}
                    onMove={(dxIn, dyIn) => setOffsets((q) => ({ ...q, [im.id]: { dx: (q[im.id]?.dx || 0) + dxIn * PX_PER_IN * scale, dy: (q[im.id]?.dy || 0) + dyIn * PX_PER_IN * scale } }))}
                    onResize={(newWIn) => { growTo(im, newWIn); }} />
                );
  };

  async function uploadNew(im: Imprint, f: File) {
    if (!customerId) return setMsg("Pick the customer first. New art is saved to their account.");
    try {
      let d: Design;
      if (portal) {
        // customers upload straight to storage with a one-time link, then the server records the logo
        const t = await logoUploadUrl(f.name);
        if (!t.ok || !t.path || !t.token) throw new Error(t.error || "Upload failed");
        const up = await sb.storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined });
        if (up.error) throw new Error(up.error.message);
        const pv = PREVIEWABLE_TYPES.test(f.type);
        const dims = pv ? await new Promise<{ w: number; h: number } | null>((res) => { const u0 = URL.createObjectURL(f); const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = u0; }) : null;
        const r = await saveMyLogo({ path: t.path, fileName: f.name, fileType: f.type, name: f.name.replace(/\.[^.]+$/, ""), previewable: pv, w: dims?.w, h: dims?.h });
        if (!r.ok) throw new Error(r.error);
        d = r.design as Design;
        setDesigns((x) => [d, ...x]);
        if (r.url) setUrls((x) => ({ ...x, [d.id]: r.url }));
        setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, design_id: d.id } : x)));
        setMsg(`Saved ${designLabel(d)} to your logos.`);
        return;
      }
      const { data: u } = await sb.auth.getUser();
      d = await uploadDesign(sb, { file: f, customer_id: customerId, by: u.user?.email || "" });
      setDesigns((x) => [d, ...x]);
      setUrls({ ...urls, ...(await previewUrls(sb, [d])) });
      setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, design_id: d.id } : x)));
      setMsg(`Saved ${designLabel(d)} to the customer's account.`);
    } catch (e) { setMsg("Upload failed: " + (e instanceof Error ? e.message : String(e))); }
  }

  /** Draw one garment color with every imprint, plus a spec strip, as a PNG. */
  /** bare = just the shirt photos with the art (the thumbnail on the order), no title or spec lines. */
  async function render(l: Line, bare = false): Promise<Blob> {
    const k = bare ? 0.4 : 0.6, pw = PHOTO_W * k, ph = PHOTO_H * k, pad = bare ? 10 : 24, top = bare ? pad : 70;
    const specLines = imprints.map((im) => { const p = place(im); return `${im.location}: ${p.d ? designLabel(p.d) : "no design"} · ${p.wIn.toFixed(1)}" × ${(p.hIn || 0).toFixed(1)}"${im.inks ? " · " + im.inks : ""}`; });
    const W = pad * 2 + views.length * pw + (views.length - 1) * pad;
    const H = bare ? ph + pad * 2 : 70 + ph + 30 + specLines.length * 26 + pad;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    let x = c.getContext("2d")!;
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H);
    if (!bare) {
      x.fillStyle = "#141D2B"; x.font = "700 24px Helvetica, Arial, sans-serif";
      x.fillText(`${order ? `#${order.number} ` : ""}${groupName || "Mockup"}`, pad, 36);
      x.font = "16px Helvetica, Arial, sans-serif"; x.fillStyle = "#4A566B";
      x.fillText([l.brand, l.style, l.garment].filter(Boolean).join(" ") + (l.color ? ` — ${l.color}` : ""), pad, 60);
    }
    for (let i = 0; i < views.length; i++) {
      const v = views[i], ox = pad + i * (pw + pad), oy = top;
      const bg = await loadImg(photo(l, v)).catch(() => loadImg(teeSvg(guessHex(l.color), v)));
      x.drawImage(bg, ox, oy, pw, ph);
      const u = photo(l, v), fit = u.startsWith("data:") ? null : fits[u] || measureGarment(bg, v);
      // art goes on its own layer, then gets cut to the shirt outline before it's added to the picture
      const layer = document.createElement("canvas"); layer.width = c.width; layer.height = c.height;
      const main = x; x = layer.getContext("2d")!;
      for (const im of imprints.filter((m) => viewsFor(m.location).includes(v))) {
        const p = place(im, v, fit);
        if (!p.d || !artUrl(im)) continue;
        const art = await loadImg(artUrl(im)).catch(() => null);
        if (art) {
          x.save();
          x.translate(ox + (p.x + p.w / 2) * k, oy + (p.y + p.h / 2) * k);
          if (p.rot) x.rotate((p.rot * Math.PI) / 180);
          if (p.clip) { x.beginPath(); x.rect(p.clip === "left" ? (-p.w / 2) * k : 0, (-p.h / 2) * k, (p.w / 2) * k, p.h * k); x.clip(); }
          x.drawImage(art, (-p.w / 2) * k, (-p.h / 2) * k, p.w * k, p.h * k);
          x.restore();
        }
      }
      if (fit?.mask) {
        const m = await loadImg(fit.mask).catch(() => null);
        if (m) { x.globalCompositeOperation = "destination-in"; x.drawImage(m, ox, oy, pw, ph); x.globalCompositeOperation = "source-over"; }
      }
      x = main; x.drawImage(layer, 0, 0);
      if (!bare) { x.fillStyle = "#7A8599"; x.font = "600 13px Helvetica, Arial, sans-serif"; x.fillText(v.toUpperCase(), ox, oy + ph + 18); }
    }
    if (!bare) { x.fillStyle = "#141D2B"; x.font = "15px Helvetica, Arial, sans-serif"; specLines.forEach((s, i) => x.fillText(s, pad, 70 + ph + 44 + i * 26)); }
    return await new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
  }

  /** Double-click on a design (on the photo or in a close-up): open the ink menu for the logo color under the cursor. */
  async function pickColor(id: string, rx: number, ry: number, cx: number, cy: number) {
                  const im = imprints.find((x) => x.id === id);
                  const d = im && designs.find((x) => x.id === im.design_id);
                  if (!im || !d || !urls[d.id]) return setMsg("Pick a design for this location first.");
                  let pt = paints[id];
                  let img = imgCache.current.get(d.id);
                  try { if (!img) { img = await loadImg(urls[d.id]); imgCache.current.set(d.id, img); } } catch { return setMsg("Couldn't read this design's colors. Try re-uploading it as a PNG."); }
                  if (!pt || pt.design !== d.id) { pt = { design: d.id, sources: detectColors(img), map: {} }; const np = pt; setPaints((p) => ({ ...p, [id]: np })); }
                  if (!pt.sources.length) return;
                  // look around the click for the nearest solid pixel (thin lettering is easy to miss)
                  const W0 = img.naturalWidth || 400, H0 = img.naturalHeight || 400, R = Math.max(3, Math.round(W0 * 0.03));
                  const px = Math.floor(rx * W0), py = Math.floor(ry * H0);
                  const c = document.createElement("canvas"); c.width = 2 * R + 1; c.height = 2 * R + 1;
                  const cx2 = c.getContext("2d", { willReadFrequently: true })!;
                  cx2.drawImage(img, px - R, py - R, 2 * R + 1, 2 * R + 1, 0, 0, 2 * R + 1, 2 * R + 1);
                  const dd0 = cx2.getImageData(0, 0, 2 * R + 1, 2 * R + 1).data;
                  let r = 0, g = 0, b2 = 0, near = Infinity;
                  for (let yy = 0; yy <= 2 * R; yy++) for (let xx = 0; xx <= 2 * R; xx++) {
                    const i = (yy * (2 * R + 1) + xx) * 4, dist = (xx - R) ** 2 + (yy - R) ** 2;
                    if (dd0[i + 3] >= 150 && dist < near) { near = dist; r = dd0[i]; g = dd0[i + 1]; b2 = dd0[i + 2]; }
                  }
                  if (near === Infinity) { setPop({ id, src: pt.sources[0].hex, x: cx, y: cy }); return; }
                  let best = pt.sources[0]?.hex, bd = Infinity;
                  for (const src of pt.sources) { const v = [1, 3, 5].map((o) => parseInt(src.hex.slice(o, o + 2), 16)); const dd = (v[0] - r) ** 2 + (v[1] - g) ** 2 + (v[2] - b2) ** 2; if (dd < bd) { bd = dd; best = src.hex; } }
                  if (best) setPop({ id, src: best, x: cx, y: cy });
  }

  /** Write the imprints (locations, designs, sizes, inks) back to the order group, so both screens match. */
  async function syncOrder(mockupSaved = false, thumbs: string[] = []): Promise<boolean> {
    if (!order) return false;
    const { data } = await sb.from("orders").select("groups").eq("id", order.id).maybeSingle();
    const groups = (data?.groups || []) as Order["groups"];
    const g = groups.find((x) => x.id === groupId) || groups[0];
    if (!g) return false;
    // write the size the mockup actually shows, even if it was never typed (e.g. the 3.5" left chest default)
    const sized = imprints.map((im) => { if (im.size.trim()) return im; const p = place(im); return p.d ? { ...im, size: `${Math.round(p.wIn * 100) / 100}" wide` } : im; });
    g.imprints = sized.map((im) => ({ ...(g.imprints.find((x) => x.id === im.id) || {}), ...im }));
    if (mockupSaved) g.mockupAt = new Date().toISOString();
    if (thumbs.length) g.mockupThumbs = thumbs;
    const { error } = await sb.from("orders").update({ groups }).eq("id", order.id);
    if (error) { setMsg("Couldn't update the order: " + error.message); return false; }
    return true;
  }

  async function saveAll(force = false) {
    if (!customerId) return setMsg("Pick a customer so the mockups save to their account.");
    if (!force && imprints.some((im) => unsetColors(im).length)) { setAskUploaded(true); return; }
    setAskUploaded(false);
    if (!lines.some((l) => l.style || l.color)) return setMsg("Add a garment and color first.");
    if (!imprints.length) return setMsg("Add at least one print location first.");
    const missing = imprints.filter((im) => !designOf(im));
    if (missing.length) return setMsg(`${missing.map((m) => m.location).join(", ")} ${missing.length > 1 ? "have" : "has"} no design yet. ${portal ? "Pick one of your logos or upload one." : "Pick one of the customer's designs or upload new art."}`);
    setSaving(true);
    setMsg("");
    const out: { title: string; url: string }[] = [];
    const thumbs: string[] = [];
    if (portal) {
      // customers: upload with one-time links, then the server records the mockup on their account
      try {
        for (const l of lines.filter((z) => z.style || z.color)) {
          const blob = await render(l), thumb = await render(l, true);
          const title = `${groupName || "Mockup"} — ${[l.brand, l.style].filter(Boolean).join(" ")} ${l.color}`.trim();
          const t = await mockupUploadUrls();
          if (!t.ok) throw new Error(t.error);
          const a = await sb.storage.from("proofs").uploadToSignedUrl(t.path, t.token, blob, { contentType: "image/png" });
          if (a.error) throw new Error(a.error.message);
          await sb.storage.from("proofs").uploadToSignedUrl(t.thumbPath, t.thumbToken, thumb, { contentType: "image/png" });
          const r = await saveMyMockup({ path: t.path, title, design_ids: [...new Set(imprints.map((i) => i.design_id).filter(Boolean))] as string[] });
          if (!r.ok) throw new Error(r.error);
          out.push({ title, url: URL.createObjectURL(blob) });
        }
        setSaved(out);
        setMsg(`Saved ${out.length} mockup${out.length > 1 ? "s" : ""} to your artwork.`);
      } catch (e) { setMsg("Couldn't save: " + (e instanceof Error ? e.message : String(e))); }
      setSaving(false);
      return;
    }
    const { data: u } = await sb.auth.getUser();
    try {
      for (const l of lines.filter((z) => z.style || z.color)) {
        const blob = await render(l);
        const title = `${groupName || "Mockup"} — ${[l.brand, l.style].filter(Boolean).join(" ")} ${l.color}`.trim();
        const path = orderId ? `${orderId}/mockup-${Date.now()}-${uid().slice(0, 6)}.png` : `mockups/${customerId}/${Date.now()}-${uid().slice(0, 6)}.png`;
        const up = await sb.storage.from("proofs").upload(path, blob, { contentType: "image/png" });
        if (up.error) throw new Error(up.error.message);
        let proofId: string | null = null;
        if (orderId) {
          const { data: pr } = await sb.from("proofs").insert({ order_id: orderId, title, file_path: path, file_type: "image/png" }).select("id").single();
          proofId = pr?.id || null;
        }
        await sb.from("mockups").insert({ customer_id: customerId, order_id: orderId || null, group_id: groupId || null, proof_id: proofId, title, file_path: path, design_ids: [...new Set(imprints.map((i) => i.design_id).filter(Boolean))], created_by: u.user?.email || "" });
        // a small photos-only picture for the order screen and the customer's artwork lists
        const thumb = await render(l, true);
        const tpath = path.replace(/\.png$/, "-thumb.png");
        const tu = await sb.storage.from("proofs").upload(tpath, thumb, { contentType: "image/png" });
        if (!tu.error) thumbs.push(tpath);
        out.push({ title, url: URL.createObjectURL(blob) });
      }
      await syncOrder(true, thumbs);
      setSaved(out);
      setMsg(orderId ? `Saved ${out.length} mockup${out.length > 1 ? "s" : ""} to the order as proofs and to the customer's account.` : `Saved ${out.length} mockup${out.length > 1 ? "s" : ""} to the customer's account.`);
    } catch (e) { setMsg("Couldn't save: " + (e instanceof Error ? e.message : String(e))); }
    setSaving(false);
  }

  const garmentOptions = catalog.slice().sort((a, b) => `${a.brand} ${a.style}`.localeCompare(`${b.brand} ${b.style}`));
  // a mockup needs a customer (art and mockups save to their account) and at least one garment
  const ready = !!customerId && lines.some((l) => l.style.trim());
  const notReady = !customerId ? "Pick a customer first — their designs and mockups live on their account." : "Pick at least one garment to put the art on."
  return (
    <>
      <Link className="back" href={portal ? backHref || "/portal" : orderId ? `/shop/orders/${orderId}` : "/shop/artwork"}>← {portal ? "Dashboard" : orderId ? `Order #${order?.number || ""}` : "Artwork"}</Link>
      <div className="page-head mk-head">
        <div><div className="eyebrow">{custLabel(customers.find((c) => c.id === customerId)) || "Mockup builder"}</div><h1>{orderId ? `Mockup · ${groupName}` : "Mockup builder"}</h1></div>
        <div className="row"><span className="save-state">{msg}</span>{orderId && <button className="btn" type="button" disabled={saving} onClick={async () => { if (await syncOrder()) setMsg("Order updated."); }}>Update order only</button>}<button className="btn primary" type="button" disabled={saving || !ready} title={ready ? undefined : notReady} onClick={() => saveAll()}>{saving ? "Saving…" : orderId ? "Save mockups to order" : "Save mockup"}</button></div>
      </div>

        {!orderId && (
          <section className="panel mk-setup">
            {!portal && <label className="mk-f"><span>Customer</span><select aria-label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Choose a customer…</option>{customers.map((c) => <option key={c.id} value={c.id}>{custLabel(c)}</option>)}</select></label>}
            <label className="mk-f"><span>Mockup name</span><input type="text" aria-label="Mockup name" placeholder="e.g. Spring promo tee" value={groupName} onChange={(e) => setGroupName(e.target.value)} /></label>
            {lines.map((l, i) => {
              const g = garmentFor(l);
              return (
                <div key={l.id} className="mk-f mk-setup-g"><span>{i === 0 ? "Garment & color" : `Color ${i + 1}`}</span><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                  <select aria-label="Garment" value={g?.id || ""} onChange={(e) => { const gg = catalog.find((x) => x.id === e.target.value); setLines((ls) => ls.map((x, j) => (j === i ? { ...x, style: gg?.style || "", brand: gg?.brand || "", garment: gg?.description || "", color: gg?.colors?.[0] || "" } : x))); }}>
                    <option value="">Garment…</option>{garmentOptions.map((gg) => <option key={gg.id} value={gg.id}>{gg.brand} {gg.style} — {gg.description}</option>)}
                  </select>
                  <select aria-label="Color" value={l.color} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}>
                    <option value="">Color…</option>{(g?.colors || []).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {lines.length > 1 && <button type="button" className="btn icon ghost" aria-label="Remove this color" onClick={() => { setLines((ls) => ls.filter((_, j) => j !== i)); setActive(0); }}>✕</button>}
                </div></div>
              );
            })}
            <button className="btn sm mk-add" type="button" onClick={() => { const last = lines[lines.length - 1]; setLines([...lines, { ...last, id: uid(), color: "" }]); }}>+ Another color</button>
          </section>
        )}
      {askUploaded && (
        <div className="confirm-bar" style={{ marginBottom: 10 }}>
          <span>Some design colors are still &quot;as uploaded&quot; instead of a standard ink ({imprints.filter((im) => unsetColors(im).length).map((im) => `${im.location}: ${unsetColors(im).length}`).join(", ")}). Set them to the closest Wilflex RFU inks?</span>
          <button type="button" className="btn sm primary" onClick={() => { imprints.forEach(matchStandard); setAskUploaded(false); setMsg("Matched to the closest standard inks. Check them, then save."); }}>Use closest standard inks</button>
          <button type="button" className="btn sm" onClick={() => saveAll(true)}>Save as uploaded</button>
          <button type="button" className="btn sm ghost" onClick={() => setAskUploaded(false)}>Cancel</button>
        </div>
      )}
          {lines.length > 1 && (
            <div className="chips" style={{ marginBottom: 10, width: "fit-content" }}>
              {lines.map((l, i) => <button key={l.id} type="button" className={"chip" + (i === active ? " on" : "")} onClick={() => setActive(i)}>{[l.style, l.color].filter(Boolean).join(" · ") || `Garment ${i + 1}`}</button>)}
            </div>
          )}
          {!ready && <div className="confirm-bar" style={{ marginBottom: 8 }}><span>{notReady}</span></div>}
          {ready && imprints.map((im) => {
            const pt = paints[im.id], same = sharedInks(pt);
            if (!pt || !same.length || pt.unite !== undefined) return null;
            const which = pt.sources.map((x, i) => (same.includes(pt.map[x.hex]?.name) ? `color ${i + 1}` : "")).filter(Boolean);
            return (
              <div key={"unite" + im.id} className="confirm-bar" style={{ marginBottom: 8 }}>
                <span>On the {im.location}, {which.join(" and ")} are all set to {same.join(" / ")}. Print {which.length > 2 ? "them" : "both"} as one color (one screen)?</span>
                <button type="button" className="btn sm primary" onClick={() => setUnite(im.id, true)}>Unite colors</button>
                <button type="button" className="btn sm ghost" onClick={() => setUnite(im.id, false)}>Keep separate</button>
              </div>
            );
          })}
          {ready && imprints.map((im) => {
            const w = want[im.id]; if (!w) return null;
            const r = ratioOf(designOf(im));
            const big = biggerSpot(im.location, w, r ? w * r : 0);
            const sp = spotFor(im.location);
            return (
              <div key={"big" + im.id} className="confirm-bar" style={{ marginBottom: 8 }}>
                <span>The {im.location} print area tops out at {sp.maxW}&quot; × {sp.maxH}&quot;. {big.length ? `Move it to ${big.join(" or ")} to make it ${w.toFixed(1)}" wide?` : "That's as big as a print gets here."}</span>
                {big.map((z, i) => <button key={z} type="button" className={"btn sm" + (i === 0 ? " primary" : "")} onClick={() => {
                  setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, location: z, size: `${Math.round(Math.min(w, maxWidthFor(z, r)) * 100) / 100}" wide`, keepLocation: false } : x)));
                  setOffsets((o) => { const n = { ...o }; delete n[im.id]; return n; });
                  setWant((q) => { const n = { ...q }; delete n[im.id]; return n; });
                }}>{z}</button>)}
                <button type="button" className="btn sm ghost" onClick={() => setWant((q) => { const n = { ...q }; delete n[im.id]; return n; })}>Keep {im.location}</button>
              </div>
            );
          })}
          {ready && imprints.map((im) => {
            const p = place(im);
            const sug = keepLoc.includes(im.id) || im.keepLocation || !p.d ? [] : smallerSpot(im.location, p.wIn, p.hIn, (offsets[im.id]?.dx || 0) / (PX_PER_IN * scale));
            if (!sug.length) return null;
            return (
              <div key={"sug" + im.id} className="confirm-bar" style={{ marginBottom: 8 }}>
                <span>This design is {p.wIn.toFixed(1)}&quot; × {(p.hIn || 0).toFixed(1)}&quot; — that&apos;s {sug[0].startsWith("Upper") ? "an upper back" : "a chest"}-size print on the {im.location}. Switch it to {sug[0]} so the close-up and print area fit it?</span>
                {sug.map((z, i) => <button key={z} type="button" className={"btn sm" + (i === 0 ? " primary" : "")} onClick={() => { setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, location: z } : x))); setOffsets((o) => { const n = { ...o }; delete n[im.id]; return n; }); }}>{z}</button>)}
                <button type="button" className="btn sm ghost" onClick={() => { setKeepLoc((k) => [...k, im.id]); setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, keepLocation: true } : x))); }}>Keep {im.location}</button>
              </div>
            );
          })}
      <div className="mk">
        <div className="mk-stage-wrap">
          <div className={"mk-canvas" + (ready ? "" : " mk-off")} inert={!ready || undefined}>
          <div className="mk-views">
            {(["front", "back"] as View[]).map((v) => (
              <Stage key={v} grid={grid} mask={fitFor(line, v)?.mask} src={line ? photo(line, v) : teeSvg("#9aa1ab", v)} label={v}
                items={imprints.filter((im) => viewsFor(im.location).includes(v)).map((im) => ({ id: im.id, p: place(im, v), url: artUrl(im) }))}
                onMove={(id, dx, dy) => {
                  const im = imprints.find((x) => x.id === id);
                  const p = im && place(im, v);
                  if (p && p.clip) {
                    // sleeve: turn the drag into along-the-sleeve moves
                    const a = (-p.rot * Math.PI) / 180;
                    [dx, dy] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
                  }
                  if (p) { dx /= p.k; dy /= p.k; }
                  setOffsets((o) => ({ ...o, [id]: { dx: (o[id]?.dx || 0) + dx, dy: (o[id]?.dy || 0) + dy } }));
                }}
                onResize={(id, newW) => {
                  const im = imprints.find((x) => x.id === id); if (!im) return;
                  const old = place(im, v);
                  const inches = growTo(im, newW / (PX_PER_IN * scale * old.k));
                  newW = inches * PX_PER_IN * scale * old.k;
                  // keep the left edge where it is while the size changes (sleeves stay centered on the fold)
                  if (!old.clip) setOffsets((o) => ({ ...o, [id]: { dx: (o[id]?.dx || 0) + (newW - old.w) / 2 / old.k, dy: o[id]?.dy || 0 } }));
                }}
                onPick={pickColor} />
            ))}
          </div>
          <div className="row mk-tools">
            <label className="check" style={{ fontSize: 12 }}><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Show print areas</label>
            <span className="faint" style={{ fontSize: 12 }}>Drag to move · corner handle to resize · double-click a color to change it</span>
            {Object.keys(offsets).length > 0 && <button className="btn sm ghost" type="button" onClick={() => setOffsets({})}>Reset positions</button>}
            <span className="spacer" /><span className="faint" style={{ fontSize: 12 }}>Shown on {isYouthStyle(line) ? "a youth Large" : "an adult Large"}</span>
          </div>
            <div className="mk-closeups" ref={cuRef}>
              {/* front locations first, then back, sleeves always last (in order-form order within each) */}
              {imprints.map((im, i) => ({ im, i })).sort((a, b) => {
                const rank = (x: Imprint) => (viewsFor(x.location).length > 1 ? 2 : spotFor(x.location).view === "back" ? 1 : 0);
                const pos = (x: Imprint) => { const k = LOCATIONS.indexOf(x.location); return k < 0 ? 999 : k; };
                return rank(a.im) - rank(b.im) || pos(a.im) - pos(b.im) || a.i - b.i;
              }).map(({ im }) => closeUp(im, cuSize))}
            </div>
          </div>
          {pop && (() => {
            const im = imprints.find((x) => x.id === pop.id);
            const pt = paints[pop.id];
            if (!im || !pt) return null;
            // the color that was double-clicked first, then the rest of the design's colors (united colors share a row)
            const all = colorRows(pt), first = all.find((r) => r.hexes.includes(pop.src));
            const list = [first, ...all.filter((r) => r !== first)].filter(Boolean) as ReturnType<typeof colorRows>;
            const openKey = pop.open || pop.src;
            return (
              <div className="mk-pop" style={{ left: Math.min(pop.x + 8, (typeof window !== "undefined" ? window.innerWidth : 1200) - 320), top: Math.min(pop.y + 8, (typeof window !== "undefined" ? window.innerHeight : 900) - 80) }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                  <span className="lbl">{list.length > 1 ? `${list.length} COLORS IN THIS DESIGN` : "DESIGN COLOR"}</span>
                  <button className="btn icon ghost" type="button" aria-label="Close" onClick={() => setPop(null)}>✕</button>
                </div>
                {list.map((row, i) => {
                  const cur = row.cur, open = row.hexes.includes(openKey);
                  const pick = (v: { name: string; hex: string } | null) => setInks(im.id, Object.fromEntries(row.hexes.map((h) => [h, v])));
                  return (
                    <div key={row.hexes.join()} className={"mk-pop-row" + (open ? " open" : "")}>
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <button type="button" className="mk-pop-k" title="Show suggested colors" onClick={() => setPop({ ...pop, open: row.hexes[0] })}>
                          <span className="mk-srcs">{row.hexes.map((h) => <span key={h} className="sw" style={{ background: h }} />)}</span><span>→</span><span className="sw" style={{ background: cur ? (cur.name === "none" ? "transparent" : cur.hex) : row.hexes[0] }} />
                        </button>
                        <InkSelect key={row.hexes.join() + pop.id} value={cur} onChange={(v) => { pick(v); if (list.length === 1 && v && v.name) setPop(null); }} />
                      </div>
                      {open && (row.hexes.length > 1
                        ? <div className="mk-united"><span>{row.hexes.length} colors united · prints as one color</span></div>
                        : <Match hex={row.hexes[0]} cur={cur} onPick={(v) => { pick(v); if (list.length === 1) setPop(null); else { const nx = list[i + 1]; setPop({ ...pop, open: nx ? nx.hexes[0] : row.hexes[0] }); } }} />)}
                    </div>
                  );
                })}
                {list.length > 1 && <div className="row" style={{ justifyContent: "flex-end", marginTop: 6 }}><button type="button" className="btn sm primary" onClick={() => setPop(null)}>Done</button></div>}
              </div>
            );
          })()}
          {saved.length > 0 && (
            <div className="mk-saved">{saved.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer"><img src={s.url} alt={s.title} /><span>{s.title}</span></a>)}</div>
          )}
        </div>

        <div className="mk-mini">
          <div className="lbl">{curTab === "sleeve" ? "SLEEVE" : curTab.toUpperCase()} CLOSE-UP</div>
          {imprints.filter((im) => sideOf(im.location) === curTab).map((im) => closeUp(im, 200))}
          {!imprints.some((im) => sideOf(im.location) === curTab) && <div className="faint" style={{ fontSize: 12 }}>Add a {curTab === "sleeve" ? "sleeve" : curTab} location to see it up close here.</div>}
        </div>
        <div className="mk-side stack">
          <section className={"panel" + (ready ? "" : " mk-off")} inert={!ready || undefined}>
            <div className="panel-h"><h2>Imprints</h2><button className="btn sm" type="button" onClick={() => { const opts = locsFor(curTab); setImprints([...imprints, newImprint(opts.find((z) => !imprints.some((i) => i.location === z)) || opts[0])]); setTab(curTab); }}>+ Add {curTab === "sleeve" ? "sleeve" : curTab} location</button></div>
            <div className="chips mk-tabs">
              {SIDES.map((t) => { const n = imprints.filter((im) => sideOf(im.location) === t.id).length; return <button key={t.id} type="button" className={"chip" + (curTab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>{t.label}{n ? ` (${n})` : ""}</button>; })}
            </div>
            <div className="panel-b stack">
              {imprints.every((im) => sideOf(im.location) !== curTab) && <div className="faint" style={{ fontSize: 13 }}>No {curTab === "sleeve" ? "sleeve" : curTab} prints yet.</div>}
              {imprints.filter((im) => sideOf(im.location) === curTab).map((im) => {
                const p = place(im);
                return (
                  <div key={im.id} className="mk-imp">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <select aria-label="Location" value={im.location} onChange={(e) => setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, location: e.target.value } : x)))}>{!LOCATIONS.includes(im.location) && <option>{im.location}</option>}{locsFor(curTab).map((z) => <option key={z}>{z}</option>)}</select>
                      <select aria-label={`Method for ${im.location}`} value={im.method} onChange={(e) => { const m = e.target.value as Method; setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, method: m, colors: m === "embroidery" ? Math.min(x.colors, 15) : x.colors } : x))); }}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <button className="btn icon ghost" type="button" aria-label={`Remove ${im.location}`} onClick={() => setImprints((xs) => xs.filter((x) => x.id !== im.id))}>✕</button>
                      <span className="faint" style={{ fontSize: 12 }}>{p.wIn.toFixed(1)}&quot; × {(p.hIn || 0).toFixed(1)}&quot;</span>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <DesignSearch designs={designs} urls={urls} value={im.design_id} placeholder="Pick a design…"
                        onPick={(d) => setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, design_id: d?.id || undefined } : x)))}
                        onStar={async (d, starred) => {
                          setDesigns((ds) => ds.map((x) => (x.id === d.id ? { ...x, starred } : x)));
                          const { error } = portal ? await starMyDesign(d.id, starred).then((r) => ({ error: r.ok ? null : r.error })) : await sb.rpc("set_design_star", { p_design: d.id, p_starred: starred });
                          if (error) setDesigns((ds) => ds.map((x) => (x.id === d.id ? { ...x, starred: !starred } : x)));
                        }} />
                    </div>
                    {p.d && paints[im.id] && paints[im.id].sources.length > 0 && (
                      <div className="mk-colors">
                        <div className="lbl">COLORS IN THIS DESIGN</div>
                        {colorRows(paints[im.id]).map((row) => {
                          const cur = row.cur, pick = (v: { name: string; hex: string } | null) => setInks(im.id, Object.fromEntries(row.hexes.map((h) => [h, v])));
                          return (
                            <div key={row.hexes.join()} className="mk-color-wrap">
                            <div className="mk-color">
                              <span className="mk-srcs">{row.hexes.map((h) => <span key={h} className="sw" style={{ background: h }} title={h} />)}</span>
                              <span className="arrow">→</span>
                              <span className="sw" style={{ background: cur ? (cur.name === "none" ? "transparent" : cur.hex) : row.hexes[0] }} />
                              <InkSelect value={cur} onChange={pick} />
                            </div>
                            {row.hexes.length > 1
                              ? <div className="mk-united"><span>{row.hexes.length} colors united · prints as one color</span><button type="button" className="btn sm ghost" onClick={() => setUnite(im.id, false)}>Split</button></div>
                              : <Match hex={row.hexes[0]} cur={cur} onPick={pick} />}
                            </div>
                          );
                        })}
                        {unsetColors(im).length > 0 && <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} title="Set each color that's still as uploaded to the closest Wilflex RFU ink" onClick={() => matchStandard(im)}>Use closest standard inks</button>}
                      </div>
                    )}
                    {!p.d && <div className="ink-warn">Which design goes on the {im.location}? Pick one of the customer&apos;s designs, or upload new art.</div>}
                    <div className="row" style={{ gap: 6 }}>
                      <label className="btn sm ghost" style={{ cursor: "pointer" }}>Upload new art<input type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadNew(im, f); }} /></label>
                    </div>
                    <div className="row mk-wh" style={{ gap: 6 }}>
                      {(() => {
                        const tall = /tall/i.test(im.size);
                        const typed = (im.size.match(/^([\d.]+)/) || [])[1] || "";
                        const set = (v: string, dim: "wide" | "tall") => {
                          let t = v.replace(/[^\d.]/g, "");
                          // cap at the location's max print area (e.g. sleeves 3.5" x 3.5")
                          const r = ratioOf(designOf(im)) || 0;
                          const cap = dim === "wide" ? maxWidthFor(im.location, r) : maxWidthFor(im.location, r) * (r || 1);
                          const over = t && !t.endsWith(".") && +t > cap ? +t : 0;
                          setWant((w) => { const n = { ...w }; if (over) n[im.id] = dim === "wide" ? over : r ? over / r : over; else delete n[im.id]; return n; });
                          if (over) t = String(Math.round(cap * 100) / 100);
                          setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, size: t ? `${t}" ${dim}` : "" } : x)));
                        };
                        return (
                          <>
                            <label>W <input type="text" inputMode="decimal" aria-label="Width in inches" placeholder={p.wIn.toFixed(2)} value={!tall ? typed : p.wIn ? p.wIn.toFixed(2) : ""} onChange={(e) => set(e.target.value, "wide")} />&quot;</label>
                            <span className="faint">×</span>
                            <label>H <input type="text" inputMode="decimal" aria-label="Height in inches" placeholder={(p.hIn || 0).toFixed(2)} value={tall ? typed : p.hIn ? p.hIn.toFixed(2) : ""} onChange={(e) => set(e.target.value, "tall")} />&quot;</label>
                            <span className="faint" style={{ fontSize: 11 }}>proportions locked</span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
              {orderId && <div className="faint" style={{ fontSize: 12 }}>Changes here (locations, designs, sizes, inks) go back to the order when you save.</div>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

/** One garment photo with designs you can drag, resize from the corner (proportions locked) and double-click to recolor. */
function Stage({ src, label, items, grid, mask, onMove, onResize, onPick }: {
  src: string; label: string; grid?: boolean; /** shirt-shaped mask: art never shows past the edge of the shirt */ mask?: string;
  items: { id: string; p: { x: number; y: number; w: number; h: number; rot: number; clip?: "" | "left" | "right"; area: { x: number; y: number; w: number; h: number } }; url: string }[];
  onMove: (id: string, dx: number, dy: number) => void;
  onResize: (id: string, newW: number) => void;
  onPick: (id: string, relX: number, relY: number, clientX: number, clientY: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; sx: number; sy: number; mode: "move" | "size"; w: number; el?: HTMLElement } | null>(null);
  const [sel, setSel] = useState("");
  const lastDown = useRef<{ t: number; x: number; y: number; id: string } | null>(null);
  // the outline and resize handle only show while a design is selected; clicking anywhere else clears it
  useEffect(() => {
    if (!sel) return;
    const off = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest?.(".mk-art")) setSel(""); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [sel]);
  const k = () => (box.current ? box.current.clientWidth / PHOTO_W : 0.42);
  const s = 100 / PHOTO_W, sy = 100 / PHOTO_H;
  return (
    <div className="mk-stage">
      <div ref={box} className="mk-photo" style={{ aspectRatio: `${PHOTO_W} / ${PHOTO_H}` }}
        onPointerMove={(e) => {
          const d = drag.current; if (!d) return;
          const f = k();
          if (d.mode === "move") onMove(d.id, (e.clientX - d.x) / f, (e.clientY - d.y) / f);
          else { const dw = (e.clientX - d.x) / f; if (d.w + dw > 12) { onResize(d.id, d.w + dw); d.w += dw; } }
          drag.current = { ...d, x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const d = drag.current; drag.current = null;
        }}
        onPointerLeave={() => { drag.current = null; }}
        onPointerDown={(e) => { if (e.target === box.current || (e.target as HTMLElement).classList.contains("mk-bg")) setSel(""); }}>
        <img src={src} alt="" draggable={false} className="mk-bg" />
        {grid && items.map((it) => <div key={"a" + it.id} className="mk-area" style={{ left: `${it.p.area.x * s}%`, top: `${it.p.area.y * sy}%`, width: `${it.p.area.w * s}%`, height: `${it.p.area.h * sy}%`, transform: it.p.rot ? `rotate(${it.p.rot}deg)` : undefined }} />)}
        {/* the art itself, cut to the shirt outline */}
        <div className="mk-artlayer" style={mask ? { maskImage: `url(${mask})`, WebkitMaskImage: `url(${mask})` } : undefined}>
          {items.map((it) => it.url ? (
            <div key={"v" + it.id} className="mk-artv" style={{ left: `${it.p.x * s}%`, top: `${it.p.y * sy}%`, width: `${it.p.w * s}%`, height: `${it.p.h * sy}%`, transform: it.p.rot ? `rotate(${it.p.rot}deg)` : undefined, clipPath: it.p.clip === "left" ? "inset(0 50% 0 0)" : it.p.clip === "right" ? "inset(0 0 0 50%)" : undefined }}>
              <img src={it.url} alt="" draggable={false} />
            </div>
          ) : null)}
        </div>
        {/* invisible handles on top for dragging, resizing and double-click */}
        {items.map((it) => (
          <div key={it.id} className={"mk-art mk-hit" + (sel === it.id ? " sel" : "") + (it.url ? "" : " mk-missing")}
            style={{ left: `${it.p.x * s}%`, top: `${it.p.y * sy}%`, width: `${it.p.w * s}%`, height: `${it.p.h * sy}%`, transform: it.p.rot ? `rotate(${it.p.rot}deg)` : undefined, clipPath: it.p.clip === "left" ? "inset(0 50% 0 0)" : it.p.clip === "right" ? "inset(0 0 0 50%)" : undefined }}
            onPointerDown={(e) => {
              e.stopPropagation();
              // double-click (two quick clicks in the same spot) opens the color menu for the color under the cursor
              const now = Date.now(), last = lastDown.current;
              lastDown.current = { t: now, x: e.clientX, y: e.clientY, id: it.id };
              if (last && last.id === it.id && now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8) {
                const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect();
                const cx = r.left + r.width / 2, cy = r.top + r.height / 2, a = (-(it.p.rot || 0) * Math.PI) / 180;
                const vx = e.clientX - cx, vy = e.clientY - cy;
                const ux = vx * Math.cos(a) - vy * Math.sin(a), uy = vx * Math.sin(a) + vy * Math.cos(a);
                onPick(it.id, ux / el.offsetWidth + 0.5, uy / el.offsetHeight + 0.5, e.clientX, e.clientY);
                lastDown.current = null;
                return;
              }
              setSel(it.id);
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              // grabbing the bottom-right corner resizes right away (no need to select first)
              const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect();
              const a = (-(it.p.rot || 0) * Math.PI) / 180, vx = e.clientX - (r.left + r.width / 2), vy = e.clientY - (r.top + r.height / 2);
              const lx = vx * Math.cos(a) - vy * Math.sin(a) + el.offsetWidth / 2, ly = vx * Math.sin(a) + vy * Math.cos(a) + el.offsetHeight / 2;
              const corner = Math.max(10, Math.min(el.offsetWidth, el.offsetHeight) * 0.18);
              const mode = lx > el.offsetWidth - corner && ly > el.offsetHeight - corner ? "size" : "move";
              drag.current = { id: it.id, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode, w: it.p.w, el };
            }}>
            {it.url ? null : "?"}
            {sel === it.id && (
              <span className="mk-handle" title="Drag to resize (proportions stay locked)"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  drag.current = { id: it.id, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: "size", w: it.p.w };
                }} />
            )}
          </div>
        ))}
      </div>
      <div className="mk-label">{label}</div>
    </div>
  );
}

/** Pick the ink a logo color prints as: a Wilflex RFU color, a PMS color, a custom PMS, or drop it. */
function InkSelect({ value, onChange }: { value?: { name: string; hex: string }; onChange: (v: { name: string; hex: string } | null) => void }) {
  const known = value && (value.name === "none" || WILFLEX_HEX[value.name] || PMS_HEX[value.name]);
  const [customMode, setCustom] = useState(false);
  // any PMS from the full chart (or a typed one) shows as its name + color instead of the short list
  const custom = customMode || (!!value && !known);
  if (custom) {
    return (
      <span className="row" style={{ gap: 4, flex: 1 }}>
        <input type="text" aria-label="PMS number or ink name" placeholder="PMS 7621 C" value={value?.name || ""} onChange={(e) => onChange({ name: e.target.value, hex: value?.hex || "#888888" })} style={{ flex: 1, minWidth: 0 }} />
        <input type="color" aria-label="Screen color" value={value?.hex || "#888888"} onChange={(e) => onChange({ name: value?.name || "Custom", hex: e.target.value })} style={{ width: 34, padding: 0, height: 30 }} />
        <button type="button" className="btn icon ghost" title="Back to the list" onClick={() => { setCustom(false); onChange(null); }}>▾</button>
      </span>
    );
  }
  return (
    <select aria-label="Ink color" value={value?.name || ""} style={{ flex: 1, minWidth: 0 }}
      onChange={(e) => {
        const n = e.target.value;
        if (n === "__custom") { setCustom(true); onChange({ name: "", hex: "#888888" }); return; }
        if (!n) return onChange(null);
        onChange({ name: n, hex: n === "none" ? "" : colorHex(n) });
      }}>
      <option value="">Keep as uploaded</option>
      <option value="none">Remove (shirt shows through)</option>
      <optgroup label="Wilflex RFU">{Object.keys(WILFLEX_HEX).map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
      <optgroup label="PMS">{Object.keys(PMS_HEX).map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
      <option value="__custom">Other PMS / custom…</option>
    </select>
  );
}

/** Close-up of one print location: a patch of shirt color with the whole logo to drag and size (the photos show how it sits on the shirt). */
function CloseUp({ size, title, hex, url, wIn, hIn, maxW, maxH, fold, topAlign, offIn, colors, onMove, onResize, onPick }: {
  size: number; topAlign?: boolean; title: string; hex: string; url: string; wIn: number; hIn: number; maxW: number; maxH: number; fold: boolean; offIn: { x: number; y: number };
  colors: { hex: string; name: string }[];
  onMove: (dxIn: number, dyIn: number) => void; onResize: (newWIn: number) => void;
  onPick: (relX: number, relY: number, clientX: number, clientY: number) => void;
}) {
  const lastDown = useRef<{ t: number; x: number; y: number } | null>(null);
  const [sel, setSel] = useState(false);
  const artRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sel) return;
    const off = (e: PointerEvent) => { if (!artRef.current?.contains(e.target as Node)) setSel(false); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [sel]);
  const BOX = size;
  const spanW = maxW + 2, spanH = maxH + 2; // inches shown: the max print area plus a margin
  const PX = Math.min(BOX / spanW, (BOX * 1.25) / spanH); // css px per inch (tall areas can run a bit taller than wide)
  const W = spanW * PX, H = spanH * PX;
  const drag = useRef<{ x: number; y: number; mode: "move" | "size"; w: number } | null>(null);
  const cx = W / 2 + offIn.x * PX, top0 = (H - maxH * PX) / 2;
  const cy = (topAlign ? top0 + (hIn * PX) / 2 : H / 2) + offIn.y * PX; // same spot as on the photos: top of the area for full front/back, else centered
  return (
    <div className="mk-sleeve" style={{ width: BOX }}>
      <div className="mk-cu-h"><span className="lbl">{title.toUpperCase()}</span><span className="mk-cu-max">max {maxW}&quot; × {maxH}&quot;</span></div>
      <div className="mk-sleeve-box" style={{ width: W, height: H, background: hex, alignSelf: "center" }}
        onPointerMove={(e) => {
          const d = drag.current; if (!d) return;
          if (d.mode === "move") onMove((e.clientX - d.x) / PX, (e.clientY - d.y) / PX);
          else { d.w += (e.clientX - d.x) / PX; onResize(d.w); }
          drag.current = { ...d, x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
        <div className="mk-sleeve-max" style={{ width: maxW * PX, height: maxH * PX, left: (W - maxW * PX) / 2, top: top0 }} />
        {fold && <div className="mk-sleeve-seam" />}
        {fold && <><span className="mk-side-l">FRONT</span><span className="mk-side-r">BACK</span></>}
        {fold && <div className="mk-hem" style={{ top: top0 + maxH * PX, left: 0, right: 0 }}><span>HEMLINE</span></div>}
        <div ref={artRef} className={"mk-art" + (sel ? " sel" : "") + (url ? "" : " mk-missing")} style={{ left: cx - (wIn * PX) / 2, top: cy - (hIn * PX) / 2, width: wIn * PX, height: hIn * PX }}
          onPointerDown={(e) => {
            // double-click opens the color menu, same as on the photos
            const now = Date.now(), last = lastDown.current;
            lastDown.current = { t: now, x: e.clientX, y: e.clientY };
            if (last && now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8) {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              lastDown.current = null; drag.current = null;
              onPick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.clientX, e.clientY);
              return;
            }
            setSel(true);
            const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect();
            const corner = Math.max(10, Math.min(r.width, r.height) * 0.18);
            const mode = e.clientX > r.right - corner && e.clientY > r.bottom - corner ? "size" : "move";
            el.setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, mode, w: wIn };
          }}>
          {url ? <img src={url} alt="" draggable={false} /> : "?"}
          {sel && <span className="mk-handle" onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, mode: "size", w: wIn }; }} />}
        </div>
      </div>
      <div className="mk-cu-dim">{url ? <>{wIn.toFixed(2)}&quot; W × {hIn.toFixed(2)}&quot; H</> : "No design yet"}</div>
      {url && (
        <div className="mk-cu-colors">
          {colors.length ? colors.map((c, i) => (
            <div key={i} className="mk-cu-color"><span className="sw" style={{ background: c.hex || "transparent" }} /><span>{c.name}</span></div>
          )) : <span className="faint">Colors not read yet</span>}
        </div>
      )}
    </div>
  );
}

const matchWord = (dE: number) => (dE < 1 ? "exact" : dE < 3 ? "very close" : dE < 6 ? "close" : "not very close");
/** The color read from the art, with the closest standard Wilflex ink and the closest Pantone coated color to pick from. */
function Match({ hex, cur, onPick }: { hex: string; cur?: { name: string; hex: string }; onPick: (v: { name: string; hex: string }) => void }) {
  const ink = closestInk(hex), pms = closestPms(hex);
  const opt = (label: string, c: { name: string; hex: string; dE: number }) => (
    <button type="button" className={"mk-near" + (cur?.name === c.name ? " on" : "")} title={`${c.name} — ${matchWord(c.dE)} (ΔE ${c.dE})`} onClick={() => onPick({ name: c.name, hex: c.hex })}>
      <span className="k">{label}</span><span className="sw" style={{ background: c.hex }} /><span className="n">{c.name}</span><span className="q">{matchWord(c.dE)}</span>
    </button>
  );
  return (
    <div className="mk-match">
      <div className="mk-match-h"><span>SUGGESTED COLORS</span><span className="mono">{hex.toUpperCase()}</span></div>
      {opt("Standard", ink)}
      {opt("PMS", pms)}
    </div>
  );
}
