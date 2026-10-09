"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LESSON_KIND, widthOf, type MockupLesson } from "@/lib/mockupLessons";
import { LOCATIONS, METHODS, designLabel, mergeSettings, newImprint, orderGroups, uid, type Customer, type Design, type Garment, type Imprint, type Method, type Order } from "@/lib/pricing";
import { custLabel } from "@/lib/format";
import { DESIGN_ACCEPT, previewUrls, setDesignPreview, uploadDesign } from "@/lib/designs";
import { makePreview } from "@/lib/artPrep";
import { mockupUploadUrls, myLogos, portalCatalog, saveMyMockup } from "@/app/portal/request-actions";
import { uploadMyLogo } from "@/lib/customerUpload";
import { isVector, knockOut, trimClear, type CleanArt } from "@/lib/artPrep";
import { starMyDesign } from "@/app/portal/actions";
import { PREVIEWABLE_TYPES } from "@/lib/pricing";
import DesignSearch from "@/components/DesignSearch";
import Match from "@/components/InkMatch";
import ShirtDesigner from "@/components/ShirtDesigner";
import { loadDesignerDoc, saveDesignerLogo } from "@/lib/designerSave";
import { FONTS, type DesignDoc } from "@/lib/designerArt";
import { loadShirtFonts, quickTextDoc, renderQuickText, type QuickText } from "@/lib/quickText";
import type { DesignerOut, LabShirt } from "@/components/ShirtDesigner";
import { PMS_HEX, WILFLEX_HEX, closestInk, colorHex, deltaE, detectColors, recolor } from "@/lib/inkColors";
import { CENTER_X, COLLAR_Y, PHOTO_H, PHOTO_W, PX_PER_IN, measureBag, autoSpot as autoSpot0, basePlacement as basePlacement0, maxWidthFor as maxWidthFor0, sideMaxWidth as sideMaxWidth0, viewsFor, guessHex, measureGarment, printWidth as printWidth0, spotFor as spotFor0, type Fit, ssImg, teeSvg, type View } from "@/lib/mockup";
import { bodyAt, bodyOf, smallestOrdered, sortSizes, REF_BODY, type Body } from "@/lib/garmentBody";
import { useSticky } from "@/lib/useSticky";
import { canvasPage, imagePdf } from "@/lib/imagePdf";
import { planPrint, pxOfImage, type PrintPlan } from "@/lib/printPlan";
import { ColorPicker, StylePicker } from "@/components/GroupEditor";

type Line = { id: string; style: string; brand: string; color: string; garment: string };
type Offset = { dx: number; dy: number };
/** Per imprint: colors found in the logo and the ink each one prints as. */
type Side = "front" | "back" | "sleeve";
const SIDES: { id: Side; label: string }[] = [{ id: "front", label: "Front" }, { id: "back", label: "Back" }, { id: "sleeve", label: "Sleeves" }];
type Paint = { design: string; sources: { hex: string; share: number }[]; map: Record<string, { name: string; hex: string }>;
  /** how this logo prints (the same plan the Separation Studio starts from) */ plan?: PrintPlan;
  /** several logo colors set to the same ink: true = print them as one color (one screen), false = keep separate */ unite?: boolean };
/** Ink names for the imprint from the logo's color choices (same ink twice counts once when the colors are united). */
const inkNames = (pt: Paint, map = pt.map) => {
  const names = pt.sources.map((x) => map[x.hex]).filter((x) => x && x.name !== "none").map((x) => x!.name);
  return pt.unite === false ? names : [...new Set(names)];
};
/** a color name to compare by: "True Royal", "TrueRoyal" and "true royal" are the same */
const colorKey = (c: string) => (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");

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
  /** Inbox → Create order: build and save this group's mockup by itself (the art at the size and place the AI read from
   *  the customer's mockup, one-color prints in their ink), then go on to the next group, then the order */
  const auto = sp.get("auto") === "1";
  /** opened from an email (Inbox → Edit details): carried on to the order, which offers "Save & back to email" */
  const fromEmail = sp.get("email") || "";
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
  const [cuCols, setCuCols] = useState(2);
  useEffect(() => {
    const el = cuRef.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      // two across, each exactly as wide as the front / back photo above it
      const cols = el.clientWidth < 460 ? 1 : 2;
      setCuCols(cols);
      setCuSize(Math.max(120, Math.min(cols === 1 ? 420 : 9999, Math.floor((el.clientWidth - 14 * (cols - 1)) / cols))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
  /**
   * Layout by how much room there is (not the screen size, the builder's own width):
   * wide  = front + back photos, a close-up column, Imprints panel
   * mid   = front + back photos, Imprints panel (close-ups stay under the photos)
   * one   = one big photo (the side you're working on, with a Front/Back switch), Imprints panel
   * stack = one photo, then Imprints, then close-ups (phones)
   */
  const mkRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useSticky<"wide" | "mid" | "one" | "stack">("mockup.layout", "wide");
  useEffect(() => {
    const el = mkRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { const w = el.clientWidth; setMode(w >= 1190 ? "wide" : w >= 960 ? "mid" : w >= 700 ? "one" : "stack"); });
    ro.observe(el);
    return () => ro.disconnect();
  });
  const single = mode === "one" || mode === "stack";
  // the small close-up column next to the photos takes whatever width is left, so it grows instead of drifting away
  const miniRef = useRef<HTMLDivElement>(null);
  const [miniSize, setMiniSize] = useState(200);
  useEffect(() => {
    const el = miniRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setMiniSize(Math.max(160, Math.min(560, Math.floor(el.clientWidth)))));
    ro.observe(el);
    return () => ro.disconnect();
  });
  const [askUploaded, setAskUploaded] = useState(false);
  const [pop, setPop] = useState<{ id: string; src: string; x: number; y: number; open?: string } | null>(null);
  const [painted, setPainted] = useState<Record<string, string>>({});
  const imgCache = useRef(new Map<string, HTMLImageElement>());
  // raster logos (JPG, PNG…) on a solid background get it knocked out; staff can keep it per logo
  const [clean, setClean] = useState<Record<string, string>>({});
  const [keepBg, setKeepBg] = useState<Record<string, boolean>>({});
  const [keepInside, setKeepInside] = useState<Record<string, boolean>>({});
  // where the art really is once the background is gone (or a see-through logo's empty margins are cut off): the
  // logo is sized on the shirt by that, not by the old box around it
  const [trims, setTrims] = useState<Record<string, { w: number; h: number }>>({});
  /** The logo image to draw and read colors from: the cleaned-up version when its background was removed. */
  async function logoImg(d: Design): Promise<HTMLImageElement> {
    const hit = imgCache.current.get(d.id);
    if (hit) return hit;
    let img = await loadImg(urls[d.id]);
    if (!isVector(d.file_type, d.file_name)) {
      // a logo on a solid background: background out, then cropped to the art. Already see-through (or the background
      // kept on purpose): just the empty margins cut off, so the art itself is what's sized on the shirt
      const k: CleanArt | null = (keepBg[d.id] ? null : knockOut(img, { keepInside: !!keepInside[d.id] })) || trimClear(img);
      if (k) {
        img = await loadImg(k.url);
        setClean((c) => ({ ...c, [d.id]: k.url }));
        setTrims((t) => ({ ...t, [d.id]: { w: k.box.w, h: k.box.h } }));
        // remember it on the design, so separations and ink estimates size the art, not the box (staff only)
        const art_box = { ...k.box, of: k.of };
        const same = d.art_box && d.art_box.w === art_box.w && d.art_box.h === art_box.h && d.art_box.x === art_box.x && d.art_box.y === art_box.y;
        if (!portal && !keepInside[d.id] && !same && !d.id.startsWith("qt-")) {
          sb.from("designs").update({ art_box }).eq("id", d.id).then(({ error }) => { if (!error) setDesigns((xs) => xs.map((x) => (x.id === d.id ? { ...x, art_box } : x))); });
        }
      }
    }
    imgCache.current.set(d.id, img);
    return img;
  }
  function resetLogo(d: Design) {
    imgCache.current.delete(d.id);
    setTrims((t) => { const n = { ...t }; delete n[d.id]; return n; });
    setClean((c) => { const n = { ...c }; delete n[d.id]; return n; });
    setPaints((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v.design !== d.id)));
  }
  function toggleBg(d: Design) { resetLogo(d); setKeepBg((k) => ({ ...k, [d.id]: !k[d.id] })); }
  const [msg, setMsg] = useState("");
  const autoWant = useRef<Record<string, { colors: number; inks: string }>>({});
  /** the sizes on the order (2T, 3T, 4T…): one screen prints them all, so prints are capped to the smallest */
  const [ordered, setOrdered] = useState<string[]>([]);
  /** the size the mockup is shown on, picked from the sizes ordered (null = the middle size); saved with the mockup */
  const [shownSize, setShownSize] = useState<string | null>(null);
  /** prints whose size the customer specified: changing it asks first ("Are you sure you want to override?") */
  const [sizeOk, setSizeOk] = useState<Record<string, boolean>>({});
  const [sizeAsk, setSizeAsk] = useState<{ id: string; was: string; go?: () => void } | null>(null);
  /** run a size change, unless it's a customer-specified size not yet okayed: then ask (the change waits for the answer) */
  const guardSize = (id: string, go: () => void) => {
    const im = imprints.find((x) => x.id === id);
    if ((im?.sizeFrom === "customer" || im?.sizeFrom === "film") && !sizeOk[id]) { setSizeAsk((a) => a || { id, was: im.size, go }); return; }
    go();
  };
  /** phones: a size check for each print when the mockup opens (keep, or pick a size from a scrolling list), then drag */
  const [sizer, setSizer] = useState<{ ids: string[]; i: number; pick: string | null } | null>(null);
  const sizerShown = useRef(false);
  const autoState = useRef<"" | "saving" | "done" | "stuck">("");
  const saveOk = useRef(false);
  /** the customer's own mockups for this group: shown beside ours as the picture to match */
  const [custMocks, setCustMocks] = useState<{ name: string; url: string; pdf: boolean }[]>([]);
  const [custBig, setCustBig] = useState(false);
  // the shirt designer, opened for one imprint (new design, or editing its logo)
  const [designerFor, setDesignerFor] = useState<{ imId: string; side: Side; shirt: LabShirt | null; start: { doc?: DesignDoc | null; imageUrl?: string; name?: string; at?: { x: number; y: number; w: number } } } | null>(null);
  // quick text typed right into an imprint (shown as a stand-in logo "qt-<imprint>" until the mockup is saved)
  const [qt, setQt] = useState<Record<string, QuickText>>({});
  const qtDone = useRef<Record<string, string>>({});
  const saveRef = useRef<(force?: boolean) => void>(() => {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ title: string; url: string }[]>([]);
  const refreshed = useRef(new Set<number>());
  // Export PDF: art only, or with the company, description and print details (the choice is remembered)
  const [pdfOpen, setPdfOpen] = useState(false), [pdfBusy, setPdfBusy] = useState(false), [pdfDesc, setPdfDesc] = useState("");
  const [pdfOurs, setPdfOurs] = useSticky<boolean>("mk.pdfOurs", true), [pdfCompany, setPdfCompany] = useSticky<boolean>("mk.pdfCompany", true);
  // a style picked from S&S / SanMar that isn't in the catalog yet: pulled in (with its color photos)
  const [lookingUp, setLookingUp] = useState("");
  const tried = useRef(new Set<string>());
  async function lookupStyle(style: string, styleID?: number, supplier?: string): Promise<Garment | null> {
    const key = style.trim().toUpperCase();
    if (!key) return null;
    setLookingUp(key);
    try {
      const r = await fetch(`/api/ss/lookup?${styleID ? `styleid=${styleID}` : `style=${encodeURIComponent(key)}`}${supplier === "sanmar" ? "&supplier=sanmar" : ""}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.garment) { setMsg(j.error || "Couldn't find that style at S&S or SanMar."); return null; }
      const g = j.garment as Garment;
      setCatalog((c) => [...c.filter((x) => x.id !== g.id), g]);
      return g;
    } finally { setLookingUp(""); }
  }

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
          autoWant.current = Object.fromEntries(g.imprints.map((d) => [d.id, { colors: d.colors, inks: d.inks }]));
          setOrdered([...new Set(g.lines.flatMap((l) => Object.entries(l.sizes || {}).filter(([, q]) => +(q || 0) > 0).map(([z]) => z)))]);
          if (g.mockupSize) setShownSize(g.mockupSize);
          const cm = (g.customerMockups || []).slice(0, 4);
          if (cm.length) {
            const { data: su } = await sb.storage.from("proofs").createSignedUrls(cm.map((m) => m.path), 3600);
            setCustMocks(cm.map((m, i) => ({ name: m.name || "Customer mockup", url: su?.[i]?.signedUrl || "", pdf: /\.pdf$/i.test(m.path) })).filter((m) => m.url));
          }
        }
      }
    })();
  }, [sb, orderId, groupId, portal]);

  // art saved without a picture to draw (a PDF / AI from an email made into a design on the server): the preview is
  // made here, once, and kept on the design, so the logo shows on the mockup instead of "No logo yet"
  const madePv = useRef(new Set<string>());
  useEffect(() => {
    if (portal) return;
    for (const d of designs) {
      if (d.preview_path || madePv.current.has(d.id) || !d.file_path || !imprints.some((im) => im.design_id === d.id)) continue;
      madePv.current.add(d.id);
      (async () => {
        const { data: blob } = await sb.storage.from("proofs").download(d.file_path);
        if (!blob) return;
        const pv = await makePreview(new File([blob], d.file_name || "art", { type: d.file_type || blob.type })).catch(() => null);
        if (!pv) return;
        const nd = await setDesignPreview(sb, d, pv).catch(() => null);
        if (!nd) return;
        setDesigns((xs) => xs.map((x) => (x.id === nd.id ? nd : x)));
        const u = await previewUrls(sb, [nd]);
        setUrls((x) => ({ ...x, ...u }));
      })();
    }
  }, [designs, imprints]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ?design=<id>: start with that logo on the shirt (e.g. right after making it in the shirt designer)
  const designParam = useRef(sp.get("design") || "");
  useEffect(() => {
    const id = designParam.current;
    if (!id || !designs.some((d) => d.id === id)) return;
    designParam.current = "";
    setImprints((xs) => {
      if (xs.some((x) => x.design_id === id)) return xs;
      const free = xs.find((x) => !x.design_id);
      if (free) return xs.map((x) => (x === free ? { ...x, design_id: id } : x));
      return [...xs, { ...newImprint("Full Front"), design_id: id }];
    });
  }, [designs]);

  // draw quick text whenever it changes (a moment after typing stops)
  useEffect(() => {
    const t = setTimeout(async () => {
      for (const [imId, q] of Object.entries(qt)) {
        const key = JSON.stringify(q), id = `qt-${imId}`;
        if (qtDone.current[imId] === key) continue;
        qtDone.current[imId] = key;
        const r = q.text.trim() ? await renderQuickText(q) : null;
        if (!r) { setImprints((xs) => xs.map((x) => (x.id === imId && x.design_id === id ? { ...x, design_id: undefined } : x))); continue; }
        imgCache.current.delete(id);
        setUrls((u) => ({ ...u, [id]: r.url }));
        const d: Design = { id, number: 0, customer_id: customerId || null, name: q.text.split("\n")[0].slice(0, 40), file_path: "", file_name: "text.png", file_type: "image/png", preview_path: "", width_px: r.w, height_px: r.h, method: "screen", colors: 1, inks: q.color.name, notes: "", created_by: "", created_at: "" };
        setDesigns((ds) => [d, ...ds.filter((x) => x.id !== id)]);
        setImprints((xs) => xs.map((x) => (x.id === imId ? { ...x, design_id: id, inks: q.color.name, colors: 1 } : x)));
      }
    }, 220);
    return () => clearTimeout(t);
  }, [qt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (Object.keys(qt).length) loadShirtFonts(); }, [qt]);
  const isQuick = (id?: string) => !!id && id.startsWith("qt-");
  /** Switch an imprint between a logo and typed text. */
  function textMode(im: Imprint, on: boolean) {
    setPaints((p) => { const n = { ...p }; delete n[im.id]; return n; });
    if (on) {
      const dark = line ? deltaE(shirtHex(line), "#111111") < 30 : false;
      setQt((q) => ({ ...q, [im.id]: { text: "", font: "Anton", arc: 0, color: dark ? { name: "White", hex: WILFLEX_HEX.White } : { name: "Black", hex: WILFLEX_HEX.Black } } }));
      setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, design_id: undefined } : x)));
    } else {
      setQt((q) => { const n = { ...q }; delete n[im.id]; return n; });
      delete qtDone.current[im.id];
      setImprints((xs) => xs.map((x) => (x.id === im.id && isQuick(x.design_id) ? { ...x, design_id: undefined } : x)));
    }
  }

  // find the colors in each imprint's logo when its design changes
  useEffect(() => {
    imprints.forEach(async (im) => {
      const d = designs.find((x) => x.id === im.design_id);
      if (!d || !urls[d.id] || isQuick(d.id)) return;
      if (paints[im.id]?.design === d.id) return;
      try {
        const img = await logoImg(d);
        // the print plan: saved on the logo (the separation reads the same one), else worked out now and saved
        let plan = (d.print_plan as PrintPlan | null | undefined)?.v === 1 ? d.print_plan as PrintPlan : null;
        if (!plan) {
          plan = planPrint(pxOfImage(img, 1600), { garment: line ? shirtHex(line) : undefined });
          const names = [...new Set(plan.inks.map((k) => k.name))];
          if (!portal) sb.from("designs").update({ print_plan: plan, colors: plan.colors, inks: plan.method === "spot" ? names.join(", ") : `Simulated process (${plan.colors})` }).eq("id", d.id).then(() => {});
          const pl = plan; setDesigns((ds) => ds.map((x) => (x.id === d.id ? { ...x, print_plan: pl } : x)));
        }
        if (plan.method === "spot") {
          // each color of the logo (fade steps and combined colors too) already set to the ink it prints as
          const sources = plan.inks.flatMap((k) => [k.hex, ...(k.also || [])].map((hex) => ({ hex, share: 0 })));
          const map: Paint["map"] = {};
          // inks already named on the order (the customer's proof: "White, PMS 368 C") win over our closest guess:
          // each logo color gets the nearest of those (Oct 9: a guessed PMS 360 C replaced her PMS 368 C)
          const asked = (im.inks || "").split(/\s*[,;+]\s*|\s+\/\s+|\s+and\s+/i).map((z) => z.trim()).filter((z) => z && colorHex(z));
          const rgb = (h: string) => { const v = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0); };
          const dist = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2; };
          const nearestAsked = (hex: string) => asked.slice().sort((a, b) => dist(hex, colorHex(a)!) - dist(hex, colorHex(b)!))[0];
          const useAsked = asked.length > 0 && asked.length >= Math.min(plan.inks.length, asked.length);
          for (const k of plan.inks) {
            const name = useAsked ? nearestAsked(k.hex) : k.name;
            for (const hex of [k.hex, ...(k.also || [])]) map[hex] = { name, hex: colorHex(name) || k.hex };
          }
          const names = useAsked ? asked : [...new Set(plan.inks.map((k) => k.name))];
          setPaints((p) => ({ ...p, [im.id]: { design: d.id, sources, map, unite: true, plan: plan! } }));
          setImprints((xs) => xs.map((x) => (x.id === im.id && x.method !== "dtf" ? { ...x, inks: names.join(", "), colors: useAsked ? asked.length : plan!.colors } : x)));
          return;
        }
        const sources = detectColors(img);
        setPaints((p) => ({ ...p, [im.id]: { design: d.id, sources, map: {}, plan: plan! } }));
        setImprints((xs) => xs.map((x) => (x.id === im.id && x.method !== "dtf" ? { ...x, colors: plan!.colors, inks: x.inks || `Simulated process (${plan!.colors})` } : x)));
      } catch { /* preview not loadable */ }
    });
  }, [imprints, designs, urls, keepBg, keepInside]); // eslint-disable-line react-hooks/exhaustive-deps

  // hovering a suggested color previews it on the mockup before it's picked
  const [hover, setHover] = useState<{ id: string; hexes: string[]; v: { name: string; hex: string } } | null>(null);
  // repaint logos whenever an ink choice changes (or a color is being previewed)
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const im of imprints) {
      const pt = paints[im.id];
      if (!pt) continue;
      const map = hover && hover.id === im.id ? { ...pt.map, ...Object.fromEntries(hover.hexes.map((h) => [h, hover.v])) } : pt.map;
      if (!Object.keys(map).length) continue;
      const img = imgCache.current.get(pt.design);
      if (!img) continue;
      const targets: Record<string, string> = {};
      Object.entries(map).forEach(([src, v]) => { targets[src] = v.name === "none" ? "none" : v.hex; });
      next[im.id] = recolor(img, pt.sources.map((x) => x.hex), targets);
    }
    setPainted(next);
  }, [paints, imprints, hover]);

  // picture files (JPG, PNG…): warn once per logo that they don't print as crisp as vector art
  const [rasterOk, setRasterOk] = useState<Record<string, boolean>>({});
  const [rasterAsk, setRasterAsk] = useState<{ imId: string; d: Design } | null>(null);
  const [rasterBg, setRasterBg] = useState(true);
  function askRaster(imId: string, d: Design) {
    if (isVector(d.file_type, d.file_name) || rasterOk[d.id]) return;
    setRasterBg(!keepBg[d.id]);
    setRasterAsk({ imId, d });
  }

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
  /** Resize a sleeve print (sleeves stay a sleeve: capped at the sleeve's max area). */
  const growTo = (im: Imprint, inches: number) => {
    const v = Math.max(0.5, Math.min(maxWidthFor(im.location, ratioOf(designOf(im))), Math.round(inches * 100) / 100));
    setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, size: `${v}" wide` } : x)));
    return v;
  };
  /** Top-left of a print on the reference shirt (reference px), where it sits now including any hand move. */
  const refPos = (im: Imprint) => {
    const d = designOf(im), r = ratioOf(d) || 0.6;
    const drop = im.drop && !isNaN(+im.drop) ? +im.drop : null;
    const b = basePlacement(im.location, printWidth(im, im.location, ratioOf(d)), r, drop, scale);
    const o = offsets[im.id] || { dx: 0, dy: 0 };
    return { left: b.x + o.dx, top: b.y + o.dy };
  };
  /**
   * Put a print at this size with its top-left here, and let the location follow on its own:
   * drag a small logo to the side and it's a left chest, to the middle a center chest, grow it and it becomes a medium or full front.
   */
  const settle = (im: Imprint, wantW: number, at = refPos(im)) => {
    const sp = spotFor(im.location);
    if (sp.wrap) return growTo(im, wantW);
    const d = designOf(im), r = ratioOf(d) || 0.6;
    const wIn = Math.max(0.5, Math.min(sideMaxWidth(im.location, ratioOf(d)), Math.round(wantW * 100) / 100));
    const ppi = PX_PER_IN * scale;
    const z = autoSpot(im.location, sp.view, (at.left + (wIn * ppi) / 2 - CENTER_X) / ppi, (at.top - COLLAR_Y[sp.view]) / ppi, wIn, wIn * r);
    const drop = im.drop && !isNaN(+im.drop) ? +im.drop : null;
    const nb = basePlacement(z, wIn, r, drop, scale);
    setOffsets((o) => ({ ...o, [im.id]: { dx: at.left - nb.x, dy: at.top - nb.y } }));
    setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, location: z, size: `${wIn}" wide`, keepLocation: false } : x)));
    return wIn;
  };
  /** After typing a size: the width asked for (not cut to the current location), then let the location follow. */
  const settleTyped = (im: Imprint) => {
    if (spotFor(im.location).wrap) return;
    const r = ratioOf(designOf(im)), m = im.size.match(/^([\d.]+)/); if (!m) return;
    const w = /tall/i.test(im.size) ? (r ? +m[1] / r : +m[1]) : +m[1];
    if (w > 0) settle(im, w);
  };
  const settleHere = (id: string) => { const im = imprints.find((x) => x.id === id); if (im && !spotFor(im.location).wrap) settle(im, printWidth(im, im.location, ratioOf(designOf(im)))); };

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
  const artUrl = (im: Imprint) => { const d = designs.find((x) => x.id === im.design_id); return painted[im.id] || (d ? clean[d.id] || urls[d.id] : ""); };

  const garmentFor = (l: Line) => catalog.find((g) => g.style.toLowerCase() === l.style.trim().toLowerCase() && (!l.brand || g.brand.toLowerCase() === l.brand.toLowerCase()))
    || catalog.find((g) => g.style.toLowerCase() === l.style.trim().toLowerCase());

  // a style on the order that isn't in the catalog yet (so no photos): pull it from S&S / SanMar once
  useEffect(() => {
    if (!catalog.length && !orderId) return;
    lines.forEach((l) => {
      const st = l.style.trim();
      if (!st || garmentFor(l) || tried.current.has(st.toUpperCase())) return;
      tried.current.add(st.toUpperCase());
      // SanMar's brands (Port Authority, Sport-Tek, District…) go straight to SanMar
      if (orderId) lookupStyle(st, undefined, /port authority|port & company|sport-?tek|district|ogio|cornerstone|red kap|eddie bauer|new era|travis ?mathew|mercer|nike/i.test(l.brand || "") ? "sanmar" : undefined);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, catalog]);

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
    // SanMar names colors without spaces ("TrueRoyal" for True Royal): matched ignoring spaces and case
    const ci = g?.color_images?.[l.color] || Object.entries(g?.color_images || {}).find(([k]) => colorKey(k) === colorKey(l.color))?.[1];
    const p = ci ? (view === "front" ? ci.front : ci.back) : "";
    return p ? ssImg(p) : teeSvg(guessHex(l.color), view);
  };

  // bags and totes: flat, no collar; measured as a bag and printed centered on the body at real size (Oct 9: totes)
  const isBag = (l?: Line) => { if (!l) return false; const g = garmentFor(l); return /\b(tote|bag|backpack|duffel|cinch|sack|pouch)\b/i.test(`${g?.description || ""} ${l.garment || ""} ${g?.style || ""}`); };
  const bagWidth = (l: Line) => {
    const g = garmentFor(l), sp = g?.specs?.sizes?.OS;
    if (sp?.width && sp.width > 4) return sp.width;
    const m = `${g?.description || ""} ${l.garment || ""}`.match(/(\d+(?:\.\d+)?)\s*["”]?\s*w\b/i);
    return m ? +m[1] : 15;
  };
  const measureFor = (l: Line, img: HTMLImageElement, v: View) => (isBag(l) ? measureBag(img, bagWidth(l)) : measureGarment(img, v));
  // Each S&S photo frames the shirt a little differently: measure the outline once per photo and place everything on it
  const [fits, setFits] = useState<Record<string, Fit | null>>({});
  const fitFor = (l: Line | undefined, v: View) => { if (!l) return null; const u = photo(l, v); return u.startsWith("data:") ? null : fits[u] || null; };
  useEffect(() => {
    for (const l of lines) for (const v of ["front", "back"] as View[]) {
      const u = photo(l, v);
      if (u.startsWith("data:") || u in fits) continue;
      setFits((f) => ({ ...f, [u]: null }));
      loadImg(u).then((img) => { const fit = measureFor(l, img, v); setFits((f) => ({ ...f, [u]: fit })); }).catch(() => {});
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
  // The garment the mockup is shown on: its middle size (2T-5T → 3T, adult → Large) and that size's measurements
  // (supplier size chart, else typical). The photo scale and every print area follow it, so a toddler tee isn't sized
  // like an adult Gildan 5000.
  const runSizes = sortSizes(ordered);
  const bodyFor = (l?: Line): Body => { const g = l ? garmentFor(l) : null; return shownSize && runSizes.includes(shownSize) ? bodyAt(g, shownSize) : bodyOf(g, runSizes); };
  const body = bodyFor(lines[active] || lines[0]);
  const scaleOf = (b: Body) => REF_BODY.widthIn / b.widthIn;
  // a style without its size chart yet: ask S&S once (staff), so the body is measured, not typical
  const askedSpecs = useRef(new Set<string>());
  const shownG = lines[active] || lines[0] ? garmentFor((lines[active] || lines[0])!) : undefined;
  useEffect(() => {
    const g = shownG;
    if (portal || !g || g.specs || !g.ss_style_id || askedSpecs.current.has(g.id)) return;
    askedSpecs.current.add(g.id);
    fetch(`/api/garments/specs?id=${encodeURIComponent(g.id)}`).then((r) => r.json()).then((j) => { if (j?.specs) setCatalog((cs) => cs.map((x) => (x.id === g.id ? { ...x, specs: j.specs } : x))); }).catch(() => null);
  }, [shownG?.id, shownG?.specs]); // eslint-disable-line react-hooks/exhaustive-deps
  // one screen prints every size on the order: sizes and limits follow the smallest size ordered (a 2T), while the
  // picture stays on the middle size (a 3T)
  const capBody = smallestOrdered(shownG, ordered, body);
  const fitBody = (b: Body) => (capBody && capBody.widthIn < b.widthIn ? capBody : b);
  // where a print sits follows the shown size; how big it can be follows the smallest size ordered
  const spotFor = (loc: string, b: Body = body) => {
    const s0 = spotFor0(loc, b), cb = fitBody(b);
    if (cb === b) return s0;
    const c = spotFor0(loc, cb);
    return { ...s0, maxW: Math.min(s0.maxW, c.maxW), maxH: Math.min(s0.maxH, c.maxH), defW: Math.min(s0.defW, c.defW) };
  };
  const maxWidthFor = (loc: string, r: number, b: Body = body) => maxWidthFor0(loc, r, fitBody(b));
  // a size off the job's film was printed before on these same garments: it's kept (up to what the shown size takes)
  const printWidth = (im: Imprint, loc: string, r: number, b: Body = body) => printWidth0(im.size, loc, r, im.sizeFrom === "film" ? b : fitBody(b));
  const sideMaxWidth = (loc: string, r: number, b: Body = body) => sideMaxWidth0(loc, r, fitBody(b));
  const autoSpot = (cur: string, v: View, dx: number, top: number, w: number, h: number) => autoSpot0(cur, v, dx, top, w, h, body);
  const basePlacement = (loc: string, wIn: number, r: number, drop: number | null, sc: number, view?: View, fit?: Fit | null, b: Body = body) => basePlacement0(loc, wIn, r, drop, sc, view, fit, b);
  // the art's own proportions: cropped to what's left after the background came out (this session, or saved on the design)
  const ratioOf = (d?: Design) => {
    const t = d ? trims[d.id] || d.art_box || null : null;
    if (t?.w && t.h) return t.h / t.w;
    return d?.width_px && d?.height_px ? d.height_px / d.width_px : 0;
  };
  /** where a print sits on a photo; `on` = draw it on that garment line (its own size and print areas), else the one shown */
  const place = (im: Imprint, view?: View, fit?: Fit | null, on?: Line) => {
    const d = designOf(im);
    const r = ratioOf(d) || 0.6;
    const bd = on ? bodyFor(on) : body;
    const wIn = printWidth(im, im.location, ratioOf(d), bd);
    const drop = im.drop && !isNaN(+im.drop) ? +im.drop : null;
    const b = basePlacement(im.location, wIn, r, drop, scaleOf(bd), view, fit === undefined ? fitFor(on || line, view || viewsFor(im.location)[0]) : fit, bd);
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
  // one-photo layouts show the side you're working on (sleeves show on the front)
  const shownView: View = curTab === "back" ? "back" : "front";
  const locsFor = (t: Side) => LOCATIONS.filter((z) => sideOf(z) === t);
  const views: View[] = (["front", "back"] as View[]).filter((v) => imprints.some((im) => viewsFor(im.location).includes(v)));
  const line = lines[active] || lines[0];
  // pixels per inch on the photo: S&S shoots every size to fill the frame, so a smaller body means more pixels per inch
  const scale = scaleOf(body);
  const shownOn = body.kind === "adult" ? "an adult Large" : body.size === "YL" ? "a youth Large" : `a ${body.size}`;
  const shirtHex = (l?: Line) => { if (!l) return "#9aa1ab"; const g = garmentFor(l); const ci = g?.color_images?.[l.color] || Object.entries(g?.color_images || {}).find(([k]) => colorKey(k) === colorKey(l.color))?.[1]; return (ci?.hex && /^#?[0-9a-f]{6}$/i.test(ci.hex) ? (ci.hex.startsWith("#") ? ci.hex : "#" + ci.hex) : "") || guessHex(l.color); };

  /** One close-up box for an imprint (used under the photos and, smaller, beside them for the selected tab). */
  const closeUp = (im: Imprint, size: number) => {
                const d = designOf(im); const r = ratioOf(d) || 0.6;
                const wIn = printWidth(im, im.location, ratioOf(d));
                const o = offsets[im.id] || { dx: 0, dy: 0 };
                const sp = spotFor(im.location);
                return (
                  // clicking a close-up brings up its side: the photo (one-photo layouts) and the Imprints tab
                  <div key={im.id + size} className="mk-cu-wrap" onPointerDownCapture={() => { if (sideOf(im.location) !== curTab) setTab(sideOf(im.location)); }}>
                  <CloseUp key={im.id + size} size={size} title={im.location} hex={shirtHex(line)} url={artUrl(im)} wIn={wIn} hIn={wIn * r} colors={inkList(im)}
                    onPick={(rx, ry, x, y) => pickColor(im.id, rx, ry, x, y)}
                    maxW={sp.maxW} maxH={sp.maxH} topAlign={!!sp.top || !!(im.drop && !isNaN(+im.drop))} fold={viewsFor(im.location).length > 1} offIn={{ x: o.dx / (PX_PER_IN * scale), y: o.dy / (PX_PER_IN * scale) }}
                    onMove={(dxIn, dyIn) => setOffsets((q) => ({ ...q, [im.id]: { dx: (q[im.id]?.dx || 0) + dxIn * PX_PER_IN * scale, dy: (q[im.id]?.dy || 0) + dyIn * PX_PER_IN * scale } }))}
                    onResize={(newWIn) => guardSize(im.id, () => { if (sp.wrap) growTo(im, newWIn); else settle(im, newWIn); })}
                    onEnd={() => settleHere(im.id)} />
                  </div>
                );
  };

  /** The shirt photo for one side, lined up with the 12" x 14" full front / full back print area, as the Idea Lab's backdrop. */
  const labShirt = (side: Side): LabShirt | null => {
    if (side === "sleeve" || !line) return null;
    const v = side as View;
    const b = basePlacement(v === "front" ? "Full Front" : "Full Back", 12, 14 / 12, null, scale, v, fitFor(line, v));
    return { src: photo(line, v), hex: shirtHex(line), area: b.area, label: `${v === "front" ? "Front" : "Back"} of the ${[line.color, line.style].filter(Boolean).join(" ") || "shirt"}` };
  };
  /** Where an imprint sits now, in Idea Lab artboard units (50 per inch, 0,0 = top-left of the full print area). */
  const labSpot = (im: Imprint) => {
    const sp = spotFor(im.location); if (sp.wrap) return undefined;
    const d = designOf(im), r = ratioOf(d) || 0.6, wIn = printWidth(im, im.location, ratioOf(d)), ppi = PX_PER_IN * scale, at = refPos(im);
    const leftIn = (at.left - CENTER_X) / ppi, topIn = (at.top - COLLAR_Y[sp.view]) / ppi - 4;
    return { x: 300 + (leftIn + wIn / 2) * 50, y: (topIn + (wIn * r) / 2) * 50, w: wIn * 50 };
  };
  /** Open the Idea Lab on one side of the shirt: for one imprint (edit its art or typed text), or to make something new. */
  async function openLab(side: Side, im?: Imprint) {
    if (!customerId) return setMsg("Pick the customer first. Designs are saved to their account.");
    if (!line?.style) return setMsg("Pick a garment first so the Idea Lab can show the shirt.");
    const shirt = labShirt(side);
    if (!im) return setDesignerFor({ imId: "", side, shirt, start: {} });
    if (qt[im.id]?.text.trim()) return setDesignerFor({ imId: im.id, side, shirt, start: { doc: quickTextDoc(qt[im.id]), name: qt[im.id].text.split("\n")[0].slice(0, 40) } });
    const d = designOf(im);
    if (!d || isQuick(d.id)) return setDesignerFor({ imId: im.id, side, shirt, start: {} });
    const doc = await loadDesignerDoc(sb, d, portal);
    setDesignerFor({ imId: im.id, side, shirt, start: doc ? { doc, name: d.name } : { imageUrl: urls[d.id], name: d.name, at: labSpot(im) } });
  }
  const openDesigner = (im: Imprint) => openLab(sideOf(im.location), im);
  /** A design back from the Idea Lab goes on the shirt where it was drawn: size and spot pick the location. */
  function placeFromLab(side: Side, imId: string, d: Design, box: { x: number; y: number; w: number; h: number }, notes = "") {
    const target = imprints.find((x) => x.id === imId) || imprints.find((x) => sideOf(x.location) === side && !x.design_id && !qt[x.id]);
    const withNotes = (x: Imprint) => (notes ? { ...x, notes } : x);
    if (side === "sleeve") {
      if (target) setImprints((xs) => xs.map((x) => (x.id === target.id ? withNotes({ ...x, design_id: d.id }) : x)));
      else setImprints((xs) => [...xs, withNotes({ ...newImprint("Left Sleeve"), design_id: d.id })]);
      return;
    }
    const v = side as View, ppi = PX_PER_IN * scale;
    const r = d.width_px && d.height_px ? d.height_px / d.width_px : box.h / (box.w || 1);
    const wIn = Math.round((box.w / 50) * 100) / 100, hIn = wIn * r;
    const left = CENTER_X + ((box.x - 300) / 50) * ppi, top = COLLAR_Y[v] + (4 + box.y / 50) * ppi;
    const z = autoSpot(v === "front" ? "Full Front" : "Full Back", v, (box.x + box.w / 2 - 300) / 50, 4 + box.y / 50, wIn, hIn);
    const nb = basePlacement(z, wIn, r, null, scale);
    const id = target?.id || uid();
    setImprints((xs) => target
      ? xs.map((x) => (x.id === id ? withNotes({ ...x, design_id: d.id, location: z, size: `${wIn}" wide`, drop: "" }) : x))
      : [...xs, withNotes({ ...newImprint(z), id, design_id: d.id, size: `${wIn}" wide` })]);
    setOffsets((o) => ({ ...o, [id]: { dx: left - nb.x, dy: top - nb.y } }));
    setTab(side);
  }

  async function uploadNew(im: Imprint, f: File) {
    if (!customerId) return setMsg("Pick the customer first. New art is saved to their account.");
    try {
      let d: Design;
      if (portal) {
        // customers upload straight to storage with a one-time link, then the server records the logo
        const r = await uploadMyLogo(sb, f);
        d = r.design;
        setDesigns((x) => [d, ...x]);
        if (r.url) setUrls((x) => ({ ...x, [d.id]: r.url }));
        setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, design_id: d.id } : x)));
        askRaster(im.id, d);
        setMsg(`Saved ${designLabel(d)} to your logos.`);
        return;
      }
      const { data: u } = await sb.auth.getUser();
      d = await uploadDesign(sb, { file: f, customer_id: customerId, by: u.user?.email || "" });
      setDesigns((x) => [d, ...x]);
      setUrls({ ...urls, ...(await previewUrls(sb, [d])) });
      setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, design_id: d.id } : x)));
      askRaster(im.id, d);
      setMsg(`Saved ${designLabel(d)} to the customer's account.`);
    } catch (e) { setMsg("Upload failed: " + (e instanceof Error ? e.message : String(e))); }
  }

  /** The shirt photos (front, then back) side by side with the art on them, each `k` × the photo size, `gap` px apart. */
  /** `crop` (one view, photo coordinates): draw just that part, at `k`, for a sharp close-up */
  async function photosCanvas(l: Line, k: number, gap: number, vs: View[] = views, crop?: { x: number; y: number; w: number; h: number }): Promise<HTMLCanvasElement> {
    const pw = PHOTO_W * k, ph = PHOTO_H * k, n = Math.max(1, vs.length);
    const c = document.createElement("canvas");
    c.width = Math.round(crop ? crop.w * k : n * pw + (n - 1) * gap); c.height = Math.round(crop ? crop.h * k : ph);
    const main = c.getContext("2d")!;
    main.fillStyle = "#ffffff"; main.fillRect(0, 0, c.width, c.height);
    if (crop) main.translate(-crop.x * k, -crop.y * k);
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i], ox = i * (pw + gap), oy = 0;
      const bg = await loadImg(photo(l, v)).catch(() => loadImg(teeSvg(guessHex(l.color), v)));
      main.drawImage(bg, ox, oy, pw, ph);
      const u = photo(l, v), fit = u.startsWith("data:") ? null : fits[u] || measureFor(l, bg, v);
      // art goes on its own layer, then gets cut to the shirt outline before it's added to the picture
      const layer = document.createElement("canvas"); layer.width = c.width; layer.height = c.height;
      const x = layer.getContext("2d")!;
      if (crop) x.translate(-crop.x * k, -crop.y * k);
      for (const im of imprints.filter((m) => viewsFor(m.location).includes(v))) {
        const p = place(im, v, fit, l);
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
      main.save(); main.setTransform(1, 0, 0, 1, 0, 0); main.drawImage(layer, 0, 0); main.restore();
    }
    return c;
  }

  /** Draw one garment color with every imprint, plus a spec strip, as a PNG. */
  /** bare = just the shirt photos with the art (the thumbnail on the order), no title or spec lines. */
  async function render(l: Line, bare = false): Promise<Blob> {
    const k = bare ? 0.4 : 0.6, pw = PHOTO_W * k, ph = PHOTO_H * k, pad = bare ? 10 : 24, top = bare ? pad : 70;
    const specLines = imprints.map((im) => { const p = place(im); return `${im.location}: ${p.d ? designLabel(p.d) : "no logo"} · ${p.wIn.toFixed(1)}" × ${(p.hIn || 0).toFixed(1)}"${im.inks ? " · " + im.inks : ""}`; });
    const W = pad * 2 + views.length * pw + (views.length - 1) * pad;
    const H = bare ? ph + pad * 2 : 70 + ph + 30 + specLines.length * 26 + pad;
    // the saved proof at twice the size (thumbnails as they were), the photos drawn at that size: sharp when zoomed
    const S = bare ? 1 : 2, c = document.createElement("canvas");
    c.width = W * S; c.height = H * S;
    const x = c.getContext("2d")!;
    x.scale(S, S);
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H);
    if (!bare) {
      x.fillStyle = "#141D2B"; x.font = "700 24px Helvetica, Arial, sans-serif";
      x.fillText(`${order ? `#${order.number} ` : ""}${groupName || "Mockup"}`, pad, 36);
      x.font = "16px Helvetica, Arial, sans-serif"; x.fillStyle = "#4A566B";
      x.fillText([l.brand, l.style, l.garment].filter(Boolean).join(" ") + (l.color ? ` — ${l.color}` : ""), pad, 60);
    }
    { const ph2 = await photosCanvas(l, k * S, pad * S); x.drawImage(ph2, pad, top, ph2.width / S, ph2.height / S); }
    if (!bare) {
      x.fillStyle = "#7A8599"; x.font = "600 13px Helvetica, Arial, sans-serif";
      views.forEach((v, i) => x.fillText(v.toUpperCase(), pad + i * (pw + pad), top + ph + 18));
      x.fillStyle = "#141D2B"; x.font = "15px Helvetica, Arial, sans-serif"; specLines.forEach((s, i) => x.fillText(s, pad, 70 + ph + 44 + i * 26));
    }
    return await new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
  }

  /** A close-up of one print on the shirt: the print area with a little shirt around it, square, `size` px. */
  async function closeUpCanvas(l: Line, im: Imprint, size: number): Promise<HTMLCanvasElement | null> {
    const v = viewsFor(im.location)[0]; if (!v) return null;
    const u = photo(l, v);
    const bg = await loadImg(u).catch(() => loadImg(teeSvg(guessHex(l.color), v)));
    const fit = u.startsWith("data:") ? null : fits[u] || measureFor(l, bg, v);
    const p = place(im, v, fit, l); if (!p.d) return null;
    // the print with a little shirt around it, drawn straight at the size it's shown (not cut from a smaller picture)
    const side = Math.min(PHOTO_W, Math.max(120, Math.max(p.w, p.h) * (p.rot ? 1.35 : 1.12)));
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const crop = { x: Math.max(0, Math.min(PHOTO_W - side, cx - side / 2)), y: Math.max(0, Math.min(PHOTO_H - side, cy - side / 2)), w: side, h: side };
    return photosCanvas(l, size / side, 0, [v], crop);
  }

  /**
   * The customer PDF: one landscape Letter page per garment color: the shirts, a close-up of every print (location,
   * size, inks), and the garment. Our logo and contact, and the customer's company name, are each on or off (an FBS
   * proof with no company name, or the company's own name with no FBS logo, or both).
   */
  async function exportPdf(o: { ours: boolean; company: boolean; description: string }) {
    const todo = lines.filter((z) => z.style || z.color);
    if (!todo.length) return setMsg("Add a garment and color first.");
    if (!imprints.some((im) => designOf(im))) return setMsg("Put a logo on the shirt first.");
    setPdfBusy(true); setMsg("Making the PDF…");
    try {
      await loadShirtFonts().catch(() => {});
      let shop = { name: "FBS Print", phone: "", email: "", address: "", logoUrl: "" };
      if (!portal) { const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle(); if (data?.data) shop = { ...shop, ...(mergeSettings(data.data as Record<string, unknown>).shop || {}) }; }
      const logo = o.ours ? await loadImg(shop.logoUrl || "/brand/fbs-logo.svg").catch(() => null) : null;
      const cust = customers.find((c) => c.id === customerId);
      const DPI = 200, PW = 8.5 * DPI, PH = 11 * DPI, M = 0.45 * DPI;
      const font = (w: number, size: number) => `${w} ${size}px Helvetica, Arial, sans-serif`;
      const ink = "#141D2B", soft = "#5B6678", faint = "#8A93A3", rule = "#DDE2EA";
      const prints = imprints.filter((im) => designOf(im));
      const pages = [];
      for (const l of todo) {
        // drawn at 300 dpi (R × the 200-dpi layout units), every picture made at that size: sharp when zoomed in
        const R = 1.5, c = document.createElement("canvas"); c.width = Math.round(PW * R); c.height = Math.round(PH * R);
        const x = c.getContext("2d")!;
        x.scale(R, R); x.imageSmoothingQuality = "high";
        x.fillStyle = "#ffffff"; x.fillRect(0, 0, PW, PH);
        // header: our logo (left) and/or the customer's company; the date and order on the right
        let top = M;
        const head = o.ours || o.company;
        if (head) {
          let lx = M;
          if (o.ours) {
            if (logo) { const lh = 0.5 * DPI, lw = Math.min(2.4 * DPI, (logo.naturalWidth / (logo.naturalHeight || 1)) * lh || 2 * DPI); x.drawImage(logo, M, M, lw, lh); lx = M + lw + 0.3 * DPI; }
            else { x.fillStyle = ink; x.font = font(800, 40); x.fillText(shop.name, M, M + 40); lx = M + x.measureText(shop.name).width + 0.3 * DPI; }
          }
          if (o.company) {
            if (o.ours) { x.fillStyle = rule; x.fillRect(lx - 0.15 * DPI, M + 4, 3, 0.45 * DPI); }
            x.fillStyle = ink; x.font = font(800, 48); x.fillText(custLabel(cust) || "", lx, M + 44);
          }
          x.textAlign = "right"; x.fillStyle = faint; x.font = font(700, 22); x.fillText("MOCKUP FOR APPROVAL", PW - M, M + 20);
          x.fillStyle = soft; x.font = font(400, 24);
          x.fillText([new Date().toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }), order ? `Order #${order.number}` : ""].filter(Boolean).join("  ·  "), PW - M, M + 54);
          x.textAlign = "left";
          top = M + 0.62 * DPI;
          x.fillStyle = rule; x.fillRect(M, top, PW - 2 * M, 3);
          top += 0.12 * DPI;
        }
        // the mockup's name, the garment and color, and the description
        x.fillStyle = ink; x.font = font(700, 30);
        x.fillText(groupName || "Mockup", M, top + 32);
        x.fillStyle = soft; x.font = font(400, 26);
        const gtxt = [[l.brand, l.style].filter(Boolean).join(" "), l.garment, l.color ? `Color: ${l.color}` : ""].filter(Boolean).join("  ·  ");
        x.fillText(gtxt, M, top + 66);
        let y = top + 66;
        if (o.description.trim()) {
          x.font = font(400, 24); x.fillStyle = soft;
          const words = o.description.trim().split(/\s+/); let row = "", rows = 0;
          for (const w of words) { const t = row ? row + " " + w : w; if (x.measureText(t).width > PW - 2 * M && row) { y += 32; x.fillText(row, M, y); row = w; if (++rows >= 2) break; } else row = t; }
          if (rows < 2 && row) { y += 32; x.fillText(row, M, y); }
        }
        const bodyTop = y + 0.25 * DPI, bodyBot = PH - M - 0.4 * DPI;
        // like the Mockup Creator: the shirts across the top, then each print blown up in its print area below them
        // (the max area dashed, the art at its real size and spot), with its location, size and inks under it
        const cols = prints.length <= 2 ? 2 : 3, rowsN = Math.max(1, Math.ceil(prints.length / cols));
        const cGap = 0.3 * DPI, cellW = (PW - 2 * M - (cols - 1) * cGap) / cols;
        const infoH = 0.7 * DPI;
        const n = Math.max(1, views.length), gap = 0.3 * DPI;
        const shirtH = Math.min(3.7 * DPI, (bodyBot - bodyTop) * (rowsN > 1 ? 0.34 : 0.44));
        const k = Math.min((PW - 2 * M - (n - 1) * gap) / (n * PHOTO_W), shirtH / PHOTO_H);
        const shirtsHi = await photosCanvas(l, k * R, gap * R), shirts = { width: shirtsHi.width / R, height: shirtsHi.height / R };
        const sx = M + (PW - 2 * M - shirts.width) / 2, sy = bodyTop;
        x.drawImage(shirtsHi, sx, sy, shirts.width, shirts.height);
        x.fillStyle = faint; x.font = font(700, 20); x.textAlign = "center";
        const pw = PHOTO_W * k;
        views.forEach((v, i) => x.fillText(v.toUpperCase(), sx + i * (pw + gap) + pw / 2, sy + shirts.height + 28));
        x.textAlign = "left";
        const cuTop = sy + shirts.height + 0.45 * DPI;
        const cellH = (bodyBot - cuTop - (rowsN - 1) * 0.2 * DPI) / rowsN, boxH = cellH - infoH - 0.35 * DPI;
        const shirt = shirtHex(l), darkShirt = deltaE(shirt, "#000000") < 45;
        for (let q = 0; q < prints.length; q++) {
          const im = prints[q], col = q % cols, rw = Math.floor(q / cols);
          // one print alone sits in the middle
          const ox = prints.length === 1 ? M + (PW - 2 * M - cellW) / 2 : M + col * (cellW + cGap), oy = cuTop + rw * (cellH + 0.2 * DPI);
          const d = designOf(im), r = ratioOf(d) || 0.6, wIn = printWidth(im, im.location, ratioOf(d)), hIn = wIn * r;
          const sp = spotFor(im.location), o = offsets[im.id] || { dx: 0, dy: 0 };
          // heading: location and the max print area
          x.fillStyle = ink; x.font = font(800, 22); x.fillText(im.location.toUpperCase(), ox, oy + 20);
          x.fillStyle = faint; x.font = font(400, 19); x.textAlign = "right"; x.fillText(`max ${sp.maxW}" × ${sp.maxH}"`, ox + cellW, oy + 20); x.textAlign = "left";
          // the print area, blown up: the max area plus an inch around it, in the shirt's color
          const spanW = sp.maxW + 2, spanH = sp.maxH + 2, PXI = Math.min(cellW / spanW, boxH / spanH);
          const BW = spanW * PXI, BH = spanH * PXI, bx = ox + (cellW - BW) / 2, by = oy + 34;
          x.save();
          x.beginPath(); x.rect(bx, by, BW, BH); x.clip();
          x.fillStyle = shirt; x.fillRect(bx, by, BW, BH);
          const top0 = (BH - sp.maxH * PXI) / 2, ax = bx + (BW - sp.maxW * PXI) / 2, ay = by + top0;
          x.setLineDash([10, 7]); x.lineWidth = 2.5;
          x.strokeStyle = darkShirt ? "rgba(255,255,255,.55)" : "rgba(0,0,0,.35)"; x.strokeRect(ax, ay, sp.maxW * PXI, sp.maxH * PXI);
          x.setLineDash([]);
          if (viewsFor(im.location).length > 1) {
            // sleeves: the fold (front | back) and the hem
            x.strokeStyle = darkShirt ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.3)"; x.setLineDash([6, 6]); x.beginPath(); x.moveTo(bx + BW / 2, by); x.lineTo(bx + BW / 2, by + BH); x.stroke(); x.setLineDash([]);
            x.strokeStyle = darkShirt ? "rgba(255,255,255,.75)" : "rgba(0,0,0,.45)"; x.lineWidth = 3; x.beginPath(); x.moveTo(bx, ay + sp.maxH * PXI); x.lineTo(bx + BW, ay + sp.maxH * PXI); x.stroke();
          }
          const offX = o.dx / (PX_PER_IN * scale), offY = o.dy / (PX_PER_IN * scale);
          const cx = bx + BW / 2 + offX * PXI, cy = by + (sp.top || (im.drop && !isNaN(+im.drop)) ? top0 + (hIn * PXI) / 2 : BH / 2) + offY * PXI;
          const art = artUrl(im) ? await loadImg(artUrl(im)).catch(() => null) : null;
          if (art) x.drawImage(art, cx - (wIn * PXI) / 2, cy - (hIn * PXI) / 2, wIn * PXI, hIn * PXI);
          x.restore();
          x.strokeStyle = rule; x.lineWidth = 2; x.strokeRect(bx, by, BW, BH);
          // under it: logo, size, inks
          let ty = by + BH + 30;
          x.fillStyle = ink; x.font = font(700, 22); x.fillText(`${wIn.toFixed(2)}" W × ${hIn.toFixed(2)}" H`, bx, ty);
          if (d) { x.fillStyle = soft; x.font = font(400, 19); x.textAlign = "right"; let t = designLabel(d); while (t && x.measureText(t).width > BW * 0.5) t = t.slice(0, -2); x.fillText(t === designLabel(d) ? t : t + "…", bx + BW, ty); x.textAlign = "left"; }
          let ix = bx; ty += 32;
          for (const t of inkList(im).slice(0, 8)) {
            const nm = t.name.startsWith("As uploaded") ? "As uploaded" : t.name.length > 18 ? t.name.slice(0, 17) + "…" : t.name;
            x.font = font(400, 19); const wv = 26 + x.measureText(nm).width + 22;
            if (ix + wv > bx + BW && ix > bx) { ix = bx; ty += 28; }
            if (ty > oy + cellH) break;
            x.fillStyle = t.hex || "#cccccc"; x.fillRect(ix, ty - 15, 16, 16); x.strokeStyle = "#B8C0CC"; x.lineWidth = 1.5; x.strokeRect(ix, ty - 15, 16, 16);
            x.fillStyle = ink; x.fillText(nm, ix + 24, ty); ix += wv;
          }
        }
        // footer: how to reach us (with our logo on)
        if (o.ours) {
          x.fillStyle = rule; x.fillRect(M, PH - M - 52, PW - 2 * M, 2);
          x.fillStyle = soft; x.font = font(600, 19);
          x.fillText([shop.name, shop.phone, shop.email].filter(Boolean).join("  ·  "), M, PH - M - 8);
        }
        x.fillStyle = faint; x.font = font(400, 17); x.textAlign = "right";
        x.fillText("Please check spelling, size, placement and colors.", PW - M, PH - M - 28);
        x.fillText("Screen colors are close to, not exactly, the printed inks.", PW - M, PH - M - 6);
        x.textAlign = "left";
        pages.push(await canvasPage(c, 612, 792, 0.97)); // like Illustrator's High Quality Print: 300 ppi, JPEG at Maximum
      }
      const pdf = imagePdf(pages, `${groupName || "Mockup"}${o.company && cust ? " - " + custLabel(cust) : ""}`);
      const name = `${[o.company ? custLabel(cust) : "", groupName || "mockup"].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "mockup"}.pdf`;
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([pdf as BlobPart], { type: "application/pdf" })); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setMsg(`Downloaded ${name}.`); setPdfOpen(false);
    } catch (e) { setMsg("Couldn't make the PDF: " + (e instanceof Error ? e.message : String(e))); }
    setPdfBusy(false);
  }

  /** Double-click on a design (on the photo or in a close-up): open the ink menu for the logo color under the cursor. */
  async function pickColor(id: string, rx: number, ry: number, cx: number, cy: number) {
                  const im = imprints.find((x) => x.id === id);
                  const d = im && designs.find((x) => x.id === im.design_id);
                  if (!im || !d || !urls[d.id]) return setMsg("Pick a logo for this location first.");
                  let pt = paints[id];
                  let img: HTMLImageElement;
                  try { img = await logoImg(d); } catch { return setMsg("Couldn't read this logo's colors. Try re-uploading it as a PNG."); }
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
    // the AI read this print's size / drop off the customer's mockup: what staff saved teaches it (not in auto mode,
    // where nobody has looked yet)
    if (!auto) for (const im of g.imprints) {
      const ai = im.aiPlace; if (!ai) continue;
      const aw = widthOf(ai.size), sw = widthOf(im.size);
      if (!aw || !sw) continue;
      const lesson: MockupLesson = { location: im.location, garment: ai.garment, kind: ai.kind, ai_w: aw, staff_w: sw, ai_drop: ai.drop ? +ai.drop : null, staff_drop: im.drop && !isNaN(+im.drop) ? +im.drop : null, customer_id: order.customer_id || null };
      const same = Math.abs(aw - sw) < 0.13 && (lesson.ai_drop ?? -1) === (lesson.staff_drop ?? -1);
      sb.from("ai_suggestions").upsert({ dedupe_key: `mockup-lesson:${order.id}:${im.id}`, kind: LESSON_KIND, source: "staff", status: "done", customer_id: order.customer_id || null, order_id: order.id, title: `${im.location} on ${ai.garment}: AI ${ai.size}${ai.drop ? `, ${ai.drop}" down` : ""} → ${im.size}${im.drop ? `, ${im.drop}" down` : ""}`.slice(0, 300), body: same ? "Kept as the AI read it" : "Changed by staff in the Mockup Creator", payload: lesson, decided_at: new Date().toISOString() }, { onConflict: "dedupe_key" }).then(() => {});
    }
    if (mockupSaved) g.mockupAt = new Date().toISOString();
    g.mockupSize = shownSize && runSizes.includes(shownSize) ? shownSize : undefined;
    if (thumbs.length) g.mockupThumbs = thumbs;
    const { error } = await sb.from("orders").update({ groups }).eq("id", order.id);
    if (error) { setMsg("Couldn't update the order: " + error.message); return false; }
    return true;
  }

  /**
   * Create Separations: one separation per screen-print location of this group (front, back, sleeve…), each starting
   * from its logo's print plan, then open the first; the Studio has a tab per location to switch between them.
   * Locations that already have one are opened, not made again.
   */
  async function createSeps() {
    if (!order || saving) return;
    const screen = imprints.filter((im) => im.method === "screen" && im.design_id && !isQuick(im.design_id));
    if (!screen.length) return setMsg("No screen-print location has a logo yet.");
    setSaving(true); setMsg("Making the separations…");
    try {
      if (!(await syncOrder())) throw new Error("Couldn't update the order first.");
      const { data: od } = await sb.from("orders").select("*").eq("id", order.id).maybeSingle();
      const o = (od as Order) || order, gs = orderGroups(o), g = gs.find((x) => x.id === groupId) || gs[0];
      if (!g) throw new Error("Order group not found.");
      const { data: ex } = await sb.from("separations").select("id, imprint_id, location").eq("order_id", o.id).neq("status", "cancelled");
      const have = (ex || []) as { id: string; imprint_id: string | null; location: string }[];
      const missing = g.imprints.filter((im) => im.method === "screen" && im.design_id && !have.some((x) => x.imprint_id === im.id));
      if (missing.length) {
        // behind the art check: the order approved, its proofs approved, the art saved (lib/artGate.ts)
        const r = await fetch("/api/separations/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: o.id, only: missing.map((im) => im.id) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          const why = (j.gate?.reasons as string[] | undefined)?.join(" ") || j.error || "Couldn't make them.";
          if (!have.some((x) => g.imprints.some((im) => im.id === x.imprint_id))) { setMsg("Not ready for separations: " + why); setSaving(false); return; }
        }
        const { data: ex2 } = await sb.from("separations").select("id, imprint_id, location").eq("order_id", o.id).neq("status", "cancelled");
        have.splice(0, have.length, ...((ex2 || []) as typeof have));
      }
      const mine = have.filter((x) => g.imprints.some((im) => im.id === x.imprint_id));
      const rank = (loc: string) => { const l = (loc || "").toLowerCase(); return /sleeve/.test(l) ? 3 : /back|yoke|shoulder/.test(l) ? 2 : 1; };
      const first = mine.sort((a, b) => rank(a.location) - rank(b.location))[0];
      if (!first) throw new Error("No separation to open.");
      location.assign(`/shop/separations/${first.id}`);
    } catch (e) { setMsg("Couldn't make the separations: " + (e instanceof Error ? e.message : String(e))); setSaving(false); }
  }
  saveRef.current = (f?: boolean) => { saveAll(!!f); };
  const autoSave = useRef<() => Promise<boolean>>(async () => false);
  autoSave.current = async () => { saveOk.current = false; await saveAll(true); return saveOk.current; };
  async function saveAll(force = false) {
    if (!customerId) return setMsg("Pick a customer so the mockups save to their account.");
    if (!force && imprints.some((im) => unsetColors(im).length)) { setAskUploaded(true); return; }
    setAskUploaded(false);
    if (!lines.some((l) => l.style || l.color)) return setMsg("Add a garment and color first.");
    if (!imprints.length) return setMsg("Add at least one print location first.");
    const missing = imprints.filter((im) => !designOf(im));
    if (missing.length) return setMsg(`${missing.map((m) => m.location).join(", ")} ${missing.length > 1 ? "have" : "has"} no logo yet. ${portal ? "Pick one of your logos or upload one." : "Pick one of the customer's logos or upload new art."}`);
    // typed text becomes a real logo on the account first (with its Idea Lab layers), then the mockup saves
    const pending = imprints.filter((im) => isQuick(im.design_id) && qt[im.id]?.text.trim());
    if (pending.length) {
      setSaving(true); setMsg("Saving your text…");
      try {
        const { data: u } = portal ? { data: { user: null } } : await sb.auth.getUser();
        const made: Record<string, Design> = {};
        for (const im of pending) {
          const q = qt[im.id], big = await renderQuickText(q, 360);
          if (!big) continue;
          const png = new File([await (await fetch(big.url)).blob()], "text.png", { type: "image/png" });
          const first = q.text.split("\n")[0].slice(0, 40);
          const out: DesignerOut = { svg: png, png, doc: quickTextDoc(q), name: `Text: ${first}`, colors: 1, inks: q.color.name, box: { x: 0, y: 0, w: 0, h: 0 } };
          const r = await saveDesignerLogo(sb, out, { portal, customerId, by: u.user?.email || "" });
          made[im.id] = r.design;
          if (r.url) setUrls((x) => ({ ...x, [r.design.id]: r.url }));
        }
        const ids = Object.keys(made);
        setDesigns((ds) => [...Object.values(made), ...ds.filter((d) => !ids.some((k) => d.id === `qt-${k}`))]);
        setImprints((xs) => xs.map((x) => (made[x.id] ? { ...x, design_id: made[x.id].id } : x)));
        setPaints((p) => ({ ...p, ...Object.fromEntries(ids.map((k) => [k, { design: made[k].id, sources: [{ hex: qt[k].color.hex, share: 1 }], map: { [qt[k].color.hex]: qt[k].color } }])) }));
        setQt((q) => { const n = { ...q }; ids.forEach((k) => { delete n[k]; delete qtDone.current[k]; }); return n; });
      } catch (e) { setSaving(false); return setMsg("Couldn't save your text: " + (e instanceof Error ? e.message : String(e))); }
      setTimeout(() => saveRef.current(true), 400);
      return;
    }
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
      saveOk.current = true;
      setSaved(out);
      setMsg(orderId ? `Saved ${out.length} mockup${out.length > 1 ? "s" : ""} to the order as proofs and to the customer's account.` : `Saved ${out.length} mockup${out.length > 1 ? "s" : ""} to the customer's account.`);
    } catch (e) { setMsg("Couldn't save: " + (e instanceof Error ? e.message : String(e))); }
    setSaving(false);
  }

  // a mockup needs a customer (art and mockups save to their account) and at least one garment
  const ready = !!customerId && lines.some((l) => l.style.trim() && garmentFor(l));
  // a size bigger than the smallest size ordered can take (a 9.5" front on a 2T-4T run) is brought down to the
  // largest that fits, and the print says why (the note goes to the order with the mockup)
  useEffect(() => {
    if (!capBody || !ready) return;
    const fixes: Record<string, { size: string; note: string }> = {};
    for (const im of imprints) {
      const d = designOf(im); if (!d || im.sizeFrom === "customer" || im.sizeFrom === "film") continue; // the customer's own size, or the size printed before (film): not changed
      const r = ratioOf(d) || 0, m = (im.size || "").match(/^([\d.]+)/); if (!m) continue;
      const want = /tall/i.test(im.size) ? (r ? +m[1] / r : +m[1]) : +m[1];
      const cap = Math.floor(sideMaxWidth(im.location, r) * 4) / 4;
      if (want > cap + 0.01) fixes[im.id] = { size: `${cap}" wide`, note: `${cap}" wide: the largest that fits the ${capBody.size}, the smallest size on this order (one screen prints every size). Was ${im.size}.` };
    }
    if (!Object.keys(fixes).length) return;
    setImprints((xs) => xs.map((x) => (fixes[x.id] ? { ...x, size: fixes[x.id].size, notes: [(x.notes || "").replace(/\s*\d+(\.\d+)?" wide: the largest that fits[^.]*\.[^.]*\.( Was [^.]*\.?)?/g, ""), fixes[x.id].note].filter((z) => z.trim()).join(" ").slice(0, 300) } : x)));
  }, [capBody?.size, ready, imprints.map((x) => `${x.id}:${x.size}:${x.design_id}`).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  // on a phone, opening a mockup asks about each print's size first: "Full Front: 9" wide · Keep / Change size"
  useEffect(() => {
    if (sizerShown.current || auto || portal || !ready || typeof window === "undefined") return;
    if (!window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth > 820) return;
    const ids = imprints.filter((im) => designOf(im) && !isQuick(im.design_id)).map((im) => im.id);
    if (!ids.length) return;
    sizerShown.current = true;
    setSizer({ ids, i: 0, pick: null });
  }, [ready, imprints, designs]); // eslint-disable-line react-hooks/exhaustive-deps

  // auto mode (from Inbox → Create order): once the shirt and every logo are loaded, set one-color prints to their
  // ink, save, and move on. Gives up after 30 s with the reason, leaving everything as it is to finish by hand.
  useEffect(() => {
    if (!auto || !order) return;
    const t = setTimeout(() => { if (autoState.current === "") { autoState.current = "stuck"; setMsg("Couldn't build the mockup by itself: the garment or the art didn't load. Check it, then Save."); } }, 30_000);
    return () => clearTimeout(t);
  }, [auto, order]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!auto || !order || !ready || saving || autoState.current === "stuck" || autoState.current === "saving" || autoState.current === "done") return;
    if (!imprints.length || imprints.some((im) => !designOf(im) || paints[im.id]?.design !== im.design_id)) return;
    autoState.current = "saving";
    setMsg("Building our mockup from the customer's art…");
    // one-color prints: every color in the art prints in the ink the order names (e.g. all Black)
    for (const im of imprints) {
      const want = autoWant.current[im.id], pt = paints[im.id];
      if (im.method !== "screen" || !want || want.colors !== 1 || !pt) continue;
      const name = (want.inks || "").split(/[,;\/+]/)[0].trim(), hex = name ? colorHex(name) : null;
      if (hex) setInks(im.id, Object.fromEntries(pt.sources.map((x) => [x.hex, { name, hex }])));
    }
    // a moment for the art to repaint, then save (not cancelled by the re-renders in between)
    const o = order;
    setTimeout(async () => {
      const ok = await autoSave.current();
      if (!ok) { autoState.current = "stuck"; return; }
      autoState.current = "done";
      const gs = orderGroups(o), at = gs.findIndex((x) => x.id === groupId);
      const next = gs.slice(at + 1).find((x) => x.imprints.some((d) => d.design_id) && !x.mockupAt);
      setMsg(next ? "Saved. On to the next group…" : "Saved. Opening the order…");
      setTimeout(() => location.assign(next ? `/shop/artwork/mockup?order=${o.id}&group=${next.id}&auto=1${fromEmail ? `&email=${fromEmail}` : ""}` : `/shop/orders/${o.id}${fromEmail ? `?email=${fromEmail}` : ""}`), 900);
    }, 1800);
  }, [auto, order, ready, saving, imprints, paints, designs, urls]); // eslint-disable-line react-hooks/exhaustive-deps
  const notReady = !customerId ? "Pick a customer first — their designs and mockups live on their account." : "Pick at least one garment to put the art on."
  return (
    <>
      <Link className="back" href={portal ? backHref || "/portal" : orderId ? `/shop/orders/${orderId}` : "/shop/artwork"}>← {portal ? "Dashboard" : orderId ? `Order #${order?.number || ""}` : "Artwork"}</Link>
      <div className="page-head mk-head">
        <div><div className="eyebrow">{custLabel(customers.find((c) => c.id === customerId)) || (portal ? "Your artwork" : "Artwork")}</div><h1>{orderId ? `Mockup · ${groupName}` : "Mockup Creator"}</h1></div>
        <div className="row"><span className="save-state">{msg}</span>{orderId && <button className="btn" type="button" disabled={saving} onClick={async () => { if (await syncOrder()) setMsg("Order updated."); }}>Update order only</button>}{orderId && !portal && imprints.some((im) => im.method === "screen") && <button className="btn" type="button" disabled={saving || !ready} title="A separation for each screen-print location (front, back, sleeve), from each logo's print plan; opens the first" onClick={createSeps}>Create Separations</button>}<button className={"btn" + (pdfOpen ? " on" : "")} type="button" disabled={!ready || pdfBusy} title={ready ? "A PDF of the mockup to send the customer" : notReady} onClick={() => setPdfOpen((o) => !o)}>Export PDF</button><button className="btn primary" type="button" disabled={saving || !ready} title={ready ? undefined : notReady} onClick={() => saveAll()}>{saving ? "Saving…" : orderId ? "Save mockups to order" : "Save mockup"}</button></div>
      </div>

        {pdfOpen && (
          <section className="panel mk-pdf">
            <div className="mk-pdf-h"><b>Export PDF</b><span className="faint">One page per shirt color, ready to send the customer.</span></div>
            <div className="mk-pdf-opts">
              <label className="sep-chk"><input type="checkbox" checked={pdfOurs} onChange={(e) => setPdfOurs(e.target.checked)} /> Our logo &amp; contact (FBS)</label>
              <label className="sep-chk"><input type="checkbox" checked={pdfCompany} onChange={(e) => setPdfCompany(e.target.checked)} /> Company name ({custLabel(customers.find((c) => c.id === customerId)) || "the customer"})</label>
            </div>
            <p className="faint mk-pdf-note">Every page has the shirts, a close-up of each print with its size and inks, and the garment and color.{!pdfOurs && !pdfCompany ? " No names on it." : ""}</p>
            <label className="mk-f mk-pdf-desc"><span>Description (optional)</span><textarea rows={2} placeholder="e.g. Fall fundraiser tee, front chest logo with full back" value={pdfDesc} onChange={(e) => setPdfDesc(e.target.value)} /></label>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn primary" disabled={pdfBusy} onClick={() => exportPdf({ ours: pdfOurs, company: pdfCompany, description: pdfDesc })}>{pdfBusy ? "Making the PDF…" : "Download PDF"}</button>
              <button type="button" className="btn ghost" onClick={() => setPdfOpen(false)}>Close</button>
            </div>
          </section>
        )}
        {!orderId && (
          <section className="panel mk-setup">
            {!portal && <label className="mk-f"><span>Customer</span><select aria-label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Choose a customer…</option>{customers.map((c) => <option key={c.id} value={c.id}>{custLabel(c)}</option>)}</select></label>}
            <label className="mk-f"><span>Mockup name</span><input type="text" aria-label="Mockup name" placeholder="e.g. Spring promo tee" value={groupName} onChange={(e) => setGroupName(e.target.value)} /></label>
            {lines.map((l, i) => {
              const g = garmentFor(l);
              return (
                <div key={l.id} className="mk-f mk-setup-g"><span>{i === 0 ? "Garment & color" : `Color ${i + 1}`}</span><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                  <div className="mk-style">
                    <StylePicker value={l.style} catalog={catalog} busy={!!lookingUp}
                      onType={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, style: v, brand: "", garment: "" } : x)))}
                      onPick={(gg) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, style: gg.style, brand: gg.brand, garment: gg.description, color: gg.colors?.includes(x.color) ? x.color : gg.colors?.[0] || "" } : x)))}
                      onPickSS={async (h) => { const gg = await lookupStyle(h.style, h.styleID || undefined, h.supplier); if (gg) setLines((ls) => ls.map((x, j) => (j === i ? { ...x, style: gg.style, brand: gg.brand, garment: gg.description, color: gg.colors?.includes(x.color) ? x.color : gg.colors?.[0] || "" } : x))); }} />
                    <small className="mk-style-n" data-notranslate>{lookingUp ? "Pulling it in…" : g ? `${g.brand} · ${g.description}` : l.style.trim() ? "Pick a style from the list" : "Type a style #, e.g. 6210, 5000, PC54"}</small>
                  </div>
                  <div className="mk-color"><ColorPicker value={l.color} colors={g?.colors || []} onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, color: v } : x)))} /></div>
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
      <div className={"mk mk-" + mode} ref={mkRef}>
        <div className="mk-stage-wrap">
          <div className={"mk-canvas" + (ready ? "" : " mk-off")} inert={!ready || undefined}>
          {runSizes.length > 1 && (
            <div className="mk-sizes" role="group" aria-label="Show the mockup on">
              <span className="faint">Show on</span>
              {runSizes.map((z) => {
                const on = (shownSize && runSizes.includes(shownSize) ? shownSize : body.size) === z;
                return <button key={z} type="button" className={"chip" + (on ? " on" : "")} aria-pressed={on} title={on ? "The mockup and proof show this size" : `See the same print on a ${z}`} onClick={() => setShownSize(z)}>{z}</button>;
              })}
              <span className="faint mk-sizes-n">{capBody ? `Print sized for the ${capBody.size}` : "Same print size on every size"} · the size picked here is the mockup</span>
            </div>
          )}
          <div className="mk-views">
            {single && (
              <div className="chips mk-viewsw">
                {(["front", "back"] as View[]).map((v) => <button key={v} type="button" className={"chip" + (shownView === v ? " on" : "")} onClick={() => setTab(v)}>{v === "front" ? "Front" : "Back"}</button>)}
              </div>
            )}
            {(single ? [shownView] : (["front", "back"] as View[]).filter((v) => v === "front" || !isBag(line) || imprints.some((im) => viewsFor(im.location).includes("back")))).map((v) => (
              <Stage key={v} grid={grid} cx={fitFor(line, v)?.cx}
                corner={<>
                  {(v === "front" || single) && (
                    <div className="mk-corner l">
                      <label className="mk-pill"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Print areas</label>
                      {Object.keys(offsets).length > 0 && <button className="mk-pill" type="button" onClick={() => setOffsets({})}>Reset positions</button>}
                    </div>
                  )}
                  {(v === "back" || single) && <div className="mk-corner r"><span className="mk-pill" title={`${body.widthIn}" wide × ${body.lengthIn}" long (${body.from === "supplier" ? "the supplier's size chart" : "typical for this size"})`}>Shown on {shownOn}{capBody ? ` · sized for the ${capBody.size}` : ""}</span></div>}
                </>} mask={fitFor(line, v)?.mask} src={line ? photo(line, v) : teeSvg("#9aa1ab", v)} label={v}
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
                  const inches = newW / (PX_PER_IN * scale * old.k);
                  // a size the customer asked for: ask before the first change (the drag stops until they say yes)
                  guardSize(id, () => { if (old.clip) growTo(im, inches); else settle(im, inches); });
                }}
                onEnd={settleHere}
                onPick={pickColor} />
            ))}
          </div>
            <div className="mk-closeups" ref={cuRef} style={{ gridTemplateColumns: `repeat(${cuCols},minmax(0,1fr))` }}>
              {/* front locations first, then back, sleeves always last (in order-form order within each) */}
              {imprints.map((im, i) => ({ im, i })).sort((a, b) => {
                const rank = (x: Imprint) => (viewsFor(x.location).length > 1 ? 2 : spotFor(x.location).view === "back" ? 1 : 0);
                const pos = (x: Imprint) => { const k = LOCATIONS.indexOf(x.location); return k < 0 ? 999 : k; };
                return rank(a.im) - rank(b.im) || pos(a.im) - pos(b.im) || a.i - b.i;
              }).map(({ im }) => closeUp(im, cuSize))}
            </div>
          </div>
          {designerFor && (
            <div className="sd-modal-back" role="dialog" aria-modal="true" aria-label="Idea Lab">
              <div className="sd-modal">
                <ShirtDesigner key={designerFor.side + designerFor.imId} start={designerFor.start} shirt={designerFor.shirt} saveLabel={`Save & put on the ${designerFor.side === "sleeve" ? "sleeve" : designerFor.side}`} onClose={() => setDesignerFor(null)}
                  logos={designs.filter((d) => urls[d.id] && !d.archived_at && !isQuick(d.id)).map((d) => ({ id: d.id, name: designLabel(d), url: urls[d.id] }))}
                  onSave={async (out) => {
                    try {
                      const { data: u } = portal ? { data: { user: null } } : await sb.auth.getUser();
                      const r = await saveDesignerLogo(sb, out, { portal, customerId, by: u.user?.email || "" });
                      setDesigns((x) => [r.design, ...x]);
                      if (r.url) setUrls((x) => ({ ...x, [r.design.id]: r.url }));
                      const imId = designerFor.imId;
                      // names & numbers: the list goes on the imprint's notes for the art team (name · number · size)
                      const rosterNote = out.roster?.length ? `Names & numbers (${out.roster.length}): ${out.roster.map((x) => [x.name, x.number, x.size].filter(Boolean).join(" ")).join("; ")}`.slice(0, 1500) : "";
                      placeFromLab(designerFor.side, imId, r.design, out.box, rosterNote);
                      if (imId) { setQt((q) => { const n = { ...q }; delete n[imId]; return n; }); delete qtDone.current[imId]; setPaints((p) => { const n = { ...p }; delete n[imId]; return n; }); }
                      setDesignerFor(null);
                      setMsg(`Saved ${designLabel(r.design)} to ${portal ? "your" : "the customer's"} logos.`);
                    } catch (e) { return e instanceof Error ? e.message : "Couldn't save the design."; }
                  }} />
              </div>
            </div>
          )}
          {sizeAsk && (() => {
            const im = imprints.find((x) => x.id === sizeAsk.id);
            return (
              <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="cs-t">
                <div className="mk-modal">
                  <h2 id="cs-t">Customer specified size</h2>
                  <p>{im?.sizeFrom === "film" ? <>This job was printed at <b>{sizeAsk.was || "this size"}</b> on the {(im?.location || "print").toLowerCase()} before (the size is off its film).</> : <>The customer asked for <b>{sizeAsk.was || "this size"}</b> on the {(im?.location || "print").toLowerCase()}.</>} Are you sure you want to override it?</p>
                  <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" className="btn primary" onClick={() => setSizeAsk(null)}>Keep their size</button>
                    <button type="button" className="btn danger" onClick={() => { const go = sizeAsk.go; setSizeOk((o) => ({ ...o, [sizeAsk.id]: true })); setImprints((xs) => xs.map((x) => (x.id === sizeAsk.id ? { ...x, notes: [x.notes, x.sizeFrom === "film" ? `Size changed from ${sizeAsk.was} (the film's size)` : `Size changed from the customer's ${sizeAsk.was}`].filter(Boolean).join(". ").slice(0, 300) } : x))); setSizeAsk(null); go?.(); }}>Override</button>
                  </div>
                </div>
              </div>
            );
          })()}
          {sizer && (() => {
            const im = imprints.find((x) => x.id === sizer.ids[sizer.i]);
            if (!im) return null;
            const d = designOf(im), p = place(im), r = ratioOf(d) || 0;
            const cap = Math.max(1, Math.floor(sideMaxWidth(im.location, r) * 4) / 4);
            const cur = Math.round(p.wIn * 4) / 4;
            const steps = Array.from({ length: Math.round((cap - 0.5) / 0.25) + 1 }, (_, k) => 0.5 + k * 0.25);
            const next = () => { if (sizer.i + 1 < sizer.ids.length) setSizer({ ...sizer, i: sizer.i + 1, pick: null }); else { setSizer(null); setMsg("Drag the design to place it. Pinch or the corner handle to fine-tune."); } };
            const fmt = (w: number) => `${w % 1 ? w.toFixed(2).replace(/0$/, "") : w}"`;
            return (
              <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="sz-t">
                <div className="mk-modal mk-sizer">
                  <div className="faint" style={{ fontSize: 12.5 }}>Print {sizer.i + 1} of {sizer.ids.length}</div>
                  <h2 id="sz-t">{im.location}</h2>
                  {(painted[im.id] || (d && urls[d.id])) && <img className="mk-sizer-art" src={painted[im.id] || urls[d!.id]} alt="" />}
                  {sizer.pick == null ? <>
                    <div className="mk-sizer-now"><b>{fmt(cur)}</b> wide<span>× {(p.hIn || 0).toFixed(2)}&quot; tall</span></div>
                    {im.sizeFrom === "customer" && <div className="mk-cust-size">The customer asked for this size.</div>}
                    {im.sizeFrom === "film" && <div className="mk-cust-size">Printed at this size before (from the job&apos;s film).</div>}
                    <div className="mk-sizer-b">
                      <button type="button" className="btn" onClick={() => setSizer({ ...sizer, pick: String(Math.min(cap, Math.max(0.5, cur))) })}>Change size</button>
                      <button type="button" className="btn primary" onClick={next}>Keep {fmt(cur)}</button>
                    </div>
                  </> : <>
                    <label className="mk-sizer-pick">Width
                      <select value={sizer.pick} onChange={(e) => setSizer({ ...sizer, pick: e.target.value })}>
                        {steps.map((w) => <option key={w} value={String(w)}>{fmt(w)} wide</option>)}
                      </select>
                    </label>
                    <div className="faint" style={{ fontSize: 12.5 }}>Up to {fmt(cap)} on the {im.location.toLowerCase()} of this garment.</div>
                    <div className="mk-sizer-b">
                      <button type="button" className="btn" onClick={() => setSizer({ ...sizer, pick: null })}>Back</button>
                      <button type="button" className="btn primary" onClick={() => { const w = +sizer.pick!; guardSize(im.id, () => setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, size: `${w}" wide` } : x)))); setSizer({ ...sizer, pick: null }); }}>OK</button>
                    </div>
                  </>}
                  <button type="button" className="eo-link" style={{ alignSelf: "center" }} onClick={() => { setSizer(null); }}>Skip sizes</button>
                </div>
              </div>
            );
          })()}
          {rasterAsk && (
            <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="rq-t">
              <div className="mk-modal">
                <h2 id="rq-t">This logo is a picture file (JPG / PNG)</h2>
                <p>We highly recommend not printing from JPEGs or other picture files. They don&apos;t produce a sharp, crisp print. Vector art (AI, EPS, PDF or SVG) is best.</p>
                <p className="muted">The only time this might be OK is when the logo prints small, for example on a sponsor-back shirt.</p>
                <p>If you&apos;d like us to go ahead and use this logo, click <b>OK</b>.</p>
                <label className="check"><input type="checkbox" checked={rasterBg} onChange={(e) => setRasterBg(e.target.checked)} /> Remove the background (the white box around the logo)</label>
                <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" className="btn ghost" onClick={() => { const a = rasterAsk; setRasterAsk(null); setImprints((xs) => xs.map((x) => (x.id === a.imId && x.design_id === a.d.id ? { ...x, design_id: undefined } : x))); }}>Choose a different file</button>
                  <button type="button" className="btn primary" autoFocus onClick={() => { const a = rasterAsk; setRasterAsk(null); setRasterOk((r) => ({ ...r, [a.d.id]: true })); if (rasterBg === !!keepBg[a.d.id]) toggleBg(a.d); }}>OK</button>
                </div>
              </div>
            </div>
          )}
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
                  <span className="lbl">{list.length > 1 ? `${list.length} COLORS IN THIS LOGO` : "LOGO COLOR"}</span>
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

        {mode === "wide" && <div className="mk-mini" ref={miniRef}>
          <div className="lbl">{curTab === "sleeve" ? "SLEEVE" : curTab.toUpperCase()} CLOSE-UP</div>
          {imprints.filter((im) => sideOf(im.location) === curTab).map((im) => closeUp(im, miniSize))}
          {!imprints.some((im) => sideOf(im.location) === curTab) && <div className="faint" style={{ fontSize: 12 }}>Add a {curTab === "sleeve" ? "sleeve" : curTab} location to see it up close here.</div>}
        </div>}
        <div className="mk-side stack">
          {custMocks.length > 0 && (
            <section className="panel mk-cust">
              <div className="panel-h"><h2>Customer&apos;s mockup</h2><span className="faint" style={{ fontSize: 12 }}>Match this</span></div>
              <div className="panel-b">
                <div className="mk-cust-row">{custMocks.map((m, i) => m.pdf
                  ? <a key={i} className="mk-cust-pdf" href={m.url} target="_blank" rel="noreferrer">{m.name} (PDF) ↗</a>
                  : <button key={i} type="button" className={"mk-cust-th" + (custBig ? " big" : "")} title="Click to make it bigger" onClick={() => setCustBig((b) => !b)}><img src={m.url} alt={m.name} /></button>)}</div>
                <div className="faint" style={{ fontSize: 12 }}>Location and size were filled in from it where we could read them. Check them against this, then save our mockup.</div>
              </div>
            </section>
          )}
          {/* Idea Lab: design on this side of the shirt (sits above the Imprints panel) */}
          <button type="button" className={"mk-lab" + (ready ? "" : " mk-off")} disabled={!ready} onClick={() => openLab(curTab)}>
            <span className="mk-lab-ic" aria-hidden="true">✦</span>
            <span><b>Add clip art, text, names &amp; numbers to the {curTab === "sleeve" ? "sleeve" : curTab}</b><span>Opens the {curTab === "sleeve" ? "sleeve" : curTab} of this shirt in the Idea Lab: 20,000+ clip art pieces, 1,800 fonts and 60 design ideas. What you make comes right back here.</span></span>
          </button>
          <section className={"panel" + (ready ? "" : " mk-off")} inert={!ready || undefined}>
            <div className="panel-h"><h2>Imprints</h2><div className="row" style={{ gap: 4 }}><button className="btn sm" type="button" onClick={() => { const opts = locsFor(curTab); setImprints([...imprints, newImprint(opts.find((z) => !imprints.some((i) => i.location === z)) || opts[0])]); setTab(curTab); }}title={`Add a ${curTab === "sleeve" ? "sleeve" : curTab} print location`}>+ Add location</button><button className="btn sm" type="button" title="Type words right onto the shirt" onClick={() => {
                const opts = locsFor(curTab), big = curTab === "front" ? "Full Front" : curTab === "back" ? "Full Back" : "";
                const loc = big && !imprints.some((i) => i.location === big) ? big : opts.find((z) => !imprints.some((i) => i.location === z)) || opts[0];
                const im = { ...newImprint(loc), size: big === loc ? '10" wide' : "" };
                setImprints([...imprints, im]); setTab(curTab); textMode(im, true);
              }}>+ Add text</button></div></div>
            <div className="chips mk-tabs">
              {SIDES.map((t) => { const n = imprints.filter((im) => sideOf(im.location) === t.id).length; return <button key={t.id} type="button" className={"chip" + (curTab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>{t.label}{n ? ` (${n})` : ""}</button>; })}
            </div>
            <div className="panel-b stack">
              {imprints.every((im) => sideOf(im.location) !== curTab) && <div className="faint" style={{ fontSize: 13 }}>No {curTab === "sleeve" ? "sleeve" : curTab} prints yet.</div>}
              {imprints.filter((im) => sideOf(im.location) === curTab).map((im) => {
                const p = place(im);
                return (
                  <div key={im.id} className="mk-imp">
                    <div className="mk-imp-top">
                      <select aria-label="Location" className="mk-loc" value={im.location} onChange={(e) => setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, location: e.target.value } : x)))}>{!LOCATIONS.includes(im.location) && <option>{im.location}</option>}{locsFor(curTab).map((z) => <option key={z}>{z}</option>)}</select>
                      <select aria-label={`Decoration method for ${im.location}`} value={im.method} onChange={(e) => { const m = e.target.value as Method; setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, method: m, colors: m === "embroidery" ? Math.min(x.colors, 15) : x.colors } : x))); }}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    </div>
                    <div className="mk-kind" role="group" aria-label="Logo or text">
                      <button type="button" className={qt[im.id] ? "" : "on"} onClick={() => qt[im.id] && textMode(im, false)}>Logo</button>
                      <button type="button" className={qt[im.id] ? "on" : ""} onClick={() => !qt[im.id] && textMode(im, true)}>Text</button>
                    </div>
                    {qt[im.id] ? (() => {
                      const q = qt[im.id];
                      const setQ = (patch: Partial<QuickText>) => setQt((all) => ({ ...all, [im.id]: { ...all[im.id], ...patch } }));
                      return (
                        <div className="mk-qt">
                          <textarea rows={Math.min(4, q.text.split("\n").length + 1)} placeholder="Type your text (Enter for a new line)" value={q.text} onChange={(e) => setQ({ text: e.target.value })} aria-label="Text" autoFocus />
                          <div className="mk-qt-row">
                            <select aria-label="Font" value={q.font} onChange={(e) => setQ({ font: e.target.value })} style={{ fontFamily: `'${q.font}'` }}>
                              {FONTS.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
                            </select>
                            <select aria-label="Curve" value={q.arc} onChange={(e) => setQ({ arc: +e.target.value })} disabled={q.text.includes("\n")} title={q.text.includes("\n") ? "Curves work on one line of text" : undefined}>
                              <option value={0}>Straight</option><option value={1}>Arch ⌒</option><option value={-1}>Smile ‿</option>
                            </select>
                          </div>
                          <div className="mk-qt-row"><span className="sw" style={{ background: q.color.hex }} /><InkSelect value={q.color} onChange={(v) => v && v.name !== "none" && setQ({ color: { name: v.name, hex: v.hex || "#111111" } })} /></div>
                          <button type="button" className="mk-more" onClick={() => openDesigner(im)}>
                            <b>Want to do more with this design?</b>
                            <span>Add clip art, more lines, outlines or a photo in the Idea Lab →</span>
                          </button>
                        </div>
                      );
                    })() : (<>
                    <DesignSearch designs={designs.filter((d) => !isQuick(d.id))} urls={urls} value={im.design_id} placeholder="Pick a logo…"
                      onPick={(d) => { setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, design_id: d?.id || undefined } : x))); if (d) askRaster(im.id, d); }}
                      onStar={async (d, starred) => {
                        setDesigns((ds) => ds.map((x) => (x.id === d.id ? { ...x, starred } : x)));
                        const { error } = portal ? await starMyDesign(d.id, starred).then((r) => ({ error: r.ok ? null : r.error })) : await sb.rpc("set_design_star", { p_design: d.id, p_starred: starred });
                        if (error) setDesigns((ds) => ds.map((x) => (x.id === d.id ? { ...x, starred: !starred } : x)));
                      }} />
                    {!p.d && <div className="ink-warn">Which logo goes on the {im.location}? Pick one{portal ? " of your logos" : " of the customer's logos"}, or upload new art.</div>}
                    {p.d && paints[im.id]?.plan && <div className={"mk-plan" + (paints[im.id].plan!.method === "sim" ? " sim" : "")}><b>How it prints:</b> {paints[im.id].plan!.why}</div>}
                    {p.d && paints[im.id] && paints[im.id].sources.length > 0 && (
                      <LogoColors rows={colorRows(paints[im.id])}
                        onPick={(hexes, v) => { setHover(null); setInks(im.id, Object.fromEntries(hexes.map((h) => [h, v]))); }}
                        onHover={(hexes, v) => setHover(v ? { id: im.id, hexes, v } : null)}
                        onSplit={() => setUnite(im.id, false)}
                        onMatchAll={unsetColors(im).length > 0 ? () => matchStandard(im) : undefined} />
                    )}
                    </>)}
                    <div className="mk-imp-foot">
                      <button type="button" className="btn sm ghost" onClick={() => openDesigner(im)} title="Do more with this design: text, clip art, pictures">{qt[im.id] ? "Idea Lab" : p.d ? "Open in Idea Lab" : "Idea Lab"}</button>
                      <label className="btn sm ghost" style={{ cursor: "pointer" }}>Upload new art<input type="file" hidden accept={DESIGN_ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadNew(im, f); }} /></label>
                      <div className="row mk-wh" style={{ gap: 4 }}>
                        {(() => {
                          const tall = /tall/i.test(im.size);
                          const typed = (im.size.match(/^([\d.]+)/) || [])[1] || "";
                          const set = (v: string, dim: "wide" | "tall") => {
                            let t = v.replace(/[^\d.]/g, "");
                            // cap at the biggest print this side of the shirt takes (sleeves: 3.5" x 3.5"); the location follows when you leave the box
                            const r = ratioOf(designOf(im)) || 0;
                            const capW = sideMaxWidth(im.location, r), cap = dim === "wide" ? capW : capW * (r || 1);
                            if (t && !t.endsWith(".") && +t > cap) t = String(Math.round(cap * 100) / 100);
                            guardSize(im.id, () => setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, size: t ? `${t}" ${dim}` : "" } : x))));
                          };
                          return (
                            <>
                              <label title="Width (proportions locked)">W <input type="text" inputMode="decimal" aria-label="Width in inches" placeholder={p.wIn.toFixed(2)} value={!tall ? typed : p.wIn ? p.wIn.toFixed(2) : ""} onChange={(e) => set(e.target.value, "wide")} onBlur={() => settleTyped(im)} />&quot;</label>
                              <span className="faint">×</span>
                              <label title="Height (proportions locked)">H <input type="text" inputMode="decimal" aria-label="Height in inches" placeholder={(p.hIn || 0).toFixed(2)} value={tall ? typed : p.hIn ? p.hIn.toFixed(2) : ""} onChange={(e) => set(e.target.value, "tall")} onBlur={() => settleTyped(im)} />&quot;</label>
                            </>
                          );
                        })()}
                      </div>
                      {capBody && designOf(im) && im.sizeFrom === "customer" && (() => { const r = ratioOf(designOf(im)) || 0, m = (im.size || "").match(/^([\d.]+)/), want = m ? (/tall/i.test(im.size) ? (r ? +m[1] / r : +m[1]) : +m[1]) : 0, cap = Math.floor(sideMaxWidth(im.location, r) * 4) / 4; return want > cap + 0.01 ? <div className="mk-cust-size">The customer asked for {im.size}, bigger than fits the {capBody.size} ({cap}&quot; max). Check with them.</div> : null; })()}
                      {capBody && designOf(im) && <div className="mk-capnote">Up to {Math.floor(sideMaxWidth(im.location, ratioOf(designOf(im)) || 0) * 4) / 4}&quot; wide: the largest that fits the {capBody.size}, the smallest size ordered (one screen prints every size).</div>}
                      <button className="btn sm ghost danger" type="button" onClick={() => setImprints((xs) => xs.filter((x) => x.id !== im.id))}>Remove location</button>
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
/** The how-to tip shows the first time someone hovers a logo, then never again (remembered in this browser when it can be). */
let tipSeen = false;
const tipWasSeen = () => { if (tipSeen) return true; try { tipSeen = localStorage.getItem("mk-tip-seen") === "1"; } catch { /* private window */ } return tipSeen; };
const markTipSeen = () => { tipSeen = true; try { localStorage.setItem("mk-tip-seen", "1"); } catch { /* private window */ } };

function Stage({ src, label, items, grid, mask, cx, corner, onMove, onResize, onEnd, onPick }: {
  src: string; label: string; /** the shirt's center on this photo, so the label sits under the shirt */ cx?: number; corner?: ReactNode; onEnd?: (id: string) => void; grid?: boolean; /** shirt-shaped mask: art never shows past the edge of the shirt */ mask?: string;
  items: { id: string; p: { x: number; y: number; w: number; h: number; rot: number; clip?: "" | "left" | "right"; area: { x: number; y: number; w: number; h: number } }; url: string }[];
  onMove: (id: string, dx: number, dy: number) => void;
  onResize: (id: string, newW: number) => void;
  onPick: (id: string, relX: number, relY: number, clientX: number, clientY: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; sx: number; sy: number; mode: "move" | "size"; w: number; el?: HTMLElement } | null>(null);
  const [sel, setSel] = useState("");
  const [tip, setTip] = useState("");
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTip = () => { if (tipTimer.current) clearTimeout(tipTimer.current); tipTimer.current = null; setTip((t) => { if (t) markTipSeen(); return ""; }); };
  const lastDown = useRef<{ t: number; x: number; y: number; id: string } | null>(null);
  // phones: the fingers on the photo, and a two-finger pinch that resizes the design being dragged (or selected)
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ id: string; d0: number; w0: number; w: number } | null>(null);
  const [touch, setTouch] = useState(false);
  // the outline and resize handle only show while a design is selected; clicking anywhere else clears it
  useEffect(() => {
    if (!sel) return;
    const off = (e: PointerEvent) => { if (pts.current.size > 0 || pinch.current) return; if (!(e.target as HTMLElement).closest?.(".mk-art")) setSel(""); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [sel]);
  const k = () => (box.current ? box.current.clientWidth / PHOTO_W : 0.42);
  const s = 100 / PHOTO_W, sy = 100 / PHOTO_H;
  return (
    <div className="mk-stage">
      <div ref={box} className="mk-photo" style={{ aspectRatio: `${PHOTO_W} / ${PHOTO_H}` }}
        onPointerDownCapture={(e) => {
          if (e.pointerType === "touch" && !touch) setTouch(true);
          pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          // a second finger: pinch to resize the design under the first one (or the selected one)
          if (pts.current.size === 2) {
            const id = drag.current?.id || sel, it = items.find((x) => x.id === id);
            const [a, b] = [...pts.current.values()];
            if (it) { pinch.current = { id: it.id, d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), w0: it.p.w, w: it.p.w }; setSel(it.id); drag.current = null; }
          }
        }}
        onPointerMove={(e) => {
          if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const pz = pinch.current;
          if (pz && pts.current.size >= 2) {
            const [a, b] = [...pts.current.values()];
            const w = Math.max(12, pz.w0 * (Math.hypot(a.x - b.x, a.y - b.y) / pz.d0));
            if (Math.abs(w - pz.w) > 0.5) { onResize(pz.id, w); pz.w = w; }
            return;
          }
          const d = drag.current; if (!d) return;
          const f = k();
          if (d.mode === "move") onMove(d.id, (e.clientX - d.x) / f, (e.clientY - d.y) / f);
          else { const dw = (e.clientX - d.x) / f; if (d.w + dw > 12) { onResize(d.id, d.w + dw); d.w += dw; } }
          drag.current = { ...d, x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          pts.current.delete(e.pointerId);
          const pz = pinch.current;
          if (pz) { if (pts.current.size < 2) { pinch.current = null; drag.current = null; onEnd?.(pz.id); } return; }
          const d = drag.current; drag.current = null;
          // only after a real drag: a plain click never changes the location
          if (d && onEnd && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) onEnd(d.id);
        }}
        onPointerCancel={(e) => { pts.current.delete(e.pointerId); if (pinch.current && pts.current.size < 2) { const id = pinch.current.id; pinch.current = null; onEnd?.(id); } drag.current = null; }}
        onPointerLeave={(e) => { if (e.pointerType === "touch") return; const d = drag.current; drag.current = null; if (d && onEnd && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) onEnd(d.id); }}
        onPointerDown={(e) => { if (pts.current.size > 1) return; if (e.target === box.current || (e.target as HTMLElement).classList.contains("mk-bg")) setSel(""); }}>
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
            onPointerEnter={() => {
              if (!it.url || tipWasSeen() || tip) return;
              setTip(it.id);
              tipTimer.current = setTimeout(endTip, 4000);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              endTip();
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
              // a finger needs a bigger corner than a mouse
              const corner = Math.max(e.pointerType === "touch" ? 30 : 10, Math.min(el.offsetWidth, el.offsetHeight) * (e.pointerType === "touch" ? 0.3 : 0.18));
              const mode = lx > el.offsetWidth - corner && ly > el.offsetHeight - corner ? "size" : "move";
              if (pts.current.size > 1) return; // second finger of a pinch
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
        {tip && (() => { const it = items.find((x) => x.id === tip); return it ? (
          <div className="mk-hint" style={{ left: `${(it.p.x + it.p.w / 2) * s}%`, top: `${it.p.y * sy}%` }}>{touch ? "Double-tap to change a color" : "Double-click to change a color"}<span>{touch ? "Drag to move · pinch or drag the corner to resize" : "Drag to move · drag the corner to resize"}</span></div>
        ) : null; })()}
        {corner}
      </div>
      <div className="mk-label" style={cx ? { transform: `translateX(${((cx / PHOTO_W) - 0.5) * 100}%)` } : undefined}>{label}</div>
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
function CloseUp({ size, title, hex, url, wIn, hIn, maxW, maxH, fold, topAlign, offIn, colors, onMove, onResize, onEnd, onPick }: {
  size: number; topAlign?: boolean; title: string; hex: string; url: string; wIn: number; hIn: number; maxW: number; maxH: number; fold: boolean; offIn: { x: number; y: number };
  colors: { hex: string; name: string }[];
  onMove: (dxIn: number, dyIn: number) => void; onResize: (newWIn: number) => void; onEnd?: () => void;
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
  const drag = useRef<{ x: number; y: number; mode: "move" | "size"; w: number; moved?: boolean } | null>(null);
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
          drag.current = { ...d, x: e.clientX, y: e.clientY, moved: true };
        }}
        onPointerUp={() => { const d = drag.current; drag.current = null; if (d?.moved) onEnd?.(); }} onPointerLeave={() => { const d = drag.current; drag.current = null; if (d?.moved) onEnd?.(); }}>
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
            const corner = Math.max(e.pointerType === "touch" ? 30 : 10, Math.min(r.width, r.height) * (e.pointerType === "touch" ? 0.3 : 0.18));
            const mode = e.clientX > r.right - corner && e.clientY > r.bottom - corner ? "size" : "move";
            el.setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, mode, w: wIn };
          }}>
          {url ? <img src={url} alt="" draggable={false} /> : "?"}
          {sel && <span className="mk-handle" onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, mode: "size", w: wIn }; }} />}
        </div>
      </div>
      <div className="mk-cu-dim">{url ? <>{wIn.toFixed(2)}&quot; W × {hIn.toFixed(2)}&quot; H</> : "No logo yet"}</div>
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

/**
 * The colors in a logo. A color still "as uploaded" shows the ink dropdown and the Suggested colors box
 * (standard ink and PMS, with how close each is); hovering a suggestion previews it on the mockup.
 * Once a color is picked its row folds up to one tight line, so picked colors stack as a short list.
 */
function LogoColors({ rows, onPick, onHover, onSplit, onMatchAll }: {
  rows: { hexes: string[]; cur?: { name: string; hex: string } }[];
  onPick: (hexes: string[], v: { name: string; hex: string } | null) => void;
  onHover: (hexes: string[], v: { name: string; hex: string } | null) => void;
  onSplit: () => void;
  onMatchAll?: () => void;
}) {
  const [open, setOpen] = useState(""); // a picked color reopened to change it
  const key = (r: { hexes: string[] }) => r.hexes.join();
  const pick = (r: { hexes: string[] }, v: { name: string; hex: string } | null) => { onPick(r.hexes, v); setOpen(""); };
  return (
    <div className="mk-colors">
      <div className="lbl">COLORS IN THIS LOGO</div>
      {rows.map((r) => {
        const cur = r.cur, k = key(r), folded = !!cur && open !== k;
        const swatches = <span className="mk-srcs">{r.hexes.map((h) => <span key={h} className="sw" style={{ background: h }} title={h} />)}</span>;
        if (folded) return (
          <div key={k} className="mk-color tight">
            {swatches}<span className="arrow">→</span>
            <span className="sw" style={{ background: cur!.name === "none" ? "transparent" : cur!.hex }} />
            <span className="mk-cname" title={cur!.name}>{cur!.name === "none" ? "Removed" : cur!.name}{r.hexes.length > 1 ? <span className="faint"> · {r.hexes.length} united</span> : null}</span>
            <button type="button" className="lc-link" onClick={() => setOpen(k)}>Change</button>
            <button type="button" className="lc-reset" title="Back to the color as uploaded" aria-label="Reset to as uploaded" onClick={() => pick(r, null)}>↺</button>
          </div>
        );
        return (
          <div key={k} className="mk-color-wrap">
            <div className="mk-color">
              {swatches}<span className="arrow">→</span>
              <span className="sw" style={{ background: cur ? (cur.name === "none" ? "transparent" : cur.hex) : r.hexes[0] }} />
              <InkSelect value={cur} onChange={(v) => pick(r, v)} />
              {open === k && <button type="button" className="lc-link" onClick={() => setOpen("")}>Done</button>}
            </div>
            {r.hexes.length > 1
              ? <div className="mk-united"><span>{r.hexes.length} colors united · prints as one color</span><button type="button" className="btn sm ghost" onClick={onSplit}>Split</button></div>
              : <Match hex={r.hexes[0]} cur={cur} onPick={(v) => pick(r, v)} onHover={(v) => onHover(r.hexes, v)} />}
          </div>
        );
      })}
      {onMatchAll && <button type="button" className="btn sm" style={{ alignSelf: "flex-start" }} title="Set each color that's still as uploaded to the closest Wilflex RFU ink" onClick={onMatchAll}>Use closest standard inks</button>}
    </div>
  );
}
