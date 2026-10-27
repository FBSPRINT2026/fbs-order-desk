"use client";
import Link from "next/link";
import { stockKind, stockSvg, STOCK_LABEL, type GarmentLook, type StockKind } from "@/lib/stockGarments";
import type { SheetGarment } from "@/app/api/mockup/garment-look/route";
import { locationsFor, brandHitFor, brandSizeFor, changeWord, colorChanges } from "@/lib/pricing";
import { inkOnShirt, onShirtsOf } from "@/components/LogoOnShirts";
import { Suspense, createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LESSON_KIND, widthOf, type MockupLesson } from "@/lib/mockupLessons";
import { LOCATIONS, fitLocation, METHODS, designLabel, mergeSettings, newImprint, orderGroups, printHow, shopNotes, uid, type Customer, type Design, type Garment, type Imprint, type Method, type Order } from "@/lib/pricing";
import { custLabel, parseDate } from "@/lib/format";
import { DESIGN_ACCEPT, previewUrls, setDesignPreview, uploadDesign } from "@/lib/designs";
import { cropFileToArt, makePreview } from "@/lib/artPrep";
import PopularGarments from "@/components/PopularGarments";
import { attachMockupToRequest, mockupLock, mockupUploadUrls, myLogos, portalCatalog, requestGroupSetup, retireMyMockups, saveMyMockup } from "@/app/portal/request-actions";
import { uploadMyLogo } from "@/lib/customerUpload";
import { isVector, knockOut, trimClear, type CleanArt } from "@/lib/artPrep";
import { proofForChange, starMyDesign, submitOwnChange } from "@/app/portal/actions";
import { mockupSpec } from "@/app/shop/ai/actions";
import SalesSheet from "@/components/SalesSheet";
import MockupOrderButton from "@/components/MockupOrderButton";
import { mySheetBrand } from "@/app/portal/settings-actions";
import { garmentPhotoUploadUrl, garmentPhotoUrls } from "@/app/garment-photo-actions";
import CustomerPick from "@/components/CustomerPick";
import { registerMasks, type Reg } from "@/lib/mockupRegister";
import { artFromArtPdf, artFromDrawnMockup, artFromMockupPdf, knockColor, pdfPicture, pmsOnPage, proofNotes } from "@/lib/printavoArt";
import { detectCenter } from "@/lib/visualCenter";
import { tintBase, tintPhoto } from "@/lib/tintPhoto";
import { applyDistress } from "@/lib/distress";
import { PREVIEWABLE_TYPES } from "@/lib/pricing";
import DesignSearch from "@/components/DesignSearch";
import Match from "@/components/InkMatch";
import ShirtDesigner from "@/components/ShirtDesigner";
import { loadDesignerDoc, saveDesignerLogo } from "@/lib/designerSave";
import { FONTS, type DesignDoc } from "@/lib/designerArt";
import { loadShirtFonts, quickTextDoc, renderQuickText, type QuickText } from "@/lib/quickText";
import type { DesignerOut, LabShirt } from "@/components/ShirtDesigner";
import { loadInkFormulas } from "@/lib/inkFormulas";
import { levelBack } from "@/lib/levelBack";
import { maskBehindHood, snapToEdge } from "@/lib/hoodSnap";
import { FULL_WHY, isFullColorWhy } from "@/lib/fullColor";
import { PMS_HEX, STOCK_HEX, WILFLEX_HEX, addStockInks, closestInk, colorHex, deltaE, detectColors, recolorTrim, suggestInk } from "@/lib/inkColors";
import { PMS_COATED } from "@/lib/pms";
import { closestThread, isThreadName, threadLabel } from "@/lib/embroidery";
import { loadThreadStock } from "@/lib/threadStock";
import { stitchLook } from "@/lib/stitchLook";
import EmbroideryPanel from "@/components/EmbroideryPanel";
import { rememberEmbroidery } from "@/lib/embroideryLast";
import { drawNeckView, setFor, type NeckLabelSet } from "@/lib/neckLabels";
import NeckLabelView, { labelFor } from "@/components/NeckLabelView";
import { isRelabel, mainSize } from "@/components/NeckLabelPick";
import { garmentHex, SLEEVE_HEM_GAP, CENTER_X, COLLAR_Y, PHOTO_H, PHOTO_W, PX_PER_IN, REF, REF_NECK, measureBag, neckPicture, autoSpot as autoSpot0, basePlacement as basePlacement0, maxWidthFor as maxWidthFor0, sideMaxWidth as sideMaxWidth0, viewsFor, guessHex, measureGarment, isShortSleeveTee, printWidth as printWidth0, spotFor as spotFor0, type Fit, ssImg, type View, isHeather } from "@/lib/mockup";
import { bodyAt, bodyOf, smallestOrdered, sortSizes, REF_BODY, type Body } from "@/lib/garmentBody";
import { useSticky } from "@/lib/useSticky";
import { canvasPage } from "@/lib/imagePdf";
import { planPrint, pxOfImage, type PrintPlan } from "@/lib/printPlan";
import { ColorPicker, StylePicker } from "@/components/GroupEditor";
import { fmtPhone } from "@/lib/phone";
import { bareStyle } from "@/lib/ai/normalize";

type Line = { id: string; style: string; brand: string; color: string; garment: string;
  /** a garment that isn't in the catalog: the photos they uploaded (storage paths; Oct 24, Nick: "LA Apparel isn't offered at either of those two suppliers") */ own?: { front: string; back?: string };
  /** the shirt's color picked off the photo with the eyedropper (close-ups and logo tiles; Oct 24, Nick) */ hex?: string;
  /** a garment we have no photo of, drawn (Oct 27): what it looks like, read off the customer's mockup (trim, stripes, quilted…) */ look?: GarmentLook };
type Offset = { dx: number; dy: number };
/** Per imprint: colors found in the logo and the ink each one prints as. */
type Side = "front" | "back" | "sleeve";
const SIDES: { id: Side; label: string }[] = [{ id: "front", label: "Front" }, { id: "back", label: "Back" }, { id: "sleeve", label: "Sleeves" }];
type Ink = { name: string; hex: string; /** printed as a halftone of this ink (%), from Combine colors */ tone?: number };
type Paint = { /** the shirt color it was set up for, when the logo has its own ink per shirt color */ shirt?: string; design: string; sources: { hex: string; share: number }[]; map: Record<string, Ink>;
  /** how this logo prints (the same plan the Separation Studio starts from) */ plan?: PrintPlan;
  /** several logo colors set to the same ink: true = print them as one color (one screen), false = keep separate */ unite?: boolean;
  /** drawn from the clean picture: the logo's distress layer turned off */ off?: boolean;
  /** set up for embroidery: each color is a Madeira thread, not an ink (screen prints leave it out) */ method?: "embroidery" };
/** Ink names for the imprint from the logo's color choices (same ink twice counts once when the colors are united). */
const inkNames = (pt: Paint, map = pt.map) => {
  const names = pt.sources.map((x) => map[x.hex]).filter((x) => x && x.name !== "none").map((x) => x!.name);
  return pt.unite === false ? names : [...new Set(names)];
};
/** a color name to compare by: "True Royal", "TrueRoyal" and "true royal" are the same */
const colorKey = (c: string) => (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Rows to show for a logo's colors: united colors that share an ink sit on one row. */
const colorRows = (pt: Paint) => {
  const rows: { hexes: string[]; cur?: Ink; tones: number[] }[] = [];
  for (const x of pt.sources) {
    const cur = pt.map[x.hex];
    const row = pt.unite && cur && cur.name !== "none" ? rows.find((r) => r.cur?.name === cur.name) : undefined;
    if (row) { row.hexes.push(x.hex); if (cur?.tone) row.tones.push(cur.tone); if (row.cur?.tone && !cur?.tone) row.cur = cur; }
    else rows.push({ hexes: [x.hex], cur, tones: cur?.tone ? [cur.tone] : [] });
  }
  return rows;
};
/** a halftone of an ink as it reads on the shirt: the ink thinned toward white (it prints over the underbase) */
const toneHex = (hex: string, pct: number) => {
  const v = hex.replace("#", ""), t = Math.max(5, Math.min(95, pct)) / 100;
  const c = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0).map((x) => Math.round(255 - (255 - x) * t));
  return "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("");
};
/** Inks that more than one logo color is set to. */
const sharedInks = (pt?: Paint) => { if (!pt) return []; const n = pt.sources.map((x) => pt.map[x.hex]?.name).filter((x) => x && x !== "none") as string[]; return [...new Set(n.filter((x, i) => n.indexOf(x) !== i))]; };


/**
 * Design with Canva in the Mockup Creator and the Idea Lab: off (Oct 11, Nick: "just isn't working like I thought,
 * put it on the back burner"). Everything behind it stays (the blank-photo canvas, taking the shirt and page
 * background out of Canva's PDF, putting the art where it was drawn: lib/canva/*, app/api/canva/*). Set to true to
 * bring the buttons back. Canva links in emails (Inbox, Get the design from Canva) and Settings → Canva are separate
 * and still on.
 */
const CANVA_IN_MOCKUP = false;

/** where a photo sits inside the PHOTO_W × PHOTO_H frame when fitted, not stretched (as measured and shown on screen) */
function containRect(img: HTMLImageElement) {
  const iw = img.naturalWidth || PHOTO_W, ih = img.naturalHeight || PHOTO_H, k = Math.min(PHOTO_W / iw, PHOTO_H / ih);
  return { x: (PHOTO_W - iw * k) / 2, y: (PHOTO_H - ih * k) / 2, w: iw * k, h: ih * k };
}
/** the AI picks each new photo's neckline from the pixel finder's lines (off until it beats the pixel finder on Nick's marked photos) */
const NECK_AI = false;

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("Couldn't load " + src.slice(0, 60)));
    im.src = src;
  });
}

/** a picture as a JPEG data URL, at most `max` pixels on its long side (a cut of it when `box` is given, as fractions) */
async function jpegOf(src: string, max = 1400, box?: number[]) {
  const im = await loadImg(src);
  const W = im.naturalWidth, H = im.naturalHeight;
  const [l, t, r, b] = box && box.length === 4 ? box : [0, 0, 1, 1];
  const sx = Math.max(0, l * W), sy = Math.max(0, t * H), sw = Math.max(8, (r - l) * W), sh = Math.max(8, (b - t) * H);
  const k = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement("canvas"); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}
type GarDraw = { front?: string; back?: string };
/** a garment drawn to match the customer's photo by the AI (/api/mockup/garment-draw): its shapes, front and back */
async function drawGarment(image: string, g: { name: string; color: string; kind: string }): Promise<{ draw?: GarDraw; what?: string; error?: string }> {
  try {
    const r = await fetch("/api/mockup/garment-draw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image, name: g.name, color: g.color, kind: g.kind }) });
    const j = await r.json().catch(() => ({})) as { front?: string; back?: string; what?: string; error?: string };
    if (!r.ok || !j.front) return { error: j.error || "Couldn't draw it." };
    return { draw: { front: j.front, ...(j.back ? { back: j.back } : {}) }, what: j.what || "" };
  } catch { return { error: "Couldn't reach the server to draw it." }; }
}

/** Mockup builder: garment photos from S&S for each color, the customer's designs placed by location and print size. */
/**
 * The customer's brand colors (Oct 16, Nick: "a drop down in the mockup creator that has customer colors saved"): first
 * in every ink dropdown, and an "Apply brand standards" pick (a pop-up when a logo's colors come up, and a dropdown under
 * them). Never applied on their own: a customer can have several sets. Set on the customer page.
 */
type BrandInk = { name: string; ink: string; hex: string; group?: string };
type Brand = { label: string; colors: BrandInk[]; groups: { key: string; label: string; colors: BrandInk[] }[] };
const BrandCtx = createContext<Brand>({ label: "", colors: [], groups: [] });
/** a reorder's print still awaiting production, with the old job's color count: that count stays (Oct 20) */
const keepCount = (x: { colors?: number; confirm?: { ink?: boolean } | null; confirmed?: unknown }) => !!x.confirm?.ink && !x.confirmed && (x.colors || 0) > 0;
const nearestBrand = (hex: string, b: { colors: BrandInk[] }) => b.colors.filter((c) => c.hex).map((c) => ({ c, d: deltaE(hex, c.hex) })).sort((x, y) => x.d - y.d)[0];

/** portal = the customer's own builder: their account only, no order, saved through the portal's server actions. */
/** close-ups and the print spec never move off the center of the print area (Oct 22, Nick: "the image always has to be
 *  in the center of the close-ups"); a drag only lines the logo up on the shirt picture */
const NO_OFF = { dx: 0, dy: 0 } as const;
/** every shirt photo shown exactly as the supplier sends it (Oct 22, Nick: "reset the images back to how you first had
 *  them… the fresh images that you pulled in from S&S and SanMar… the same size front to back"): no zoom or shift.
 *  Zooming each photo to a reference shirt made backs lower and bigger than fronts. */
const RAW = { z: 1, tx: 0, ty: 0 };

export default function MockupBuilder({ portal = false, backHref }: { portal?: boolean; backHref?: string }) {
  const sp = useSearchParams();
  const orderId = portal ? "" : sp.get("order") || "";
  const groupId = sp.get("group") || "";
  /** Inbox → Create order: build and save this group's mockup by itself (the art at the size and place the AI read from
   *  the customer's mockup, one-color prints in their ink), then go on to the next group, then the order */
  const auto = sp.get("auto") === "1";
  // made again out of sight after the order check changed the art (OrderReview): save, tell the page, stay put
  const quiet = auto && sp.get("quiet") === "1";
  /** opened from an email (Inbox → Edit details): carried on to the order, which offers "Save & back to email" */
  const fromEmail = sp.get("email") || "";
  /** opened from an AI Workbench mockup card (Oct 22): its customer, garment colors and prints, set up to check and save */
  const wbChat = portal ? "" : sp.get("wb") || "", wbCard = sp.get("card") || "";
  /** a saved mockup opened again to edit (Oct 22, Nick: "we definitely need to be able to edit a mock-up just like on an
   *  order"): its shirts, prints, places and inks as saved; saving again replaces that mockup's pictures */
  const reopenId = sp.get("mockup") || "";
  /** staff previewing a customer's Mockup Creator (?as=): reads that customer's garments and logos */
  const asId = portal ? sp.get("as") || "" : "";
  /** a saved mockup FBS made, or one already on an order: opened to look at, copied to change (Oct 24, Nick) */
  const [lock, setLock] = useState<null | { fbs: boolean; orderNo: number | null }>(null);
  /** a customer making the mockup for an order they're building (Oct 24, Nick: "create mockup… in the imprint screen"):
   *  starts from that group's garments and prints, and goes back into it when saved */
  const requestId = portal ? sp.get("request") || "" : "";
  const mockSet = useRef("");
  const wbInk = useRef<"" | "wait" | "done">(wbChat || reopenId ? "wait" : "");
  /** the customer's art review → "Make changes → change it myself": this proof's shirt and prints, saved back to the shop */
  const changeId = portal ? sp.get("change") || "" : "";
  /** the customer's art review → "See the full proof": the proof's shirt and prints in the Mockup Creator, to look at only */
  const viewId = portal && !changeId ? sp.get("view") || "" : "";
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
  // brand standards: the account's own colors and any groups (a wholesaler's clients); the group whose name is in the
  // order or print group ("43090 ALL MY SONS DALLAS - POLO" → All My Sons) comes first and is the one new logos snap to
  const brand: Brand = useMemo(() => {
    const c = customers.find((x) => x.id === customerId);
    const all = (c?.brand_colors || []).filter((b) => b && b.ink).map((b) => ({ name: b.name || b.ink, ink: b.ink, hex: colorHex(b.ink) || "", group: (b.group || "").trim() }));
    const own = portal ? "Your colors" : `${custLabel(c) || "Customer"} colors`;
    const names = [...new Set(all.map((x) => x.group))];
    const hay = `${order?.nickname || ""} ${groupName}`.toLowerCase();
    const hit = names.filter(Boolean).find((g) => hay.includes(g.toLowerCase())) || "";
    // a group shows by its own name ("Aubrey ISD PMS Colors", "All My Sons"); the ungrouped colors as "<Customer> colors"
    const groups = names.map((g) => ({ key: g, label: g || own, colors: all.filter((x) => x.group === g) }))
      .sort((x, y) => Number(y.key === hit && !!hit) - Number(x.key === hit && !!hit) || Number(!!x.key) - Number(!!y.key));
    // what new logos snap to: the matched group, else the account's own, else the only group there is
    const snap = hit ? groups.find((g) => g.key === hit)! : groups.find((g) => !g.key) || (groups.length === 1 ? groups[0] : null);
    return { label: snap?.label || own, colors: snap?.colors || [], groups };
  }, [customers, customerId, portal, order?.nickname, groupName]);
  const brandRef = useRef(brand); brandRef.current = brand;
  /** the print whose logo colors just came up for a customer with brand standards: the pop-up asks which set to apply */
  const [brandAsk, setBrandAsk] = useState<string | null>(null);
  const brandAsked = useRef(new Set<string>());
  const [change, setChange] = useState<{ orderId: string; orderNumber: number } | null>(null);
  const [active, setActive] = useState(0);
  const [offsets, setOffsets] = useState<Record<string, Offset>>({});
  // a visual-only reorder (Oct 20, Nick: "a reorder mockup helper… production will confirm details on first run…
  // an adjust visual size and placement button"): the print settings are greyed, and the art moves and sizes on the
  // shirt only after "Adjust visual size & placement" (the picture only: production still sets the size on the run)
  const [adjust, setAdjust] = useState(false);
  const [paints, setPaints] = useState<Record<string, Paint>>({});
  const [grid, setGrid] = useState(false);
  const [measure, setMeasure] = useState(false);
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
  // a color change: the art painted in another ink on one garment color (`${imprint id}|${color key}`)
  const [paintedBy, setPaintedBy] = useState<Record<string, string>>({});
  // embroidered prints drawn stitched on the mockup (off shows the flat logo)
  const [stitchOn, setStitchOn] = useSticky<boolean>("mockup.stitchLook", true);
  const stitchRun = useRef(0);
  const stitchCache = useRef(new Map<string, string>());
  /** a print's art cut down to what prints when a color was removed (its proportions; the print size is this art's) */
  const [paintBox, setPaintBox] = useState<Record<string, { w: number; h: number }>>({});
  const imgCache = useRef(new Map<string, HTMLImageElement>());
  // raster logos (JPG, PNG…) on a solid background get it knocked out; staff can keep it per logo
  const [clean, setClean] = useState<Record<string, string>>({});
  const [keepBg, setKeepBg] = useState<Record<string, boolean>>({});
  const [keepInside, setKeepInside] = useState<Record<string, boolean>>({});
  // where the art really is once the background is gone (or a see-through logo's empty margins are cut off): the
  // logo is sized on the shirt by that, not by the old box around it
  const [trims, setTrims] = useState<Record<string, { w: number; h: number }>>({});
  /** The logo image to draw and read colors from: the cleaned-up version when its background was removed. */
  const replan = useRef(new Set<string>());
  async function logoImg(d: Design, clean0 = false): Promise<HTMLImageElement> {
    // a distressed logo printed without its distress: its clean picture (cached apart)
    if (clean0 && urls[d.id + ":clean"]) {
      const k = d.id + ":clean", h = imgCache.current.get(k);
      if (h) return h;
      const im = await loadImg(urls[d.id + ":clean"]);
      imgCache.current.set(k, im);
      return im;
    }
    const hit = imgCache.current.get(d.id);
    if (hit) return hit;
    let img = await loadImg(urls[d.id]);
    const vec = isVector(d.file_type, d.file_name);
    {
      // a logo on a solid background: background out, then cropped to the art. Already see-through (or the background
      // kept on purpose): just the empty margins cut off, so the art itself is what's sized on the shirt. A vector file
      // too, when its art sits on a solid box (Oct 23, Nick on #40113: Tongue in Cheek came on a black background, "you've
      // got to know to remove the background so that you can have that be the shirt color and then size it"): only the
      // box around the art comes out, the same color inside the art stays
      const k: CleanArt | null = (keepBg[d.id] ? null : knockOut(img, { keepInside: vec || !!keepInside[d.id] })) || (vec ? null : trimClear(img));
      if (k) {
        // a vector's box taken out for the first time: its print plan was worked out with the box's color as an ink
        if (vec && !d.art_box) replan.current.add(d.id);
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
  /** the sizes ordered on each garment line (line id → sizes): a style only shows on sizes it was ordered in */
  const [orderedBy, setOrderedBy] = useState<Record<string, string[]>>({});
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
  const [designerFor, setDesignerFor] = useState<{ imId: string; side: Side; shirt: LabShirt | null; start: { doc?: DesignDoc | null; imageUrl?: string; name?: string; at?: { x: number; y: number; w: number }; tool?: "ideas" | "text" | "art" | "upload" | "names" | "ai" | "" } } | null>(null);
  // quick text typed right into an imprint (shown as a stand-in logo "qt-<imprint>" until the mockup is saved)
  const [qt, setQt] = useState<Record<string, QuickText>>({});
  const qtDone = useRef<Record<string, string>>({});
  const saveRef = useRef<(force?: boolean) => void>(() => {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ title: string; url: string }[]>([]);
  /** the customer's mockup just saved (its number and a picture's id): Order it from here (Oct 24, Nick) */
  const [savedMock, setSavedMock] = useState<{ id: string; num: number } | null>(null);
  const refreshed = useRef(new Set<number>());
  // Export PDF: art only, or with the company, description and print details (the choice is remembered)
  const [pdfOpen, setPdfOpen] = useState(false), [pdfBusy, setPdfBusy] = useState(false), [pdfDesc, setPdfDesc] = useState("");
  const [pdfOurs, setPdfOurs] = useSticky<boolean>("mk.pdfOurs", true), [pdfCompany, setPdfCompany] = useSticky<boolean>("mk.pdfCompany", true);
  // a customer's PDF is theirs to brand (Oct 24, Nick: "the point is they can brand something without our logo on it… make
  // those tabs… private label, and then you select your logo"): FBS Print, Private label (their logo and name), or no logo
  const [pdfBrand, setPdfBrand] = useSticky<"fbs" | "private" | "none">("mk.pdfBrand", "private");
  const [pdfFor, setPdfFor] = useState("");
  /** Export PDF's layout (Oct 22, Nick: "like a marketing sheet or a sales sheet… our mock-ups, the front and the back"):
   *  a proof page per color, or a sales sheet with every color on one page */
  const [salesOpen, setSalesOpen] = useState(false), [sheetOpen, setSheetOpen] = useState(false);
  // the Ink Room's other stock inks (Bora Bora Sand, Khaki…) in the ink lists and the closest-ink matching (Oct 22, Nick)
  const [, setStockN] = useState(0);
  useEffect(() => {
    if (portal) return;
    sb.from("stock_inks").select("name, hex, line").eq("stocked", true).is("archived_at", null).order("sort").then(({ data }) => {
      if (!data?.length) return;
      addStockInks(data as { name: string; hex: string; line: string }[]); inkNamesCache = null; setStockN(Object.keys(STOCK_HEX).length);
    });
  }, [portal]); // eslint-disable-line react-hooks/exhaustive-deps
  // the Helper (shop): art that came built onto a mockup, pulled off and walked through before it goes on (Oct 22)
  type HelpRow = { key: string; file: File; url: string; side: "front" | "back" | "sleeve"; location: string; widthIn: number; heightIn: number; dropIn: number; inks: string[]; use: boolean; light: boolean;
    /** the texture laid over it in the file, and how it's distressed here: none, the file's, or the customer's saved mask */
    mask?: File; maskPpi?: number; distress: "none" | "file" | "brand"; dfile?: File; durl?: string };
  // the customer's distress mask (brand standards): Peticolas' scratched texture, fitted over every logo of theirs
  const [brandMask, setBrandMask] = useState<{ path: string; url: string; name: string; layers: number } | null>(null);
  const [bsOpen, setBsOpen] = useSticky("mockup.brandStd", false);
  const [distressing, setDistressing] = useState<string | null>(null);
  useEffect(() => {
    setBrandMask(null);
    if (portal || !customerId) return;
    sb.from("customers").select("brand_print").eq("id", customerId).maybeSingle().then(async ({ data }) => {
      const d = (data?.brand_print as { distress?: { path: string; name?: string; layers?: number } } | null)?.distress;
      if (!d?.path) return;
      const { data: su } = await sb.storage.from("proofs").createSignedUrl(d.path, 3600);
      if (su?.signedUrl) setBrandMask({ path: d.path, url: su.signedUrl, name: d.name || "their mask", layers: d.layers || 3 });
    });
  }, [customerId, portal]); // eslint-disable-line react-hooks/exhaustive-deps
  const [helper, setHelper] = useState<null | { name: string; busy: string; kind?: "photos" | "drawn" | "art"; rows: HelpRow[];
    /** the garments the sheet shows, read by the AI (Oct 27): drawn as the blank when they're not in a catalog */ garments?: SheetGarment[]; gBusy?: boolean; gErr?: string;
    /** the page as a picture (the garments are cut from it to be drawn), and each garment's drawing to match its photo */ pic?: string; gDraw?: Record<number, { busy?: boolean; err?: string; draw?: GarDraw; what?: string }>;
    /** the customer's file itself, and whether it goes on the order as a production file when it's put on (Oct 27, Nick) */ file?: File; keepFile?: boolean; pms: string[]; inkOpts: string[]; err?: string; notes?: { where: string; w?: number; h?: number; colors: string[] }[];
    /** the shirt's color on the file, and how many prints had it inside (taken out: the shirt shows through) */ shirtHex?: string; knocked?: number }>(null);
  const [helpOpen, setHelpOpen] = useSticky("mk.helper", true);
  // opened as the Mockup Helper tool (AI Workbench → Tools, lib/aiTools.ts): the Helper open and in view
  useEffect(() => {
    if (sp.get("helper") !== "1") return;
    setHelpOpen(true);
    const t = setTimeout(() => document.querySelector(".mk-help")?.scrollIntoView({ block: "start", behavior: "smooth" }), 600);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const helpIn = useRef<HTMLInputElement>(null);
  // an old job's mockup to read (Customer artwork → Search old orders → "open with the Helper", Oct 24): handed to the
  // Helper once the order and its customer are loaded
  const helperFile = useRef(portal ? "" : sp.get("helperFile") || "");
  useEffect(() => {
    const path = helperFile.current;
    if (!path || !customerId || (orderId && !order)) return;
    helperFile.current = "";
    void (async () => {
      const { data } = await sb.storage.from("proofs").download(path);
      if (!data) { setHelper({ name: path.split("/").pop() || "the old mockup", busy: "", rows: [], pms: [], inkOpts: [], err: "Couldn't open the old job's file." }); return; }
      const name = path.split("/").pop() || "old-mockup.pdf";
      await helperRead(new File([data], name, { type: data.type || "application/pdf" }));
      setTimeout(() => document.querySelector(".mk-help")?.scrollIntoView({ block: "start", behavior: "smooth" }), 300);
    })();
  }, [customerId, order]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sheetShop, setSheetShop] = useState<{ name: string; line: string; logoUrl: string }>({ name: "FBS Print", line: "", logoUrl: "/brand/fbs-logo.svg" });
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

  // a saved mockup opened again to edit, in the shop or the customer's portal (row security: a customer only reads their own)
  async function reopenMockup() {
    const { data: mk } = await sb.from("mockups").select("customer_id, title, snapshot").eq("id", reopenId).maybeSingle();
    const snap = (mk?.snapshot || null) as { set?: string; name?: string; lines?: Line[]; imprints?: Imprint[]; offsets?: Record<string, Offset>; mockupSize?: string | null } | null;
    if (!mk || !snap?.lines?.length) { wbInk.current = "done"; setMsg(mk ? "This mockup was saved before mockups kept their setup, so it can't be opened to edit. Make it again and save: from now on it can be." : "That mockup isn't there anymore."); }
    else {
      mockSet.current = snap.set || reopenId;
      setCustomerId((mk.customer_id as string) || "");
      setGroupName(snap.name || String(mk.title || "").split(" — ")[0]);
      setLines(snap.lines);
      setImprints((snap.imprints || []).map((d) => ({ ...d })));
      setOffsets(snap.offsets || {});
      if (snap.mockupSize) setShownSize(snap.mockupSize);
      // prints with an ink but no saved logo colors (a setup rebuilt from the pictures): painted in that ink
      autoWant.current = Object.fromEntries((snap.imprints || []).filter((d) => !d.inkMap).map((d) => [d.id, { colors: d.colors, inks: d.inks }]));
      setMsg("Editing the saved mockup. Save Mockup replaces it.");
      if (portal) {
        const l = await mockupLock(reopenId, asId);
        if (l.ok && (l.fbs || l.orderNo)) { setLock({ fbs: !!l.fbs, orderNo: l.orderNo ?? null }); setMsg(""); }
      }
    }
  }
  /** their own copy of a locked mockup: a new mockup with the same setup, saved under its own name */
  function copyLocked() {
    mockSet.current = crypto.randomUUID();
    setGroupName((n) => `${(n || "Mockup").replace(/\s*\(my copy\)$/i, "")} (my copy)`.slice(0, 120));
    setLock(null);
    setMsg("This is your copy. Change anything, then Save Mockup to keep it as a new mockup. The original stays as it was.");
  }
  // load the order group (or start blank), catalog and customers. Opened from an order and the order still isn't here
  // after 8 seconds (a read that never came back: Oct 23, Nick on #40112 from Create order, "it just got stuck…
  // it says pick a customer"): it's loaded again, twice at most
  const [loadTry, setLoadTry] = useState(0);
  useEffect(() => {
    if (!orderId || portal || order || loadTry >= 2) return;
    const t = setTimeout(() => { setMsg("Loading the order again…"); setLoadTry((n) => n + 1); }, 8000);
    return () => clearTimeout(t);
  }, [orderId, portal, order, loadTry]);
  useEffect(() => {
    (async () => {
      if (portal) {
        // the customer's own account; catalog comes without our costs
        const [cat, cu] = await Promise.all([portalCatalog(asId), asId ? sb.from("customers").select("*").eq("id", asId) : sb.from("customers").select("*")]);
        setCatalog(cat as unknown as Garment[]);
        const mine = (cu.data || []) as Customer[];
        setCustomers(mine);
        if (mine[0]) setCustomerId(mine[0].id);
        // their saved mockup opened to edit (Oct 24, Nick: "they click on the mockup and they can either edit it or…")
        if (reopenId && !changeId && !viewId) { await reopenMockup(); return; }
        if (requestId && groupId && !changeId && !viewId) {
          const r = await requestGroupSetup(requestId, groupId);
          if (!r.ok) { setMsg(r.error); return; }
          if (r.name) setGroupName(r.name);
          if (r.lines.length) setLines(r.lines);
          if (r.imprints.some((d) => d.design_id)) {
            setImprints(r.imprints.map((d) => ({ ...d })));
            autoWant.current = Object.fromEntries(r.imprints.map((d) => [d.id, { colors: d.colors, inks: d.inks }]));
          }
          setMsg("Make the mockup for your order. Save it and it goes right into the order.");
          return;
        }
        if (changeId || viewId) {
          const r = await proofForChange(changeId || viewId, !!viewId);
          if (!r.ok) { setMsg(r.error); return; }
          setChange({ orderId: r.orderId, orderNumber: r.orderNumber });
          setGroupName(r.groupName);
          setLines(r.lines);
          setImprints(r.imprints.map((d) => ({ ...d })));
          autoWant.current = Object.fromEntries(r.imprints.map((d) => [d.id, { colors: d.colors, inks: d.inks }]));
          setOrdered(r.ordered);
          if (r.mockupSize) setShownSize(r.mockupSize);
        }
        return;
      }
      const [cat, cu] = await Promise.all([sb.from("garments").select("*"), sb.from("customers").select("*")]);
      setCatalog((cat.data || []) as Garment[]);
      setCustomers(((cu.data || []) as Customer[]).sort((a, b) => custLabel(a).localeCompare(custLabel(b))));
      if (!orderId && reopenId) await reopenMockup();
      if (!orderId && wbChat && wbCard) {
        const r = await mockupSpec(wbChat, wbCard);
        if (!r.ok) { wbInk.current = "done"; return setMsg(r.error); }
        setCustomerId(r.customerId);
        setLines(r.lines);
        setImprints(r.imprints.map((d) => ({ ...d })));
        autoWant.current = Object.fromEntries(r.imprints.map((d) => [d.id, { colors: d.colors, inks: d.inks }]));
        setMsg("Set up by the AI Workbench. Check it, then Save Mockup.");
      }
      if (orderId) {
        const { data } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
        if (!data) return setMsg("Order not found.");
        const o = data as Order;
        setOrder(o);
        if (loadTry) setMsg("");
        setCustomerId(o.customer_id || "");
        const groups = orderGroups(o);
        const g = groups.find((x) => x.id === groupId) || groups[0];
        if (g) {
          setGroupName(g.name || `Group ${groups.indexOf(g) + 1}`);
          // one mockup per garment: the same style and color twice (their extras line under it) is one shirt, not two
          // identical mockups (Oct 22: #40104 and #40106 each got the same Red / Charcoal mockup twice)
          const seenSC = new Set<string>();
          setLines(g.lines.filter((l) => l.style || l.color).filter((l) => { const k = `${(l.style || "").trim().toLowerCase()}|${(l.color || "").trim().toLowerCase()}`; if (seenSC.has(k)) return false; seenSC.add(k); return true; }).map((l) => ({ id: l.id, style: l.style, brand: l.brand, color: l.color, garment: l.garment, ...(l.look ? { look: l.look } : {}) })));
          setImprints(g.imprints.map((d) => ({ ...d })));
          loadedIms.current = Object.fromEntries(g.imprints.map((d) => [d.id, JSON.parse(JSON.stringify(d)) as Imprint]));
          autoWant.current = Object.fromEntries(g.imprints.map((d) => [d.id, { colors: d.colors, inks: d.inks }]));
          setOrdered([...new Set(g.lines.flatMap((l) => Object.entries(l.sizes || {}).filter(([, q]) => +(q || 0) > 0).map(([z]) => z)))]);
          setOrderedBy(Object.fromEntries(g.lines.map((l) => [l.id, Object.entries(l.sizes || {}).filter(([, q]) => +(q || 0) > 0).map(([z]) => z)])));
          if (g.mockupSize) setShownSize(g.mockupSize);
          if (g.mockupOffsets) setOffsets(g.mockupOffsets);
          const cm = (g.customerMockups || []).slice(0, 4);
          if (cm.length) {
            const { data: su } = await sb.storage.from("proofs").createSignedUrls(cm.map((m) => m.path), 3600);
            setCustMocks(cm.map((m, i) => ({ name: m.name || "Customer mockup", url: su?.[i]?.signedUrl || "", pdf: /\.pdf$/i.test(m.path) })).filter((m) => m.url));
          }
        }
      }
    })().catch((e) => setMsg(`Couldn't load it: ${e instanceof Error ? e.message : String(e)}. Refresh the page.`));
  }, [sb, orderId, groupId, portal, changeId, viewId, wbChat, wbCard, reopenId, loadTry]);

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

  // the customer's designs; again when the order check (on the right) changes a logo's art, so the shirt shows it
  // (Oct 23, Nick: "I asked it to remove the white outline and… it didn't update the mock-up on the left")
  const [artTick, setArtTick] = useState(0);
  const fileOf = useRef<Record<string, string>>({});
  /** each print as it was when the order was opened here: only what's changed here goes back to the order */
  const loadedIms = useRef<Record<string, Imprint>>({});
  useEffect(() => {
    const on = async () => {
      setArtTick((t) => t + 1);
      // and the order's prints and garments as changed there (inks, colors, size, drop), into what's on the screen
      if (!orderId) return;
      const { data } = await sb.from("orders").select("groups, lines").eq("id", orderId).maybeSingle();
      const g = data ? orderGroups(data as Order).find((x) => x.id === groupId) || orderGroups(data as Order)[0] : null;
      if (!g) return;
      setImprints((xs) => xs.map((x) => { const n = g.imprints.find((y) => y.id === x.id); return n ? { ...x, inks: n.inks, colors: n.colors, size: n.size, drop: n.drop, location: n.location, underbase: n.underbase, inkMap: n.inkMap, design_id: n.design_id } : x; }));
      // the logo's picked inks (the color dropdowns and the paint on the shirt) follow (Oct 23: "change the white screen to
      // yellow"… the order said Yellow, the shirt here stayed white)
      for (const n of g.imprints) if (n.inkMap?.map && n.inkMap.design === n.design_id) setInks(n.id, Object.fromEntries(Object.entries(n.inkMap.map).map(([k, v]) => [k, { name: v.name, hex: v.hex }])));
      setLines((ls) => ls.map((l) => { const n = g.lines.find((y) => y.id === l.id); return n ? { ...l, color: n.color, style: n.style, brand: n.brand } : l; }));
    };
    window.addEventListener("fbs:order-changed", on);
    return () => window.removeEventListener("fbs:order-changed", on);
  }, []);
  useEffect(() => {
    (async () => {
      if (!customerId) { setDesigns([]); setUrls({}); return; }
      if (portal) {
        const r = await myLogos(asId);
        if (r.ok) { setDesigns(r.designs as Design[]); setUrls(r.urls); } else setMsg(r.error);
        return;
      }
      const { data } = await sb.from("designs").select("*").eq("customer_id", customerId).order("number", { ascending: false });
      const list = (data || []) as Design[];
      // a logo whose picture changed (the Order chat's or Brand standards' art changes: distress, one black…): its cached
      // picture and its painted colors are dropped, so the shirt is drawn from the new file (Oct 23, Nick on #40133: the
      // distress was on the logo, the shirt didn't show it)
      const changed = list.filter((d) => fileOf.current[d.id] && fileOf.current[d.id] !== (d.preview_path || d.file_path)).map((d) => d.id);
      for (const d of list) fileOf.current[d.id] = d.preview_path || d.file_path;
      if (changed.length) {
        for (const id of changed) { imgCache.current.delete(id); imgCache.current.delete(id + ":clean"); }
        setClean((c) => { const n = { ...c }; for (const id of changed) delete n[id]; return n; });
        setPaints((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => !changed.includes(v.design))));
      }
      setDesigns(list);
      setUrls(await previewUrls(sb, list));
    })();
  }, [sb, customerId, portal, artTick]);

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
      // a logo with its own ink per shirt color is set up again when the shirt color changes
      const sh = onShirtsOf(d).length ? (line?.color || "") : "";
      const off = im.distress === "off" && !!urls[d.id + ":clean"];
      const emb = im.method === "embroidery";
      if (paints[im.id]?.design === d.id && (paints[im.id]?.shirt || "") === sh && !!paints[im.id]?.off === off && (paints[im.id]?.method === "embroidery") === emb) return;
      // every PMS the Ink Room has, before the order's inks are matched to the logo's colors (PMS 2178 C, HALFF #40119)
      if (!portal) await loadInkFormulas(sb).catch(() => 0);
      try {
        const img = await logoImg(d, off);
        // the print plan: saved on the logo (the separation reads the same one), else worked out now and saved
        let plan = (d.print_plan as PrintPlan | null | undefined)?.v === 1 && !replan.current.has(d.id) ? d.print_plan as PrintPlan : null;
        replan.current.delete(d.id);
        if (!plan) {
          plan = planPrint(pxOfImage(img, 1600), { garment: line ? shirtHex(line) : undefined });
          const names = [...new Set(plan.inks.map((k) => k.name))];
          if (!portal) sb.from("designs").update({ print_plan: plan, colors: plan.colors, inks: plan.method === "spot" ? names.join(", ") : `Simulated process (${plan.colors})` }).eq("id", d.id).then(() => {});
          const pl = plan; setDesigns((ds) => ds.map((x) => (x.id === d.id ? { ...x, print_plan: pl } : x)));
        }
        // embroidery (Oct 23, Nick: "we're no longer picking colors or PMS colors, we're picking threads… Madeira"): each
        // color of the logo is the closest Madeira thread (or the thread saved on the print), its own path apart from
        // the inks below
        if (emb) {
          const rgbE = (h: string) => { const v = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0); };
          const far = (a: string, b: string) => { const x = rgbE(a), y = rgbE(b); return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2; };
          const groups: { hex: string; also: string[] }[] = plan.method === "spot" ? plan.inks.map((k) => ({ hex: k.hex, also: k.also || [] })) : detectColors(img, 12).map((x) => ({ hex: x.hex, also: [] }));
          const sources = groups.flatMap((k) => [k.hex, ...k.also].map((hex) => ({ hex, share: 0 })));
          const saved = im.inkMap?.design === d.id ? im.inkMap.map : null;
          const stock = portal ? new Set<string>() : await loadThreadStock(sb).catch(() => new Set<string>());
          const map: Paint["map"] = {};
          for (const k of groups) {
            const was = saved?.[k.hex] && (isThreadName(saved[k.hex].name) || saved[k.hex].name === "none") ? saved[k.hex] : null;
            // the shirt's own color isn't sewn (not on a heather)
            const own = groups.length > 1 && !!line?.color && !isHeather(line.color) && far(k.hex, shirtHex(line)) < 45 ** 2;
            const t = was ? null : closestThread(k.hex, { line: im.emb?.line, stock });
            const pick = was || (own ? { name: "none", hex: k.hex } : t ? { name: threadLabel(t), hex: t.hex } : { name: "none", hex: k.hex });
            for (const hex of [k.hex, ...k.also]) map[hex] = saved?.[hex] && isThreadName(saved[hex].name) ? saved[hex] : pick;
          }
          setPaints((p) => ({ ...p, [im.id]: { design: d.id, shirt: sh, sources, map, unite: true, plan: plan!, off, method: "embroidery" } }));
          const names = [...new Set(Object.values(map).map((v) => v.name).filter((n) => n && n !== "none"))];
          setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, inks: names.join(", "), colors: Math.max(1, names.length) } : x)));
          return;
        }
        if (plan.method === "spot") {
          // each color of the logo (fade steps and combined colors too) already set to the ink it prints as
          const sources = plan.inks.flatMap((k) => [k.hex, ...(k.also || [])].map((hex) => ({ hex, share: 0 })));
          const map: Paint["map"] = {};
          // inks already named on the order (the customer's proof: "White, PMS 368 C") win over our closest guess:
          // each logo color gets the nearest of those (Oct 9: a guessed PMS 360 C replaced her PMS 368 C)
          const named = (im.inks || "").split(/\s*[,;+]\s*|\s+\/\s+|\s+and\s+/i).map((z) => z.trim()).filter((z) => z && !/^(none|removed)$/i.test(z));
          const asked = named.filter((z) => colorHex(z));
          // a PMS named on the order that isn't in our color list (Oct 23, HALFF #40119: "PMS 2178 C" from our own mockup
          // sheet was dropped, the order looked one ink short and both were swapped for guesses, PMS 648 C and 7696 C): still
          // an ink they asked for. It goes on the logo color no named ink is near, drawn in the logo's own color
          const unknown = named.filter((z) => !colorHex(z) && /\b(pms|pantone)\b|^\d{3,4}\s*-?\s*[cu]?$/i.test(z));
          const rgb = (h: string) => { const v = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0); };
          const dist = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2; };
          const nearestAsked = (hex: string) => asked.slice().sort((a, b) => dist(hex, colorHex(a)!) - dist(hex, colorHex(b)!))[0];
          // only when they name enough inks for every color in the logo: one ink named for a 3-color logo (a guess
          // from an old job, Oct 12 Peticolas) painted the whole logo that one ink, a solid circle on the mockup
          // the logo's colors that print: the shirt's own color doesn't (Oct 23, #40116: Black counted made White + Scarlet
          // look like too few inks, so they were thrown out for National Red and PMS Bright Red C)
          const ownOf = (hex: string) => plan!.inks.length > 1 && !!line?.color && !isHeather(line.color) && dist(hex, shirtHex(line)) < 45 ** 2;
          const useAsked = asked.length + unknown.length > 0 && asked.length + unknown.length >= plan.inks.filter((k) => !ownOf(k.hex)).length;
          const spare = [...unknown];
          // otherwise the customer's brand colors: a red in their logo becomes their PMS red (when it's close)
          const b = brandRef.current;
          // brand standards aren't applied on their own (Oct 16, Nick: a customer can have several sets): the "Apply brand
          // standards" pop-up asks which, when this logo's colors come up
          const snap = (_hex: string, guess: string) => guess;
          if (!useAsked && b.groups.some((g) => g.colors.length) && !brandAsked.current.has(im.id)) { brandAsked.current.add(im.id); setBrandAsk(im.id); }
          const chosen: string[] = [];
          // the logo's own ink for this shirt color (its "On shirts": white on navy, navy on white), for a one-color logo
          const onShirt = plan.inks.length === 1 && line?.color ? inkOnShirt(d, line.color) : null;
          // the inks picked for this logo before (saved on the imprint) come back as they were
          // threads picked while it was embroidery don't come back as inks
          const saved0 = im.inkMap?.design === d.id ? im.inkMap.map : null;
          const saved = saved0 && Object.values(saved0).some((v) => isThreadName(v.name)) ? null : saved0;
          for (const k of plan.inks) {
            const was = saved?.[k.hex];
            // an ink named on the order only when it's near the logo's own color: a named ink far off it is a guess
            // (Oct 23, Logotology #40110: the order said "Reflex Blue" for an Electric Blue logo and the mockup went dark
            // blue: "if I uploaded that logo just naturally, it never suggests Reflex Blue")
            const near = useAsked ? nearestAsked(k.hex) : "";
            // a logo color that's the shirt's own color doesn't print: the shirt shows through (Oct 23, Nick: "black on a
            // black shirt, you should always think I'm removing it… yellow on a yellow shirt"; not on a heathered shirt)
            const shirtOwn = ownOf(k.hex);
            const close = !!near && dist(k.hex, colorHex(near)!) < 90 ** 2;
            // heat press: full color, every color as it is (only a knock-out changes it)
            const dtf = im.method === "dtf";
            const name = was ? was.name : shirtOwn ? "none" : dtf ? "Full color" : close ? near : useAsked && spare.length ? spare.shift()! : onShirt || snap(k.hex, k.name);
            chosen.push(name);
            for (const hex of [k.hex, ...(k.also || [])]) map[hex] = was ? (saved?.[hex] || was) : dtf && name !== "none" ? { name, hex } : { name, hex: colorHex(name) || k.hex };
          }
          // the picks saved on the imprint win (a color set to Removed isn't an ink and isn't counted: Oct 20, the proof
          // read "3 colors · Kelly Green, Light Royal, none")
          // a reorder still waiting for production (Oct 20, Nick: "I don't want you to make any assumptions… leave the art
          // untouched until production confirms it"): the art as it is, no ink names put on the print; production sets
          // how it printed here (Combine colors, halftones) or on Reorder Details
          if (!saved && im.visualOnly && !im.confirmed) {
            setPaints((p) => ({ ...p, [im.id]: { design: d.id, shirt: sh, sources, map: {}, unite: true, plan: plan!, off } }));
            return;
          }
          const kept = [...new Set(chosen)].filter((n) => n && n !== "none");
          const names = kept;
          setPaints((p) => ({ ...p, [im.id]: { design: d.id, shirt: sh, sources, map, unite: true, plan: plan!, off } }));
          // a reorder awaiting production keeps the color count the old job printed (Printavo's 7/0 is a fact; the inks
          // painted here are our guess, and production confirms both: Oct 20, Nick)
          setImprints((xs) => xs.map((x) => (x.id === im.id && x.method !== "dtf" ? { ...x, inks: names.join(", "), colors: keepCount(x) ? x.colors : Math.max(1, names.length) } : x)));
          return;
        }
        const sources = detectColors(img);
        setPaints((p) => ({ ...p, [im.id]: { design: d.id, sources, map: {}, plan: plan!, off } }));
        setImprints((xs) => xs.map((x) => (x.id === im.id && x.method !== "dtf" ? { ...x, colors: keepCount(x) ? x.colors : plan!.colors, inks: x.inks || `Simulated process (${plan!.colors})` } : x)));
      } catch { /* preview not loadable */ }
    });
  }, [imprints, designs, urls, keepBg, keepInside, (lines[active] || lines[0])?.color]); // eslint-disable-line react-hooks/exhaustive-deps

  // hovering a suggested color previews it on the mockup before it's picked
  const [hover, setHover] = useState<{ id: string; hexes: string[]; v: { name: string; hex: string } } | null>(null);
  // repaint logos whenever an ink choice changes (or a color is being previewed)
  useEffect(() => {
    const next: Record<string, string> = {}, boxes: Record<string, { w: number; h: number }> = {};
    for (const im of imprints) {
      const pt = paints[im.id];
      if (!pt) continue;
      const map = hover && hover.id === im.id ? { ...pt.map, ...Object.fromEntries(hover.hexes.map((h) => [h, hover.v])) } : pt.map;
      if (!Object.keys(map).length) continue;
      const img = imgCache.current.get(pt.design + (pt.off ? ":clean" : ""));
      if (!img) continue;
      const targets: Record<string, string> = {};
      Object.entries(map).forEach(([src, v]) => { targets[src] = v.name === "none" ? "none" : v.hex; });
      // the art as it is, painted in its inks: no automatic flattening (Oct 23, Nick: "you flatten that, two colors of
      // black, automatically. I wouldn't want you to do that automatically now. I'd want to have to tell you to do
      // that"). Flattening is an art fix asked for in the order check (lib/artFix.ts), so the shirt, the logo on the
      // order page and its blown-up picture all show the same art.
      const solid = false as boolean;
      const t = recolorTrim(img, pt.sources.map((x) => x.hex), targets, solid ? { shirt: shirtHex(lines[active] || lines[0]) } : undefined);
      next[im.id] = t.url;
      if (t.box) boxes[im.id] = { w: t.w, h: t.h };
    }
    // stitched pictures already drawn come straight back (a drag or a save doesn't draw them again)
    const todo: { id: string; flat: string; key: string; pxPerIn?: number }[] = [];
    if (stitchOn) for (const im of imprints) {
      if (im.method !== "embroidery" || !next[im.id]) continue;
      const wIn = parseFloat(im.size || "") || 0, box = boxes[im.id], tall = /tall/i.test(im.size || "");
      const pxPerIn = box && wIn ? Math.round(((tall ? box.h : box.w) / wIn) * 10) / 10 : undefined;
      const key = `${next[im.id].length}:${next[im.id].slice(-64)}:${pxPerIn || 0}`;
      const hit = stitchCache.current.get(key);
      if (hit) next[im.id] = hit; else todo.push({ id: im.id, flat: next[im.id], key, pxPerIn });
    }
    setPainted(next);
    setPaintBox(boxes);
    // color changes (Imprint.inkBy): the same art in the other ink(s), for that garment color only
    const by: Record<string, string> = {};
    for (const im of imprints) {
      const pt = paints[im.id];
      if (!pt || !im.inkBy) continue;
      const img = imgCache.current.get(pt.design + (pt.off ? ":clean" : ""));
      if (!img) continue;
      for (const [ck, swap] of Object.entries(im.inkBy)) {
        const ch = Object.entries(swap || {}).filter(([a, b]) => b && b.trim().toLowerCase() !== a.trim().toLowerCase());
        if (!ch.length) continue;
        const targets: Record<string, string> = {};
        // the art's colors as picked; each picked ink that changes on this color takes the new ink's color
        const srcs = Object.keys(pt.map).length ? pt.map : Object.fromEntries(pt.sources.map((x) => [x.hex, { name: (im.inks || "").split(",")[0]?.trim() || "", hex: x.hex }]));
        Object.entries(srcs).forEach(([src, v]) => {
          if (v.name === "none") { targets[src] = "none"; return; }
          const to = ch.find(([a]) => a.trim().toLowerCase() === (v.name || "").trim().toLowerCase())?.[1];
          targets[src] = (to && colorHex(to)) || v.hex;
        });
        by[`${im.id}|${ck}`] = recolorTrim(img, pt.sources.map((x) => x.hex), targets).url;
      }
    }
    setPaintedBy(by);
    // embroidery looks stitched (Oct 23, Nick: "make our mock-ups look like they're embroidered… this FedEx logo… it
    // should look like it's stitched"): thread rows, raised edges, a shadow on the fabric. Drawn after the flat one shows
    const run = ++stitchRun.current;
    for (const t of todo) {
      void stitchLook(t.flat, { pxPerIn: t.pxPerIn }).then((u) => {
        stitchCache.current.set(t.key, u);
        if (stitchCache.current.size > 40) stitchCache.current.delete(stitchCache.current.keys().next().value as string);
        if (run === stitchRun.current) setPainted((p) => (p[t.id] === t.flat ? { ...p, [t.id]: u } : p));
      }).catch(() => null);
    }
  }, [paints, imprints, hover, stitchOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // picture files (JPG, PNG…): warn once per logo that they don't print as crisp as vector art
  const [rasterOk, setRasterOk] = useState<Record<string, boolean>>({});
  const [rasterAsk, setRasterAsk] = useState<{ imId: string; d: Design } | null>(null);
  const [rasterBg, setRasterBg] = useState(true);
  function askRaster(imId: string, d: Design) {
    if (isVector(d.file_type, d.file_name) || rasterOk[d.id]) return;
    setRasterBg(!keepBg[d.id]);
    setRasterAsk({ imId, d });
  }

  // the ink picked for each logo color goes on the imprint (saved with the order), so the order page and a reopened
  // mockup show the logo in those inks
  useEffect(() => {
    setImprints((xs) => {
      let changed = false;
      const ys = xs.map((x) => {
        const pt = paints[x.id];
        if (!pt || !x.design_id || pt.design !== x.design_id || !pt.sources.length || isQuick(x.design_id)) return x;
        const next = Object.keys(pt.map).length ? { design: pt.design, map: pt.map } : undefined;
        if (JSON.stringify(next || null) === JSON.stringify(x.inkMap || null)) return x;
        changed = true;
        return { ...x, inkMap: next };
      });
      return changed ? ys : xs;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paints]);

  /** Set several logo colors at once (e.g. every color to its closest standard ink). */
  /** a logo clicked on the shirt (Oct 22, Nick: "when you click a logo, the right panel should come up for whatever
   *  you're clicking"): the Imprints panel turns to its side (Front / Back / Sleeves) and brings its print into view */
  function showImprint(id: string) {
    const im = imprints.find((x) => x.id === id);
    if (!im) return;
    const side = sideOf(im.location);
    setTab(side);
    setTimeout(() => {
      const el = document.querySelector(`[data-imp="${CSS.escape(id)}"]`) as HTMLElement | null;
      if (!el) return;
      // never the page itself: the logo is being clicked or dragged on the shirt, so the window stays put (Oct 22, Nick:
      // "you click it, it moves the whole browser down to that art"); only a panel that scrolls on its own brings it in
      let box = el.parentElement;
      while (box && box !== document.body) {
        const o = getComputedStyle(box).overflowY;
        if ((o === "auto" || o === "scroll") && box.scrollHeight > box.clientHeight) break;
        box = box.parentElement;
      }
      if (box && box !== document.body) {
        const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
        if (r.top < b.top) box.scrollBy({ top: r.top - b.top - 8, behavior: "smooth" });
        else if (r.bottom > b.bottom) box.scrollBy({ top: r.bottom - b.bottom + 8, behavior: "smooth" });
      }
      el.classList.remove("mk-imp-flash"); void el.offsetWidth; el.classList.add("mk-imp-flash");
    }, 60);
  }
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
  /** Every color in the logo to the nearest of the customer's brand colors. */
  const matchBrand = (im: Imprint, key: string) => { const pt = paints[im.id]; const g = brand.groups.find((x) => x.key === key); if (!pt || !g?.colors.length) return; setInks(im.id, Object.fromEntries(pt.sources.map((x) => { const n = nearestBrand(x.hex, g); return [x.hex, n ? { name: n.c.ink, hex: n.c.hex } : null]; }))); };
  /** Resize a sleeve print (sleeves stay a sleeve: capped at the sleeve's max area). */
  const growTo = (im: Imprint, inches: number) => {
    const v = Math.max(0.5, Math.min(maxWidthFor(im.location, ratioIm(im)), Math.round(inches * 100) / 100));
    setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, size: `${v}" wide` } : x)));
    return v;
  };
  /** Top-left of a print on the reference shirt (reference px), where it sits now including any hand move. */
  const refPos = (im: Imprint) => {
    const d = designOf(im), r = ratioIm(im) || 0.6;
    const drop = im.drop && !isNaN(+im.drop) ? +im.drop : null;
    const b = basePlacement(im.location, printWidth(im, im.location, ratioIm(im)), r, drop, scale);
    const o = NO_OFF;
    return { left: b.x + o.dx, top: b.y + o.dy };
  };
  /**
   * Put a print at this size with its top-left here, and let the location follow on its own:
   * drag a small logo to the side and it's a left chest, to the middle a center chest, grow it and it becomes a medium or full front.
   */
  // resizing keeps the logo where it's been dragged to on the picture (refPos is the spec spot, without the drag)
  const settle = (im: Imprint, wantW: number, at = ((p, o) => ({ left: p.left + o.dx, top: p.top + o.dy }))(refPos(im), offsets[im.id] || NO_OFF)) => {
    const sp = spotFor(im.location);
    if (sp.wrap) return growTo(im, wantW);
    const d = designOf(im), r = ratioIm(im) || 0.6;
    const wIn = Math.max(0.5, Math.min(sideMaxWidth(im.location, ratioIm(im)), Math.round(wantW * 100) / 100));
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
    const r = ratioIm(im), m = im.size.match(/^([\d.]+)/); if (!m) return;
    const w = /tall/i.test(im.size) ? (r ? +m[1] / r : +m[1]) : +m[1];
    if (w > 0) settle(im, w);
  };
  const settleHere = (id: string) => { const im = imprints.find((x) => x.id === id); if (im && !spotFor(im.location).wrap) settle(im, printWidth(im, im.location, ratioIm(im))); };

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
  const artUrl = (im: Imprint, on?: Line) => { const k = on && im.inkBy ? paintedBy[`${im.id}|${colorKey(on.color)}`] : ""; if (k) return k; const d = designs.find((x) => x.id === im.design_id); return painted[im.id] || (d ? (im.distress === "off" && urls[d.id + ":clean"]) || clean[d.id] || urls[d.id] : ""); };

  // ---- a garment not in the catalog: their own photos (Oct 24, Nick) ----
  /** "Need help picking garments?": our most popular garments to pick from (Oct 24, Nick) */
  const [popOpen, setPopOpen] = useState(false);
  const [ownUp, setOwnUp] = useState<{ name: string; color: string; front: File | null; back: File | null; lock?: boolean; busy?: string; err?: string } | null>(null);
  async function addOwn() {
    const o = ownUp; if (!o?.front) return;
    setOwnUp({ ...o, busy: "Uploading…", err: "" });
    try {
      const up = async (f: File) => {
        const t = await garmentPhotoUploadUrl(f.name, customerId || undefined);
        if (!t.ok || !t.path || !t.token) throw new Error(t.error || "Upload isn't available right now.");
        const r = await createClient().storage.from("proofs").uploadToSignedUrl(t.path, t.token, f, { contentType: f.type || undefined });
        if (r.error) throw new Error(r.error.message);
        return t.path;
      };
      const front = await up(o.front), back = o.back ? await up(o.back) : undefined;
      const urls = await garmentPhotoUrls([front, ...(back ? [back] : [])], customerId || undefined);
      setOwnUrls((u) => ({ ...u, ...urls })); ownAsked.current.add(front); if (back) ownAsked.current.add(back);
      const nl: Line = { id: uid(), style: o.name.trim().slice(0, 80), brand: "", color: o.color.trim().slice(0, 60), garment: "Their own garment (photos uploaded)", own: { front, ...(back ? { back } : {}) } };
      setLines((ls) => {
        const blank = ls.length === 1 && !ls[0].style.trim() && !ls[0].color;
        const out = blank ? [nl] : [...ls, nl];
        setTimeout(() => setActive(out.length - 1), 0);
        return out;
      });
      setOwnUp(null);
    } catch (e) { setOwnUp({ ...o, busy: "", err: e instanceof Error ? e.message : "Upload failed." }); }
  }
  /** the close-up's shirt color, picked off the photo (the browser's eyedropper; a color box where there isn't one) */
  async function pickShirtColor() {
    const li = active, l = lines[li]; if (!l) return;
    const set = (hex: string) => setLines((ls) => ls.map((x, j) => (j === li ? { ...x, hex: hex.toLowerCase() } : x)));
    const ED = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (ED) { try { const r = await new ED().open(); if (r?.sRGBHex) set(r.sRGBHex); } catch { /* closed without picking */ } return; }
    const inp = document.createElement("input"); inp.type = "color"; inp.value = shirtHex(l);
    inp.oninput = () => set(inp.value); inp.click();
  }
  const resetShirtColor = () => { const li = active; setLines((ls) => ls.map((x, j) => (j === li ? { ...x, hex: undefined } : x))); };

  const garmentFor = (l: Line) => {
    // "Gildan 64000" on an order: the style is the number (lib/ai/normalize.ts bareStyle)
    const st = bareStyle(l.style, l.brand).style.toLowerCase();
    return catalog.find((g) => g.style.toLowerCase() === st && (!l.brand || g.brand.toLowerCase() === l.brand.toLowerCase()))
      || catalog.find((g) => g.style.toLowerCase() === st);
  };

  // links for uploaded garment photos (signed for a week, asked for whenever a line has new ones)
  const [ownUrls, setOwnUrls] = useState<Record<string, string>>({});
  const ownAsked = useRef(new Set<string>());
  useEffect(() => {
    const want = lines.flatMap((l) => (l.own ? [l.own.front, l.own.back || ""] : [])).filter((p) => p && !ownAsked.current.has(p));
    if (!want.length) return;
    want.forEach((p) => ownAsked.current.add(p));
    void garmentPhotoUrls(want, customerId || undefined).then((m) => setOwnUrls((u) => ({ ...u, ...m })));
  }, [lines, customerId]);

  // a style on the order that isn't in the catalog yet (so no photos): pull it from S&S / SanMar once
  useEffect(() => {
    if (!catalog.length && !orderId) return;
    lines.forEach((l) => {
      const st = bareStyle(l.style, l.brand).style;
      if (l.own || !st || garmentFor(l) || tried.current.has(st.toUpperCase())) return;
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

  // a garment on the order that's in no catalog, with its look read off the customer's sheet (Create order, rule 3d):
  // drawn by the AI to match their photo once its style was looked for at S&S / SanMar (Oct 27, Nick: "determine oh I
  // don't have Peter Millar in my system, I've got to draw that"). Every color of the style gets the one drawing;
  // auto mode waits for it.
  const [garDrawing, setGarDrawing] = useState("");
  const garDrawn = useRef(new Set<string>());
  useEffect(() => {
    if (portal || !orderId || lookingUp || garDrawing || !custMocks.length) return;
    const key = (l: Line) => bareStyle(l.style, l.brand).style.toUpperCase();
    const l = lines.find((x) => x.look?.kind && !x.look.draw && !x.own && x.style.trim() && !garmentFor(x) && tried.current.has(key(x)) && !garDrawn.current.has(key(x)));
    if (!l) return;
    const k = key(l);
    garDrawn.current.add(k);
    const words = l.style.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const pics = custMocks.filter((m) => !m.pdf);
    const src = pics.find((m) => words.some((w) => m.name.toLowerCase().includes(w))) || pics[0] || custMocks[0];
    setGarDrawing(l.style);
    setMsg(`${[l.brand, l.style].filter(Boolean).join(" ")} isn't in a catalog: drawing it to match their photo (about a minute)…`);
    void (async () => {
      try {
        const image = src.pdf
          ? (await pdfPicture(await (await fetch(src.url)).arrayBuffer(), 1400)).toDataURL("image/jpeg", 0.85)
          : await jpegOf(src.url, 1100);
        const r = await drawGarment(image, { name: [l.brand, l.style].filter(Boolean).join(" "), color: l.color, kind: l.look!.kind! });
        if (r.draw) {
          setLines((ls) => ls.map((x) => (key(x) === k && x.look && !x.look.draw ? { ...x, look: { ...x.look, draw: r.draw } } : x)));
          setMsg(`Drew ${l.style} to match their photo${r.what ? `: ${r.what}` : ""}.`);
        } else setMsg(`${r.error || "Couldn't draw it."} It's shown as a plain drawn ${STOCK_LABEL[l.look!.kind!].toLowerCase()}.`);
      } catch { setMsg(`Couldn't open their photo to draw ${l.style}; it's shown as a plain drawn ${STOCK_LABEL[l.look!.kind!].toLowerCase()}.`); }
      finally { setGarDrawing(""); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, catalog, custMocks, lookingUp, garDrawing]);
  // auto mode doesn't save the plain drawing while one is still to be drawn from their photo
  const drawPending = !portal && !!orderId && custMocks.length > 0 && lines.some((x) => x.look?.kind && !x.look.draw && !x.own && x.style.trim() && !garmentFor(x) && !garDrawn.current.has(bareStyle(x.style, x.brand).style.toUpperCase()));

  // a garment we have no photo of, drawn in its color (Oct 27, Nick: "better stock graphics for when we don't have the
  // actual garment"): a tee, long sleeve, hoodie, vest… from its name, painted with the look read off their mockup
  const drawnKind = (l: Line) => l.look?.kind || stockKind(`${garmentFor(l)?.description || ""} ${l.garment || ""} ${l.style || ""} ${l.brand || ""}`);
  const drawn = (l: Line, view: View, hex = "") => stockSvg(drawnKind(l), view, { heather: isHeather(l.color), ...(l.look || {}), hex: hex || l.look?.hex || l.hex || guessHex(l.color) });
  const photo = (l: Line, view: View) => {
    // their own photos (a garment not in the catalog): the side they uploaded, else a drawn tee of its color
    if (l.own) { const p = view === "front" ? l.own.front : l.own.back || ""; const u = p ? ownUrls[p] : ""; if (u) return u; const fu = l.own.front ? ownUrls[l.own.front] : ""; return drawn(l, view, l.hex || (fu && fits[fu]?.hex) || ""); }
    const g = garmentFor(l);
    // SanMar names colors without spaces ("TrueRoyal" for True Royal): matched ignoring spaces and case
    const ci = g?.color_images?.[l.color] || Object.entries(g?.color_images || {}).find(([k]) => colorKey(k) === colorKey(l.color))?.[1];
    // a bag with no back photo: its back looks like its front (same bag, other side), never a drawn tee
    const p = ci ? (view === "front" ? ci.front : ci.back || (isBag(l) ? ci.front : "")) : "";
    if (p) { const u = ssImg(p); return view === "back" ? leveled[u] || u : u; }
    // no photo of this color: the style's own photo dyed to it, once it's made (below), not a drawn tee
    const t = g && l.color ? tinted[`${g.style}|${colorKey(l.color)}|${view}`] : "";
    return t || drawn(l, view);
  };
  // SanMar's tall photos (2:3, the shirt in the top two thirds: a K500 polo showed small and high next to S&S shirts;
  // Oct 23, Nick: "those K500 images are extremely small… they need to be much bigger"): the whole picture, photo and
  // prints together, zoomed so the shirt fills the frame like the others. One zoom per line from its front photo, used
  // for the back too, so front and back stay the same size (Oct 22: each photo zoomed on its own made backs bigger)
  // Oct 27 (DT6000: the back came out low and cut off): the zoom still comes from the front, so both sides stay the
  // same size, but each photo is centered on its own shirt (a back photo isn't framed like its front)
  type Box = { bx: number; by: number; bw: number; bh: number };
  const [boxes, setBoxes] = useState<Record<string, Box | null>>({});
  const framing = useRef(new Set<string>());
  useEffect(() => {
    for (const l of lines) {
      const fu = photo(l, "front");
      if (!fu || !/[?&]u=https?%3A%2F%2F[^&]*sanmar/i.test(fu)) continue;
      for (const u of [fu, photo(l, "back")]) {
        if (!u || framing.current.has(u)) continue;
        framing.current.add(u);
        void loadImg(u).then((img) => {
          const iw = img.naturalWidth, ih = img.naturalHeight;
          if (!iw || (u === fu && ih / iw < 1.4)) { setBoxes((f) => ({ ...f, [u]: null })); return; }
          const k0 = Math.min(1, 600 / Math.max(ih, iw)), w = Math.round(iw * k0), h = Math.round(ih * k0);
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          const g = c.getContext("2d", { willReadFrequently: true }); if (!g) return;
          g.drawImage(img, 0, 0, w, h);
          const d = g.getImageData(0, 0, w, h).data;
          let x0 = w, y0 = h, x1 = 0, y1 = 0;
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = (y * w + x) * 4; if (d[p + 3] > 20 && (d[p] < 235 || d[p + 1] < 235 || d[p + 2] < 235)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
          if (x1 <= x0 || y1 <= y0) { setBoxes((f) => ({ ...f, [u]: null })); return; }
          const cr = containRect(img), s0 = cr.w / w;
          setBoxes((f) => ({ ...f, [u]: { bx: cr.x + x0 * s0, by: cr.y + y0 * s0, bw: (x1 - x0) * s0, bh: (y1 - y0) * s0 } }));
        }).catch(() => null);
      }
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const frameOf = (l?: Line, v: View = "front") => {
    if (!l) return RAW;
    const fb = boxes[photo(l, "front")];
    if (!fb) return RAW;
    const z = Math.max(1, Math.min(1.35, (PHOTO_W * 0.9) / fb.bw, (PHOTO_H * 0.92) / fb.bh));
    if (z < 1.05) return RAW;
    const b = (v === "back" && boxes[photo(l, "back")]) || fb;
    // never pushed so far that the shirt leaves the frame
    const tx = PHOTO_W / 2 - z * (b.bx + b.bw / 2), ty = Math.max(PHOTO_H * 0.04 - z * b.by, Math.min(PHOTO_H * 0.96 - z * (b.by + b.bh), PHOTO_H / 2 - z * (b.by + b.bh / 2)));
    return { z, tx, ty };
  };
  // a sweatshirt's or hoodie's back photo drawn at the size of its front (lib/levelBack.ts, Oct 23 Bella 3945)
  const [leveled, setLeveled] = useState<Record<string, string>>({});
  const leveling = useRef(new Set<string>());
  useEffect(() => {
    for (const l of lines) {
      const g = garmentFor(l); if (!g || !l.color || isBag(l)) continue;
      const desc = `${g.description || ""} ${l.garment || ""}`;
      if (isShortSleeveTee(desc) || !/sweat|crew|fleece|hood|pullover/i.test(desc)) continue;
      const ci = g.color_images?.[l.color] || Object.entries(g.color_images || {}).find(([k]) => colorKey(k) === colorKey(l.color))?.[1];
      if (!ci?.front || !ci.back) continue;
      // a back picked from another kind of photo (on a model, the side, an upload) isn't lined up to the flat front
      if (ci.back_from && ci.back_from !== "sanmar") continue;
      const fu = ssImg(ci.front), bu = ssImg(ci.back);
      if (leveling.current.has(bu)) continue;
      leveling.current.add(bu);
      void levelBack(fu, bu).then((u) => { if (u) setLeveled((x) => ({ ...x, [bu]: u })); }).catch(() => null);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps
  // colors the supplier has no photo of (Oct 22, Nick: 64400 Neon Blue showed a gray drawn tee): dye the style's photo
  const [tinted, setTinted] = useState<Record<string, string>>({});
  const tinting = useRef(new Set<string>()), photoQ = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    for (const l of lines) {
      const g = garmentFor(l); if (!g || !l.color.trim()) continue;
      const imgs = g.color_images || {};
      if (Object.entries(imgs).some(([k, v]) => colorKey(k) === colorKey(l.color) && v?.front)) continue;
      const k0 = `${g.style}|${colorKey(l.color)}`;
      if (tinting.current.has(k0)) continue;
      tinting.current.add(k0);
      const color = l.color;
      // the other supplier's photo first (Oct 22, Nick: "if S&S doesn't have it, I know SanMar does"), saved on the garment;
      // else the style's own photo dyed to the color
      // one at a time: each request saves the garment's whole photo list, so two at once could drop one's photo
      photoQ.current = photoQ.current.then(async () => {
        const r = await fetch("/api/garments/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ garmentId: g.id, color }) }).then((x) => x.json()).catch(() => null) as { name?: string; front?: string; back?: string; side?: string; hex?: string; none?: boolean } | null;
        if (r?.front && r.name) {
          const entry = { front: r.front, back: r.back || "", side: r.side || "", hex: r.hex || "" };
          setCatalog((c) => c.map((x) => (x.id === g.id ? { ...x, color_images: { ...(x.color_images || {}), [r.name!]: entry } } : x)));
          return;
        }
        const base = tintBase(imgs); if (!base) return;
        const hex = Object.entries(imgs).find(([k]) => colorKey(k) === colorKey(color))?.[1]?.hex || guessHex(color);
        for (const v of ["front", "back"] as View[]) {
          const src = v === "front" ? imgs[base].front : imgs[base].back;
          if (!src) continue;
          const u = await tintPhoto(ssImg(src), hex.startsWith("#") ? hex : `#${hex}`).catch(() => "");
          if (u) setTinted((t) => ({ ...t, [`${k0}|${v}`]: u }));
        }
      }).catch(() => null);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // a color with a front photo but no back (Oct 26, Nick: S&S has no back of the Next Level 6221): SanMar's back of the
  // same style and color, saved on the garment; none there either, the back box asks which photo to use (noBack)
  const [noBack, setNoBack] = useState<Record<string, { garmentId: string; name: string; others: { label: string; path: string }[] }>>({});
  const backAsked = useRef(new Set<string>());
  useEffect(() => {
    if (portal) return;
    for (const l of lines) {
      if (l.own || !l.color.trim() || isBag(l)) continue;
      const g = garmentFor(l); if (!g) continue;
      const ent = Object.entries(g.color_images || {}).find(([k]) => colorKey(k) === colorKey(l.color));
      if (!ent || !ent[1]?.front || ent[1].back || ent[1].back_from) continue;
      const k0 = `${g.id}|${colorKey(l.color)}`;
      if (backAsked.current.has(k0)) continue;
      backAsked.current.add(k0);
      const color = l.color;
      photoQ.current = photoQ.current.then(async () => {
        const r = await fetch("/api/garments/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ garmentId: g.id, color, want: "back" }) }).then((x) => x.json()).catch(() => null) as { name?: string; front?: string; back?: string; side?: string; hex?: string; back_from?: string; none?: boolean; others?: { label: string; path: string }[] } | null;
        if (!r?.name) return;
        if (r.back) { const { name, none: _n, others: _o, ...entry } = r; setCatalog((c) => c.map((x) => (x.id === g.id ? { ...x, color_images: { ...(x.color_images || {}), [name]: { ...(x.color_images?.[name] || { front: "", back: "", side: "", hex: "" }), ...entry, back: r.back! } } } : x))); return; }
        if (r.none) setNoBack((m) => ({ ...m, [k0]: { garmentId: g.id, name: r.name!, others: r.others || [] } }));
      }).catch(() => null);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const backAsk = (l?: Line) => { if (!l || portal) return null; const g = garmentFor(l); return g ? noBack[`${g.id}|${colorKey(l.color)}`] || null : null; };
  const [backBusy, setBackBusy] = useState(""), [backErr, setBackErr] = useState("");
  const pickBack = async (l: Line, path: string, from: string) => {
    const q = backAsk(l); if (!q) return;
    setBackBusy(path); setBackErr("");
    const r = await fetch("/api/garments/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ garmentId: q.garmentId, color: q.name, setBack: { path, from } }) }).then((x) => x.json()).catch(() => null) as { name?: string; back?: string; back_from?: string; error?: string } | null;
    setBackBusy("");
    if (!r?.name) { setBackErr(r?.error || "Couldn't save that back photo."); return; }
    setCatalog((c) => c.map((x) => (x.id === q.garmentId ? { ...x, color_images: { ...(x.color_images || {}), [r.name!]: { ...(x.color_images?.[r.name!] || { front: "", back: "", side: "", hex: "" }), back: r.back || "", back_from: r.back_from } } } : x)));
    setNoBack((m) => { const n = { ...m }; delete n[`${q.garmentId}|${colorKey(l.color)}`]; return n; });
  };
  const uploadBack = async (l: Line, f: File) => {
    const q = backAsk(l); if (!q) return;
    const ext = (f.name.match(/\.(jpe?g|png|webp)$/i)?.[1] || "jpg").toLowerCase();
    const path = `garment-backs/${q.garmentId}/${colorKey(l.color) || "color"}-${Date.now().toString(36)}.${ext}`;
    setBackBusy("upload");
    const up = await createClient().storage.from("proofs").upload(path, f, { contentType: f.type || undefined });
    setBackBusy("");
    if (up.error) { setBackErr("Couldn't upload that photo."); return; }
    await pickBack(l, `store:${path}`, "upload");
  };

  // full color art (Oct 26, Nick): how it prints. DTF; screen print full color (the picture as is, production confirms
  // the colors and price before the quote, the customer's proof is picture only, seps in Separo); or spot colors (the
  // logo planned again as spot inks)
  const fullSeen = useRef(new Set<string>());
  const printAs = async (im: Imprint, how: "dtf" | "full" | "spot") => {
    const clearWait = (x: Imprint) => (isFullColorWhy(x.confirm?.why) ? { confirm: undefined, visualOnly: undefined } : {});
    if (how === "dtf") { setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, method: "dtf", colors: 1, fullColor: undefined, ...clearWait(x) } : x))); return; }
    if (how === "full") {
      const n = paints[im.id]?.plan?.method === "sim" ? paints[im.id]!.plan!.colors : 0;
      setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, method: "screen", fullColor: true, colors: n || x.colors || 6, inks: `Simulated process (${n || x.colors || 6})`, confirm: { size: false, ink: true, why: FULL_WHY }, visualOnly: true } : x)));
      return;
    }
    const d = designs.find((x) => x.id === im.design_id); if (!d) return;
    try {
      const img = await logoImg(d, im.distress === "off" && !!urls[d.id + ":clean"]);
      const l = lines[active] || lines[0];
      const plan = planPrint(pxOfImage(img, 1600), { garment: l ? shirtHex(l) : undefined, method: "spot" });
      const names = [...new Set(plan.inks.map((k) => k.name))];
      if (!portal) void sb.from("designs").update({ print_plan: plan, colors: plan.colors, inks: names.join(", ") }).eq("id", d.id).then(() => null);
      setDesigns((ds) => ds.map((x) => (x.id === d.id ? { ...x, print_plan: plan } : x)));
      setPaints((p) => { const n = { ...p }; delete n[im.id]; return n; });
      setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, method: "screen", fullColor: undefined, inks: "", ...clearWait(x) } : x)));
    } catch { /* the logo couldn't be read */ }
  };

  // bags and totes: flat, no collar; measured as a bag and printed centered on the body at real size (Oct 9: totes)
  const isBag = (l?: Line) => { if (!l) return false; const g = garmentFor(l); return /\b(tote|bag|backpack|duffel|cinch|sack|pouch)\b/i.test(`${g?.description || ""} ${l.garment || ""} ${g?.style || ""}`); };
  const bagWidth = (l: Line) => {
    const g = garmentFor(l), sp = g?.specs?.sizes?.OS;
    if (sp?.width && sp.width > 4) return sp.width;
    const m = `${g?.description || ""} ${l.garment || ""}`.match(/(\d+(?:\.\d+)?)\s*["”]?\s*w\b/i);
    return m ? +m[1] : 15;
  };
  const bagLength = (l: Line) => {
    const g = garmentFor(l), sp = g?.specs?.sizes?.OS;
    if (sp?.length && sp.length > 4) return sp.length;
    const m = `${g?.description || ""} ${l.garment || ""}`.match(/(\d+(?:\.\d+)?)\s*["”]?\s*h\b/i);
    return m ? +m[1] : bagWidth(l);
  };
  const measureFor = (l: Line, img: HTMLImageElement, v: View) => (isBag(l) ? measureBag(img, bagWidth(l)) : measureGarment(img, v, { tee: isShortSleeveTee(`${garmentFor(l)?.description || ""} ${l.garment || ""}`), kid: isKidGarment(l), hood: /\bhood/i.test(`${garmentFor(l)?.description || ""} ${l.garment || ""}`) }));
  /** a baby or toddler garment (its size run, or a onesie / bodysuit by name) */
  const isKidGarment = (l: Line) => { const b = bodyFor(l); return b.kind === "infant" || b.kind === "toddler" || /one ?piece|onesie|bodysuit|creeper|romper/i.test(`${garmentFor(l)?.description || ""} ${l.garment || ""}`); };
  // Each S&S photo frames the shirt a little differently: measure the outline once per photo and place everything on it
  const [fits, setFits] = useState<Record<string, Fit | null>>({});
  // a color chip being dragged (its line's index), and a line moved to another's place (the color shown stays shown)
  const [dragC, setDragC] = useState<number | null>(null);
  const moveLine = (from: number, to: number) => {
    const curId = lines[active]?.id;
    setLines((ls) => { const n = [...ls]; const [x] = n.splice(from, 1); n.splice(to, 0, x); const k = n.findIndex((y) => y.id === curId); if (k >= 0) setTimeout(() => setActive(k), 0); return n; });
  };
  // a color the supplier gave no color code for (SanMar's Scarlet): the color read off its photo is saved on the
  // garment, so the order page's logo tiles and close-ups show the shirt's real color too (Oct 21, Nick: #40092's
  // logo box was grey)
  const hexSaved = useRef(new Set<string>());
  useEffect(() => {
    for (const l of lines) {
      const g = garmentFor(l); if (!g || !l.color) continue;
      const f = fits[photo(l, "front")]; if (!f?.hex) continue;
      const k = Object.keys(g.color_images || {}).find((c) => colorKey(c) === colorKey(l.color));
      if (!k || g.color_images![k].hex) continue;
      const key = g.id + "|" + k; if (hexSaved.current.has(key)) continue;
      hexSaved.current.add(key);
      const ci = { ...(g.color_images || {}), [k]: { ...g.color_images![k], hex: f.hex } };
      void sb.from("garments").update({ color_images: ci }).eq("id", g.id).then(({ error }) => { if (!error) setCatalog((c) => c.map((x) => (x.id === g.id ? { ...x, color_images: ci } : x))); });
    }
  }, [fits, lines, catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * The bottom of the sewn neckline on each photo (where drops are measured from), remembered per photo
   * (garment_necks): a staff fix, else the AI's pick from the lines the pixel finder saw (Oct 20, Nick: "ask AI vision
   * to find it, and then if it's wrong, I fix it"), else the pixel finder's own guess.
   */
  const [necks, setNecks] = useState<Record<string, { neck: number; source: string }>>({});
  const neckAsked = useRef(new Set<string>());
  const neckKey = (u: string) => { try { const q = new URL(u, "https://x.invalid").searchParams; return q.get("p") || q.get("u") || u; } catch { return u; } };
  /** `measured`: a reading made just now for a photo not measured on screen yet (saving, PDF), with the same neckline
   *  rules applied, so the saved pictures line up exactly like the screen (Oct 22, Nick: the saved PBC mockups' front
   *  and back weren't level: saving used the automatic neckline instead of the one set by hand) */
  // the first color is the template; every other color's photo is laid over it (lib/mockupRegister.ts), so its prints
  // land in exactly the same spot on the shirt (Oct 22, Nick: "take the first one… lay a shirt outline over it… every
  // time I add a color, fit the new graphic to that template"). key: template photo > this photo
  const [regs, setRegs] = useState<Record<string, Reg | null>>({});
  const anchorLine = lines.find((x) => x.style && x.color && !isBag(x));
  useEffect(() => {
    const a = anchorLine; if (!a) return;
    for (const l of lines) {
      if (l.id === a.id || !l.style || !l.color || isBag(l)) continue;
      for (const v of ["front", "back"] as View[]) {
        const au = photo(a, v), u = photo(l, v), key = `${au}>${u}`;
        const fa = fits[au], fo = fits[u];
        if (key in regs || au === u || !fa?.mask || !fo?.mask || fa.flat || fo.flat) continue;
        setRegs((r) => ({ ...r, [key]: null }));
        registerMasks(fa.mask, fo.mask).then((res) => setRegs((r) => ({ ...r, [key]: res }))).catch(() => {});
      }
    }
  }, [fits, lines, anchorLine?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // a hoodie's back: the hood's edge traced (and snapped) by hand, prints go behind the hood (lib/hoodSnap.ts, Oct 23)
  const hoodKey = (l: Line) => { const g = garmentFor(l); return g ? Object.keys(g.color_images || {}).find((c) => colorKey(c) === colorKey(l.color)) || "" : ""; };
  const hoodOf = (l?: Line) => { if (!l) return null; const g = garmentFor(l), k0 = hoodKey(l); return (k0 && g?.color_images?.[k0]?.hoodBack) || null; };
  const isHoodie = (l?: Line) => !!l && /\bhood/i.test(`${garmentFor(l)?.description || ""} ${l.garment || ""}`);
  const [hoodDraw, setHoodDraw] = useState(false);
  const [hoodMasks, setHoodMasks] = useState<Record<string, string>>({});
  const saveHood = async (l: Line, raw: [number, number][] | null) => {
    const g = garmentFor(l), k0 = hoodKey(l); if (!g || !k0) return;
    const edge = raw && raw.length > 1 ? await snapToEdge(photo(l, "back"), raw).catch(() => raw) : null;
    const ci = { ...(g.color_images || {}) }; const cur = { ...ci[k0] };
    if (edge) cur.hoodBack = edge; else delete cur.hoodBack;
    ci[k0] = cur;
    setCatalog((c) => c.map((x) => (x.id === g.id ? { ...x, color_images: ci } : x)));
    await sb.from("garments").update({ color_images: ci }).eq("id", g.id);
  };
  useEffect(() => {
    for (const l of lines) {
      const e = hoodOf(l); if (!e?.length) continue;
      const u = photo(l, "back"), base = fits[u]?.mask, key = `${u}|${e.length}|${e[0]?.join(",")}|${e[e.length - 1]?.join(",")}`;
      if (!base || hoodMasks[key]) continue;
      void maskBehindHood(base, e).then((m) => setHoodMasks((x) => ({ ...x, [key]: m }))).catch(() => null);
    }
  }, [lines, fits, catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  const fitFor = (l: Line | undefined, v: View, measured?: Fit | null): Fit | null => {
    const f = fitFor0(l, v, measured);
    if (!f || !l || v !== "back") return f;
    const e = hoodOf(l); if (!e?.length) return f;
    const m = hoodMasks[`${photo(l, "back")}|${e.length}|${e[0]?.join(",")}|${e[e.length - 1]?.join(",")}`];
    return m ? { ...f, mask: m } : f;
  };
  const fitFor0 = (l: Line | undefined, v: View, measured?: Fit | null): Fit | null => {
    if (!l) return null;
    const u = photo(l, v);
    if (u.startsWith("data:")) return null;
    // laid over the template: the template's reading, moved onto this photo (a good fit only: most of the outline covered)
    const a = anchorLine;
    if (a && a.id !== l.id) {
      const au = photo(a, v), r = regs[`${au}>${u}`], A = au !== u ? baseFit(a, v) : null, own = fits[u] || measured || null;
      if (r && A && own && !own.flat && r.iou >= 0.82) {
        const back = (q: { x: number; y: number; rot: number }) => ({ x: (q.x - r.bx) / r.a, y: (q.y - r.by) / r.a, rot: q.rot });
        return { ...own, s: A.s / r.a, zs: (A.zs || A.s) / r.a, cx: (A.cx - r.bx) / r.a, top: (A.top - r.by) / r.a, neck: A.neck != null ? (A.neck - r.by) / r.a : undefined, sleeve: { left: back(A.sleeve.left), right: back(A.sleeve.right) } };
      }
    }
    return baseFit(l, v, measured);
  };
  /** the line whose print areas (set by hand) a color follows: the template's once it's laid over it */
  const settingsLine = (l: Line | undefined, v: View): Line | undefined => {
    const a = anchorLine;
    if (!l || !a || a.id === l.id) return l;
    const r = regs[`${photo(a, v)}>${photo(l, v)}`];
    return r && r.iou >= 0.82 ? a : l;
  };
  /** one photo's own reading (the template's, or a color not laid over it yet) */
  const baseFit = (l: Line, v: View, measured?: Fit | null): Fit | null => {
    const u = photo(l, v);
    if (u.startsWith("data:")) return null;
    const f = fits[u] || measured || null;
    if (!f || f.flat || !f.body) return f;
    // every color of one style is the same shirt from the same photo shoot (Oct 22, Nick: "these are the exact same
    // shirts… block the first one… and you should be able to do the rest"): one scale for all its colors, front and back
    // (the middle of their readings), lined up by each photo's own shirt outline, not its neckline seam. Reading each
    // color on its own (and by its neckline) shrank or moved some shirts by up to 2" (Peticolas PBC: the logo
    // bounced from color to color, and Heather Orchid's front came out smaller than its back).
    const g = garmentFor(l);
    const sib = g ? lines.filter((x) => garmentFor(x)?.id === g.id) : [l];
    // the scale comes from the fronts and is used on the backs too, so a color's front and back show at the same size
    // (Oct 22, Nick: Heather Mustard's back came out lower and longer than its front; the reference shirt's back photo
    // is framed smaller than its front, so measuring each side against its own reference made them differ)
    const readings = (pv: View) => sib.map((x) => fits[photo(x, pv)]).filter((p): p is Fit => !!p && !p.flat && !!p.body);
    const rs = readings("front").length ? readings("front") : readings("back");
    const med = (a: number[]) => { const b2 = [...a].sort((x2, y2) => x2 - y2); return b2[b2.length >> 1]; };
    const s0 = rs.length ? med(rs.map((p) => p.s)) : f.s, z0 = rs.length ? med(rs.map((p) => p.zs || p.s)) : f.zs || f.s;
    // a neckline set by hand stays (Oct 22, Nick: "the human eye sees it relative to the neck seam"); the automatic
    // readings were what moved shirts around
    const hand = v === "front" ? necks[neckKey(u)] : undefined;
    void hand; // necklines set by hand are kept (necks) but not used for now (Oct 22, Nick: "save that so we can go back to it")
    return { ...f, s: s0, zs: z0, neck: undefined };
  };
  /** where this photo's neckline reading came from, for the label on the line */
  const neckTag = (l: Line) => { const x = necks[neckKey(photo(l, "front"))]; return x?.source === "staff" ? "set by hand" : x ? "AI" : "auto"; };
  const setNeck = (l: Line, y: number) => {
    const k = neckKey(photo(l, "front"));
    setNecks((m) => ({ ...m, [k]: { neck: y, source: "staff" } }));
    void fetch("/api/garments/neck", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ photo: k, neck: y }) }).catch(() => {});
  };
  // saved necklines for the front photos, then the AI for any not seen before (one at a time, in the background)
  useEffect(() => {
    const todo = [...new Set(lines.map((l) => photo(l, "front")))].filter((u) => !u.startsWith("data:") && !neckAsked.current.has(u) && fits[u] && !fits[u]!.flat && fits[u]!.neckLines?.length);
    if (!todo.length) return;
    todo.forEach((u) => neckAsked.current.add(u));
    void (async () => {
      const got = await fetch(`/api/garments/neck?${todo.map((u) => "photo=" + encodeURIComponent(neckKey(u))).join("&")}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const have: Record<string, { neck: number; source: string }> = got?.necks || {};
      if (Object.keys(have).length) setNecks((m) => ({ ...m, ...have }));
      if (!NECK_AI) return;
      for (const u of todo) {
        const f = fits[u];
        if (have[neckKey(u)] || !f) continue;
        const img = await loadImg(u).catch(() => null);
        const pic = img && neckPicture(img, f);
        if (!pic) continue;
        const r = await fetch("/api/garments/neck", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photo: neckKey(u), ...pic }) }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        if (r?.neck) setNecks((m) => ({ ...m, [neckKey(u)]: { neck: r.neck, source: r.source || "ai" } }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fits, lines]);

  /**
   * Each style's own print-area spot (Oct 20, Nick: "when I click Print areas, let me drag that print areas grid around
   * … it stays the same dependent on each individual shirt … so it knows moving forward: a PC55RS gets this spot").
   * Some photos (a PC55RS with its low collar) don't line up with the reference tee by measurement alone. Dragging or
   * resizing the dashed box on one garment moves only that style's prints, never the other garments in the group;
   * saved on the garment (garments.mockup_fit, by side) in reference-photo pixels, and the box's size as a scale.
   * The photo itself isn't moved: only where the prints sit on it.
   */
  type FitAdj = { dx: number; dy: number; k: number };
  const [adjs, setAdjs] = useState<Record<string, Partial<Record<View, FitAdj | null>>>>({});
  const adjOf = (l: Line | undefined, v: View): FitAdj | null => {
    if (!l) return null;
    const g = garmentFor(l); if (!g) return null;
    const mine = adjs[g.id];
    if (mine && v in mine) return mine[v] || null;
    const saved = (g as Garment & { mockup_fit?: Partial<Record<View, FitAdj>> | null }).mockup_fit?.[v];
    return saved && (saved.dx || saved.dy || (saved.k && saved.k !== 1)) ? saved : null;
  };
  /** the photo's fit with this style's hand adjustment (for placing prints; the photo's zoom uses the plain fit) */
  /** print areas set by hand are kept on the garment (mockup_fit) but not used for now (Oct 22, Nick: start from the
   *  supplier's photos; a drag lines the logo up on the picture instead) */
  const USE_HAND_AREAS = false;
  const adjusted = (fit: Fit | null | undefined, l: Line | undefined, v: View): Fit | null | undefined => {
    const a = USE_HAND_AREAS && fit && !fit.flat ? adjOf(l, v) : null;
    if (!a || !fit) return fit;
    const zs = fit.zs || fit.s;
    return { ...fit, cx: fit.cx + a.dx * zs, top: fit.top + a.dy * zs, ...(fit.neck != null ? { neck: fit.neck + a.dy * zs } : {}), s: fit.s * (a.k || 1), ...(fit.zs ? { zs: fit.zs } : {}) };
  };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** move / resize one style's print areas on one side (photo pixels; k = how much bigger), and save it for next time */
  const nudgeArea = (l: Line | undefined, v: View, dxPx: number, dyPx: number, kMul = 1) => {
    const fit = l && fitFor(l, v);
    l = settingsLine(l, v); // a color laid over the template moves the template's print area (it's the one it follows)
    const g = l && garmentFor(l);
    if (!g || !fit || fit.flat) return;
    const cur = adjOf(l, v) || { dx: 0, dy: 0, k: 1 };
    const s0 = fit.zs || fit.s || 1;
    const next: FitAdj = { dx: cur.dx + dxPx / s0, dy: cur.dy + dyPx / s0, k: Math.max(0.6, Math.min(1.6, (cur.k || 1) * kMul)) };
    setAdjs((m) => ({ ...m, [g.id]: { ...(m[g.id] || {}), [v]: next } }));
    queueSave(g.id, v, next);
  };
  const resetArea = (l: Line | undefined, v: View) => { const g = l && garmentFor(l); if (!g) return; setAdjs((m) => ({ ...m, [g.id]: { ...(m[g.id] || {}), [v]: null } })); queueSave(g.id, v, null); };
  const pendingFit = useRef<Record<string, Partial<Record<View, FitAdj | null>>>>({});
  const queueSave = (gid: string, v: View, a: FitAdj | null) => {
    pendingFit.current[gid] = { ...(pendingFit.current[gid] || {}), [v]: a };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const all = pendingFit.current; pendingFit.current = {};
      const sb = createClient();
      for (const [id, sides] of Object.entries(all)) {
        const g = catalog.find((x) => x.id === id) as (Garment & { mockup_fit?: Partial<Record<View, FitAdj>> | null }) | undefined;
        const merged: Partial<Record<View, FitAdj>> = { ...(g?.mockup_fit || {}) };
        for (const [side, a] of Object.entries(sides)) { if (a) merged[side as View] = { dx: Math.round(a.dx * 10) / 10, dy: Math.round(a.dy * 10) / 10, k: Math.round((a.k || 1) * 1000) / 1000 }; else delete merged[side as View]; }
        const val = Object.keys(merged).length ? merged : null;
        const { error } = await sb.from("garments").update({ mockup_fit: val }).eq("id", id);
        if (!error) setCatalog((c) => c.map((x) => (x.id === id ? ({ ...x, mockup_fit: val } as Garment) : x)));
      }
    }, 700);
  };
  useEffect(() => {
    for (const l of lines) for (const v of ["front", "back"] as View[]) {
      const u = photo(l, v);
      if (u.startsWith("data:") || u in fits) continue;
      setFits((f) => ({ ...f, [u]: null }));
      loadImg(u).then((img) => { const fit = measureFor(l, img, v); setFits((f) => ({ ...f, [u]: fit })); }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, catalog]);

  // Private Label on this group: the customer's neck label set it prints, and the size shown (lib/neckLabels.ts)
  const curGroup = order ? (orderGroups(order).find((x) => x.id === groupId) || orderGroups(order)[0] || null) : null;
  const neckSet = curGroup && ((curGroup.finishing || []).includes("relabel") || (curGroup.customFin || []).some((f) => isRelabel(f) && (curGroup.finishing || []).includes(f.id)))
    ? setFor((customers.find((c) => c.id === customerId) as (Customer & { neck_labels?: NeckLabelSet[] }) | undefined)?.neck_labels, curGroup.neckLabel) : null;
  const neckSize = curGroup ? mainSize([curGroup]) : "M";
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
  // the sizes of this garment's style on the order (Oct 22, Nick: a 6210 offered youth sizes because the 5000B on the
  // same order had them, and the mockup was sized as a youth shirt): every line of the same style, else the whole order
  const sizesOf = (l?: Line) => {
    if (!l) return sortSizes(ordered);
    const st = (l.style || "").trim().toLowerCase();
    const mine = [...new Set(lines.filter((x) => (x.style || "").trim().toLowerCase() === st).flatMap((x) => orderedBy[x.id] || []))];
    // never a size the style isn't made in (the catalog's sizes, when it has them)
    const made = garmentFor(l)?.sizes;
    const list = mine.length ? mine : Object.keys(orderedBy).length ? [] : ordered;
    const kept = made?.length ? list.filter((z) => made.some((m) => m.toUpperCase() === z.toUpperCase())) : list;
    return sortSizes(kept.length ? kept : list);
  };
  const runSizes = sizesOf(lines[active] || lines[0]);
  const garZoom = (g: Garment | null | undefined, v: View) => { const f = (g as (Garment & { mockup_fit?: Record<string, unknown> | null }) | null | undefined)?.mockup_fit || {}; const z = +((f[`scale_${v}`] as number) || (f.scale as number) || 1); return z >= 0.7 && z <= 1.4 ? z : 1; };
  const bodyFor = (l?: Line): Body => {
    const g = l ? garmentFor(l) : null;
    const own = l ? sizesOf(l) : runSizes;
    const b = shownSize && own.includes(shownSize) ? bodyAt(g, shownSize) : bodyOf(g, own);
    if (!l || !isBag(l)) return b;
    // a bag or tote: its max print area is the bag less 1.5" all around (a 13" × 13" tote takes 10" × 10")
    const bw = bagWidth(l), bl = bagLength(l), r2 = (v: number) => Math.max(2, Math.round(v * 2) / 2);
    const what = /tote/i.test(`${g?.description || ""} ${l.garment || ""}`) ? "tote" : "bag";
    return { ...b, cap: { maxW: r2(bw - 3), maxH: r2(bl - 3), label: `a ${bw}" × ${bl}" ${what}` } };
  };
  const body = bodyFor(lines[active] || lines[0]);
  // the print scale on this garment's photos, by side, set by staff once for the style (every color, every mockup after)
  const zoomG = !portal ? garmentFor(lines[active] || lines[0]) : null;
  const setZoomG = async (v: View, z: number) => {
    if (!zoomG) return;
    const val0 = Math.round(Math.max(0.7, Math.min(1.4, z)) * 100) / 100;
    const cur = { ...(((zoomG as Garment & { mockup_fit?: Record<string, unknown> | null }).mockup_fit || {}) as Record<string, unknown>) };
    // the old one-for-both setting becomes the two sides' starting point
    if (cur.scale != null) { cur.scale_front ??= cur.scale; cur.scale_back ??= cur.scale; delete cur.scale; }
    if (val0 === 1) delete cur[`scale_${v}`]; else cur[`scale_${v}`] = val0;
    const val = Object.keys(cur).length ? cur : null;
    setCatalog((c) => c.map((x) => (x.id === zoomG.id ? ({ ...x, mockup_fit: val } as Garment) : x)));
    await createClient().from("garments").update({ mockup_fit: val }).eq("id", zoomG.id);
  };
  // just − and + (Oct 26, Nick: "just make it a plus or minus… I don't need the percent"); the ↺ back to normal shows on
  // the left once it's changed, in a spot kept for it so − and + never move under the mouse
  const zoomCtl = (v: View) => zoomG && (
    <span className="mk-pill mk-zoom" title={`Prints look too big or too small on the ${v} of the ${zoomG.brand} ${zoomG.style}? Set it once: kept for every color and every mockup after (now ${Math.round(garZoom(zoomG, v) * 100)}%)`}>
      <button type="button" className={"mk-zoom-r" + (garZoom(zoomG, v) !== 1 ? "" : " off")} onClick={() => void setZoomG(v, 1)} title="Back to normal" aria-label={`Back to normal on the ${v}`} tabIndex={garZoom(zoomG, v) !== 1 ? 0 : -1}>↺</button>
      <button type="button" aria-label={`Prints smaller on the ${v}`} onClick={() => void setZoomG(v, garZoom(zoomG, v) - 0.02)}>−</button>
      <button type="button" aria-label={`Prints bigger on the ${v}`} onClick={() => void setZoomG(v, garZoom(zoomG, v) + 0.02)}>+</button>
    </span>
  );
  const scaleOf = (b: Body) => REF_BODY.widthIn / b.widthIn;
  /** the photo's scale with staff's nudge for this garment and side (garments.mockup_fit.scale_front / scale_back; Oct 24,
   *  Nick: "scale front, scale back… it needs to work independently") */
  const zScale = (b: Body, l: Line | undefined, v: View) => scaleOf(b) * garZoom(l ? garmentFor(l) : null, v);
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
  const fitBody = (b: Body) => (!b.cap && capBody && capBody.widthIn < b.widthIn ? capBody : b);
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
  /** a print's proportions: the art as it prints (cut down when a color was removed), else the design's */
  const ratioIm = (im: Imprint) => { const b = paintBox[im.id]; return b?.w && b.h ? b.h / b.w : ratioOf(designOf(im)); };
  const ratioOf = (d?: Design) => {
    const t = d ? trims[d.id] || d.art_box || null : null;
    if (t?.w && t.h) return t.h / t.w;
    return d?.width_px && d?.height_px ? d.height_px / d.width_px : 0;
  };
  // brand standards for prints (Oct 16, Nick): the customer's standard size for this logo here ("Peticolas' round logo
  // is always 10.5" on the front"), applied on its own; and how it prints (fashion hit, soft hand), each new print's start
  const brandPrint = useMemo(() => (customers.find((c) => c.id === customerId)?.brand_print || null), [customers, customerId]);
  const brandSized = useRef<Record<string, string>>({}), brandHit = useRef<Record<string, string>>({});
  const [sizeAskB, setSizeAskB] = useState<{ id: string; loc: string; have: number; want: number }[] | null>(null);
  const brandRule = (im: Imprint) => { const d = designOf(im); if (!d || !brandPrint) return null; const r = ratioIm(im); return brandSizeFor(brandPrint, d.id, r ? 1 / r : 0, im.location); };
  useEffect(() => {
    if (!brandPrint || viewId) return;
    const sizes: Record<string, string> = {}, hits: Record<string, { printStyle?: "fashion"; softHand?: boolean }> = {};
    const ask: { id: string; loc: string; have: number; want: number }[] = [];
    for (const im of imprints) {
      const d = designOf(im); if (!d) continue;
      const rule = brandRule(im), k = `${d.id}|${im.location}`;
      // a size that's already set is never changed by opening the page (Oct 23, Nick on #40133: the back set to 3.5" four
      // times came back as their standard 3" each time the mockup was opened: "those sizes have to be set in stone"). The
      // standard size goes on a print that has none yet, or whose logo or spot is changed here.
      const was = brandSized.current[im.id];
      if (was === undefined && (im.size || "").trim()) {
        brandSized.current[im.id] = k;
        // set, but not their standard: asked, never changed by itself (Oct 23, Nick: "a pop-up that says, hey, front
        // should be 10.5 and back should be 3.5. Is that correct or not?… override or not")
        if (rule && im.sizeFrom !== "customer" && im.sizeFrom !== "film") {
          const m = (im.size || "").match(/^([\d.]+)/), r = ratioIm(im) || 0;
          const have = m ? (/tall/i.test(im.size) ? (r ? +m[1] / r : +m[1]) : +m[1]) : 0;
          if (have && Math.abs(have - rule.width) > 0.05) ask.push({ id: im.id, loc: im.location, have: Math.round(have * 100) / 100, want: rule.width });
        }
      }
      else if (rule && was !== k && im.sizeFrom !== "customer" && im.sizeFrom !== "film") { brandSized.current[im.id] = k; if (!(im.size || "").startsWith(`${rule.width}"`)) sizes[im.id] = `${rule.width}" wide`; }
      if (im.method === "screen" && brandHit.current[im.id] !== d.id) {
        brandHit.current[im.id] = d.id;
        const h = brandHitFor(brandPrint, !!(d.specs as { distressed?: boolean } | null)?.distressed);
        if (h && im.printStyle == null && im.softHand == null) hits[im.id] = h;
      }
    }
    if (ask.length && !portal) setSizeAskB((a) => [...(a || []).filter((x) => !ask.some((y) => y.id === x.id)), ...ask]);
    if (Object.keys(sizes).length || Object.keys(hits).length)
      setImprints((xs) => xs.map((x) => (sizes[x.id] || hits[x.id] ? { ...x, ...(sizes[x.id] ? { size: sizes[x.id], sizeFrom: "brand" as const } : {}), ...(hits[x.id] || {}) } : x)));
  }, [imprints, designs, brandPrint, trims]); // eslint-disable-line react-hooks/exhaustive-deps

  /** another logo on a print: the old logo's inks and color count go with it (Oct 22, Nick, #40106: swapped to the
   *  1-color black logo, the print kept "2 colors · Electric Blue, Black, 3 screens"); the new one's are read fresh */
  const swapLogo = (x: Imprint, d: Design): Imprint => (x.design_id === d.id ? x : { ...x, design_id: d.id, inks: d.inks && !/^simulated/i.test(d.inks) ? d.inks : "", colors: Math.max(1, Math.round(+(d.colors || 0)) || 1), inkMap: undefined, center: undefined });
  /** how far off its box's middle a print is centered (shares of its width / height): a round badge with a tail is
   *  centered on the circle (Oct 22, Nick: "the circle's in the center, the tail is off to the right") */
  const centerShift = (im: Imprint) => (im.center?.on && im.center.d === im.design_id ? { x: 0.5 - im.center.x, y: 0.5 - im.center.y } : { x: 0, y: 0 });
  const vCentered = (im: Imprint) => !spotFor(im.location).top && !(im.drop && !isNaN(+im.drop));
  // each logo read once for a circle that should be the center (found ones are ticked; "Center on the circle" changes it)
  const centerAsked = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const im of imprints) {
      const d = designOf(im), u = d ? artUrl(im) : "";
      if (!d || !u || isQuick(d.id) || im.center?.d === d.id || centerAsked.current[im.id] === d.id) continue;
      centerAsked.current[im.id] = d.id;
      // found one: ask (Oct 27, Nick: "that is something you should detect and ask us… I detected this circle with an
      // offset, do I center on the circle?"), the answer is kept on the print (by "you")
      void detectCenter(u).then((c) => setImprints((xs) => xs.map((x) => (x.id === im.id && x.design_id === d.id && x.center?.d !== d.id ? { ...x, center: { d: d.id, x: c?.x ?? 0.5, y: c?.y ?? 0.5, on: false, by: "auto" } } : x)))).catch(() => null);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps
  /** a print whose logo has a circle off its middle that nobody has answered yet: asked in a pop-up, one at a time */
  const [centerSkip, setCenterSkip] = useState<Record<string, boolean>>({});
  const centerAsk = auto ? undefined : imprints.find((x) => x.center && x.center.d === x.design_id && x.center.by === "auto" && !x.center.on && (Math.abs(x.center.x - 0.5) > 0.02 || Math.abs(x.center.y - 0.5) > 0.02) && !spotFor(x.location).wrap && !centerSkip[x.id + x.design_id]);
  const answerCenter = (im: Imprint, on: boolean) => setImprints((xs) => xs.map((x) => (x.id === im.id && x.center ? { ...x, center: { ...x.center, on, by: "you" } } : x)));
  async function toggleCenter(im: Imprint, on: boolean) {
    const d = designOf(im); if (!d) return;
    let c = im.center?.d === d.id && (im.center.x !== 0.5 || im.center.y !== 0.5) ? { x: im.center.x, y: im.center.y } : null;
    if (on && !c) c = await detectCenter(artUrl(im), true).catch(() => null);
    if (on && !c) return setMsg("I couldn't find a circle or badge to center on in this logo. Drag it into place on the close-up instead.");
    setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, center: { d: d.id, x: c?.x ?? 0.5, y: c?.y ?? 0.5, on, by: "you" } } : x)));
  }
  /** where a print sits on a photo; `on` = draw it on that garment line (its own size and print areas), else the one shown */
  const place = (im: Imprint, view?: View, fit?: Fit | null, on?: Line) => {
    const d = designOf(im);
    const r = ratioIm(im) || 0.6;
    const bd = on ? bodyFor(on) : body;
    const wIn = printWidth(im, im.location, ratioIm(im), bd);
    const drop = im.drop && !isNaN(+im.drop) ? +im.drop : null;
    const vv = view || viewsFor(im.location)[0];
    const b = basePlacement(im.location, wIn, r, drop, zScale(bd, on || line, vv), view, adjusted(fit === undefined ? fitFor(on || line, vv) : fit, settingsLine(on || line, vv), vv), bd);
    // hand moves are stored in reference-photo pixels; scale them to this photo
    // a hand drag lines the logo up on the shirt picture only (Oct 22, Nick: "locks in the close-up… then we just drag
    // to visually align it on the mockup… that shouldn't matter for our proofing"): close-ups and the print spec stay put
    const og = offsets[im.id] || NO_OFF, ol = offsets[`${(on || line)?.id}:${im.id}`] || NO_OFF;
    const cs = b.clip ? { x: 0, y: 0 } : centerShift(im);
    const o0 = { dx: og.dx + ol.dx, dy: og.dy + ol.dy }, o = { dx: o0.dx * b.k + cs.x * b.w, dy: o0.dy * b.k + (vCentered(im) ? cs.y * b.h : 0) };
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
  // the garment's own spots: a long sleeve has upper arms and cuffs where a tee has its sleeves (Oct 27, Nick)
  const spotList = locationsFor(lines.map((l) => ({ style: l.style, brand: l.brand, garment: l.garment, description: garmentFor(l)?.description })));
  const locsFor = (t: Side) => (spotList.length > 4 ? spotList : LOCATIONS).filter((z) => sideOf(z) === t);
  const views: View[] = (["front", "back"] as View[]).filter((v) => imprints.some((im) => viewsFor(im.location).includes(v)));
  const line = lines[active] || lines[0];
  // pixels per inch on the photo: S&S shoots every size to fill the frame, so a smaller body means more pixels per inch
  const scale = scaleOf(body);
  const shownOn = body.cap ? body.cap.label : body.kind === "adult" ? "an adult Large" : body.size === "YL" ? "a youth Large" : `a ${body.size}`;
  const shirtHex = (l?: Line) => { if (!l) return "#9aa1ab"; if (l.hex && /^#[0-9a-f]{6}$/i.test(l.hex)) return l.hex; if (l.look?.hex && !garmentFor(l) && /^#[0-9a-f]{6}$/i.test(l.look.hex)) return l.look.hex; if (l.own) return fits[photo(l, "front")]?.hex || guessHex(l.color); if (/\//.test(l.color || "")) return guessHex(l.color); /* two-tone (White/ Royal): the body color */ const g = garmentFor(l); const ci = g?.color_images?.[l.color] || Object.entries(g?.color_images || {}).find(([k]) => colorKey(k) === colorKey(l.color))?.[1]; return (ci?.hex && /^#?[0-9a-f]{6}$/i.test(ci.hex) ? garmentHex(ci.hex, l.color) : "") || ((g0) => (g0 !== "#9aa1ab" ? g0 : fits[photo(l, "front")]?.hex || g0))(guessHex(l.color)); };

  /**
   * The measured view: an inch grid over the garment at the size we're drawing it (a 13" × 13" tote → 13 × 13 squares,
   * an adult Large → 22" × 30"), the max print area and each print's width × height, so the scale can be checked by eye.
   */
  const measured = (v: View) => {
    const fit = fitFor(line, v), f = fit?.flat;
    const sc = zScale(body, line, v);
    const ppi = f ? f.ppi : PX_PER_IN * sc * (fit?.s || 1);
    const gw = f && body.cap && line ? bagWidth(line) : body.widthIn, gh = f && body.cap && line ? bagLength(line) : body.lengthIn;
    const gx = (f ? f.cx : fit?.cx ?? CENTER_X) - (gw * ppi) / 2, gy = f ? f.top : fit?.top ?? COLLAR_Y[v];
    const W = gw * ppi, H = gh * ppi, fs = Math.max(13, Math.min(22, ppi * 0.45)), every = gw > 16 ? 2 : 1;
    const ims = imprints.filter((im) => viewsFor(im.location).length === 1 && viewsFor(im.location)[0] === v);
    const n = (x: number) => (Math.round(x * 100) / 100).toString();
    const tag = (x: number, y: number, t: string, c: string, anchor: "start" | "middle" | "end" = "middle") => (
      <text x={x} y={y} fontSize={fs} fontWeight={700} textAnchor={anchor} fill={c} stroke="#fff" strokeWidth={fs / 4} paintOrder="stroke">{t}</text>
    );
    return (
      <svg className="mk-measure" viewBox={`0 0 ${PHOTO_W} ${PHOTO_H}`} preserveAspectRatio="none" aria-label="Measured view">
        {/* inch grid over the garment. A shirt on the form is wrapped: 22 columns from side seam to side seam, full
            inches across the middle of the chest and narrower toward the sides as the body curves away, and the
            rows run from the top of the collar to the hem. A bag is flat: straight inches. */}
        {(() => {
          const sh = !f && fit?.body ? fit.body : null;
          const c0 = sh ? (sh.l + sh.r) / 2 : gx + W / 2, rv = sh ? (sh.r - sh.l) / 2 : W / 2;
          const X = (i: number) => (sh ? c0 + rv * Math.sin(((i - gw / 2) / (gw / 2)) * (Math.PI / 2)) : gx + i * ppi);
          const y0 = gy, Y = (i: number) => (sh ? y0 + (i * (sh.hem - y0)) / gh : gy + i * ppi);
          const nx = Math.floor(gw), ny = Math.floor(gh), x0 = X(0), x1 = X(gw), y1 = Y(gh);
          const across: number[] = []; let last = -1e9;
          // numbers across the top: every inch (every 2 on a shirt), skipped where the wrap squeezes them together
          for (let i = every; i <= nx; i += every) { const xi = X(i); if (xi - last >= fs * 1.3) { across.push(i); last = xi; } }
          return (
            <>
              {Array.from({ length: nx + 1 }, (_, i) => <line key={"x" + i} x1={X(i)} x2={X(i)} y1={y0} y2={y1} stroke="rgba(0,0,0,.28)" strokeWidth={i % 6 === 0 || i === nx ? 1.6 : 0.8} vectorEffect="non-scaling-stroke" />)}
              {Array.from({ length: ny + 1 }, (_, i) => <line key={"y" + i} y1={Y(i)} y2={Y(i)} x1={x0} x2={x1} stroke="rgba(0,0,0,.28)" strokeWidth={i % 6 === 0 || i === ny ? 1.6 : 0.8} vectorEffect="non-scaling-stroke" />)}
              <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke="#111" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              {across.map((i) => <g key={"tx" + i}>{tag(X(i), y0 - fs * 0.4, String(i), "#111")}</g>)}
              {Array.from({ length: Math.floor(gh / every) + 1 }, (_, i) => i * every).filter((i) => i > 0).map((i) => <g key={"ty" + i}>{tag(x0 - fs * 0.4, Y(i) + fs * 0.35, String(i), "#111", "end")}</g>)}
              {tag((x0 + x1) / 2, y1 + fs * 1.3, body.cap ? `${n(gw)}" × ${n(gh)}" ${body.cap.label.split(" ").pop() || "bag"}` : `${n(gw)}" chest (laid flat, wraps around the form) × ${n(gh)}" long · ${shownOn.replace(/^an? /, "")}`, "#111")}
            </>
          );
        })()}
        {ims.map((im) => {
          const p = place(im, v), sp = spotFor(im.location);
          return (
            <g key={im.id}>
              <rect x={p.area.x} y={p.area.y} width={p.area.w} height={p.area.h} fill="rgba(10,123,166,.08)" stroke="#0a7ba6" strokeWidth={2} strokeDasharray="8 6" vectorEffect="non-scaling-stroke" />
              {tag(p.area.x + p.area.w / 2, p.area.y + p.area.h - fs * 0.4, `max ${sp.maxW}" × ${sp.maxH}"`, "#0a7ba6")}
              <rect x={p.x} y={p.y} width={p.w} height={p.h} fill="none" stroke="#d6336c" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              {tag(p.x + p.w / 2, p.y - fs * 0.4, `${n(p.wIn)}" × ${n(p.hIn)}"`, "#d6336c")}
            </g>
          );
        })}
      </svg>
    );
  };

  /** One close-up box for an imprint (used under the photos and, smaller, beside them for the selected tab). */
  // one shirt-color picker: on the first close-up under the photos only (Oct 24, Nick: "we only need one… keep it on the first one on the bottom left")
  const closeUp = (im: Imprint, size: number, eye = false) => {
                const d = designOf(im); const r = ratioIm(im) || 0.6;
                const wIn = printWidth(im, im.location, ratioIm(im));
                const sp = spotFor(im.location);
                // a badge with a tail: the circle in the middle of the close-up
                const cs = sp.wrap ? { x: 0, y: 0 } : centerShift(im), ppi0 = PX_PER_IN * scale;
                const o = { dx: cs.x * wIn * ppi0, dy: vCentered(im) ? cs.y * wIn * r * ppi0 : 0 };
                return (
                  // clicking a close-up brings up its side: the photo (one-photo layouts) and the Imprints tab
                  <div key={im.id + size} className="mk-cu-wrap" onPointerDownCapture={() => { if (sideOf(im.location) !== curTab) setTab(sideOf(im.location)); }}>
                  <CloseUp key={im.id + size} size={size} title={im.location} hex={shirtHex(line)} onEyedrop={eye ? () => void pickShirtColor() : undefined} picked={!!line?.hex} onResetHex={resetShirtColor} url={artUrl(im, line)} wIn={wIn} hIn={wIn * r} colors={inkList(im)}
                    onPick={(rx, ry, x, y) => pickColor(im.id, rx, ry, x, y)}
                    maxW={sp.maxW} maxH={sp.maxH} topAlign={!!sp.top || !!(im.drop && !isNaN(+im.drop))} fold={viewsFor(im.location).length > 1} arm={sp.arm} offIn={{ x: o.dx / (PX_PER_IN * scale), y: o.dy / (PX_PER_IN * scale) }}
                    onMove={(dxIn, dyIn) => { if (im.visualOnly && !im.confirmed && !adjust) return; setOffsets((q) => ({ ...q, [im.id]: { dx: (q[im.id]?.dx || 0) + dxIn * PX_PER_IN * scale, dy: (q[im.id]?.dy || 0) + dyIn * PX_PER_IN * scale } })); }}
                    onResize={(newWIn) => { if (im.visualOnly && !im.confirmed && !adjust) return; guardSize(im.id, () => { if (sp.wrap) growTo(im, newWIn); else settle(im, newWIn); }); }}
                    onEnd={() => {}} />
                  </div>
                );
  };

  /** The shirt photo for one side, lined up with the 12" x 14" full front / full back print area, as the Idea Lab's backdrop. */
  const labShirt = (side: Side): LabShirt | null => {
    if (side === "sleeve" || !line) return null;
    const v = side as View;
    const af = adjusted(fitFor(line, v), settingsLine(line, v), v);
    const b = v === "front" ? basePlacement("Full Front", 13, 18 / 13, null, scale, v, af) : basePlacement("Full Back", 13, 18 / 13, null, scale, v, af);
    return { src: photo(line, v), hex: shirtHex(line), area: b.area, label: `${v === "front" ? "Front" : "Back"} of the ${[line.color, line.style].filter(Boolean).join(" ") || "shirt"}` };
  };
  /** Where an imprint sits now, in Idea Lab artboard units (50 per inch, 0,0 = top-left of the full print area). */
  const labSpot = (im: Imprint) => {
    const sp = spotFor(im.location); if (sp.wrap) return undefined;
    const d = designOf(im), r = ratioIm(im) || 0.6, wIn = printWidth(im, im.location, ratioIm(im)), ppi = PX_PER_IN * scale, at = refPos(im);
    const leftIn = (at.left - CENTER_X) / ppi, topIn = (at.top - COLLAR_Y[sp.view]) / ppi - 4;
    return { x: 300 + (leftIn + wIn / 2) * 50, y: (topIn + (wIn * r) / 2) * 50, w: wIn * 50 };
  };
  /** Open the Idea Lab on one side of the shirt: for one imprint (edit its art or typed text), or to make something new. */
  async function openLab(side: Side, im?: Imprint, tool?: "ideas" | "art" | "ai") {
    if (!customerId) return setMsg("Pick the customer first. Designs are saved to their account.");
    if (!line?.style) return setMsg("Pick a garment first so the Design Lab can show the shirt.");
    const shirt = labShirt(side);
    if (!im) return setDesignerFor({ imId: "", side, shirt, start: tool ? { tool } : {} });
    if (qt[im.id]?.text.trim()) return setDesignerFor({ imId: im.id, side, shirt, start: { doc: quickTextDoc(qt[im.id]), name: qt[im.id].text.split("\n")[0].slice(0, 40) } });
    const d = designOf(im);
    if (!d || isQuick(d.id)) return setDesignerFor({ imId: im.id, side, shirt, start: {} });
    const doc = await loadDesignerDoc(sb, d, portal);
    setDesignerFor({ imId: im.id, side, shirt, start: doc ? { doc, name: d.name } : { imageUrl: urls[d.id], name: d.name, at: labSpot(im) } });
  }
  const openDesigner = (im: Imprint) => openLab(sideOf(im.location), im);
  /** Type words right onto the shirt: a new text location (the big one on this side when it's free) */
  const addText = () => {
    const opts = locsFor(curTab), big = curTab === "front" ? "Full Front" : curTab === "back" ? "Full Back" : "";
    const loc = big && !imprints.some((i) => i.location === big) ? big : opts.find((z) => !imprints.some((i) => i.location === z)) || opts[0];
    const im = { ...newImprint(loc), size: big === loc ? '10" wide' : "" };
    setImprints([...imprints, im]); setTab(curTab); textMode(im, true);
  };
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

  /** where a print pulled off a mockup goes: by its side, size and how far off center it sat */
  const locOfPulled = (side: "front" | "back", widthIn: number, dropIn: number, offIn: number) => side === "back"
    ? (widthIn <= 4.5 && dropIn < 3.5 ? "Upper Back (Yoke)" : widthIn <= 8 ? "Medium Back" : "Full Back")
    : widthIn > 8 ? "Full Front" : widthIn > 5 ? "Medium Front" : Math.abs(offIn) >= 1.75 ? (offIn > 0 ? "Left Chest" : "Right Chest") : "Center Chest";

  /**
   * Helper → read a mockup (Oct 22, Nick: "we're going to get a lot of art that's pre-built and that's not separated out…
   * take the vector art right off the top… process the art, kind of like we do reorders: what do I got here? a front art
   * and a back art, these colors, I place this on"). Three kinds: our old mockup or a customer's on shirt photos (the
   * photos are left out, the art kept), a customer's mockup with the shirts drawn flat (the shirt's color taken out), or a
   * PDF that's just the art. PMS swatches written on the page are read as the inks. Nothing is saved until "Put on".
   */
  // what garments a sheet shows (Oct 27, Nick: "pull art off and then draw blank"): read by the AI from a picture of the
  // page while the art is pulled; shown as "The garments on this sheet" with Draw this blank
  async function readGarments(name: string, pic: string) {
    setHelper((h) => h && h.name === name ? { ...h, gBusy: true, pic, gDraw: {} } : h);
    try {
      const r = await fetch("/api/mockup/garment-look", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: pic, name }) });
      const j = await r.json().catch(() => ({})) as { garments?: SheetGarment[]; error?: string };
      setHelper((h) => h && h.name === name ? { ...h, gBusy: false, garments: j.garments || [], gErr: r.ok ? "" : j.error || "Couldn't read the garments." } : h);
    } catch { setHelper((h) => h && h.name === name ? { ...h, gBusy: false, gErr: "Couldn't read the garments." } : h); }
  }
  // which line each garment on the sheet was put on as (its drawing goes there when it comes back)
  const gLine = useRef<Record<string, string>>({});
  /** draw a garment on the sheet to match its photo (Oct 27, Nick: "you're gonna get a bunch of images, all different
   *  ones… the website needs to be able to do the same thing"): the stock drawing shows right away, this one replaces it */
  async function helperDraw(name: string, gi: number, g: SheetGarment, pic: string) {
    setHelper((h) => h && h.name === name ? { ...h, gDraw: { ...(h.gDraw || {}), [gi]: { busy: true } } } : h);
    const crop = await jpegOf(pic, 1100, g.box).catch(() => pic);
    const r = await drawGarment(crop, { name: g.name, color: g.color, kind: g.kind });
    setHelper((h) => h && h.name === name ? { ...h, gDraw: { ...(h.gDraw || {}), [gi]: r.draw ? { draw: r.draw, what: r.what } : { err: r.error } } } : h);
    const lid = gLine.current[`${name}|${gi}`];
    if (r.draw && lid) setLines((ls) => ls.map((x) => (x.id === lid ? { ...x, look: { ...(x.look || {}), draw: r.draw } } : x)));
  }
  async function helperRead(f: File) {
    // a picture (a photo of the garment, a screenshot): the art is flattened into it, but the garments on it are read and
    // can be drawn (Oct 27, Nick: "you're gonna get a bunch of images")
    if (!portal && (/\.(jpe?g|png|webp)$/i.test(f.name) || /^image\/(jpeg|png|webp)$/i.test(f.type))) {
      setHelpOpen(true);
      setHelper({ name: f.name, busy: "", rows: [], pms: [], inkOpts: [], err: "This is a picture, so the art is flattened into the shirt and isn't pulled off it (use the PDF or Illustrator file for the art). The garments on it are read below, to draw." });
      const u = URL.createObjectURL(f);
      const pic = await jpegOf(u, 1400).catch(() => "");
      URL.revokeObjectURL(u);
      if (pic) await readGarments(f.name, pic);
      else setHelper((h) => h && { ...h, gErr: "Couldn't open that picture." });
      return;
    }
    if (!/\.(pdf|ai)$/i.test(f.name) && !/pdf|postscript|illustrator/i.test(f.type)) { setHelper({ name: f.name, busy: "", rows: [], pms: [], inkOpts: [], err: "Use the PDF or Illustrator file (saved PDF-compatible). A picture (JPG, PNG) has the art flattened into the shirt." }); return; }
    setHelpOpen(true);
    setHelper({ name: f.name, busy: "Reading the file…", rows: [], pms: [], inkOpts: [], file: f, keepFile: true });
    try {
      const buf = await f.arrayBuffer();
      const base = f.name.replace(/\.(pdf|ai)$/i, "").replace(/[ _-]*mock-?up$/i, "").replace(/_/g, " ");
      const pms = await pmsOnPage(buf.slice(0));
      // what garments the sheet shows (Oct 27, Nick: "pull art off and then draw blank"): read by the AI from a picture of
      // the page while the art is pulled; shown as "The garments on this sheet" with Draw this blank
      if (!portal) void (async () => {
        try { const c = await pdfPicture(buf.slice(0), 1400); await readGarments(f.name, c.toDataURL("image/jpeg", 0.82)); }
        catch { setHelper((h) => h && { ...h, gBusy: false }); }
      })();
      setHelper((h) => h && { ...h, busy: "Looking for the shirts and the art on them…" });
      type P = { side: "front" | "back"; file: File; widthIn: number; heightIn: number; dropIn: number; offIn: number; mask?: File; maskPpi?: number; shirtHex?: string };
      let kind: "photos" | "drawn" | "art" = "photos";
      let got: P[] = await artFromMockupPdf(buf.slice(0), base, { mergeIn: 1 }).catch(() => []);
      if (!got.length) { kind = "drawn"; got = await artFromDrawnMockup(buf.slice(0), base).catch(() => []); }
      if (!got.length) {
        kind = "art";
        const a = await artFromArtPdf(buf.slice(0), base).catch(() => null);
        if (a) got = [{ side: "front", file: a.file, widthIn: 10, heightIn: Math.round(10 * a.ratio * 4) / 4, dropIn: 3, offIn: 0, ...(a.mask ? { mask: a.mask } : {}) }];
      }
      if (!got.length) { setHelper((h) => ({ name: f.name, busy: "", rows: [], pms, inkOpts: pms, err: "I couldn't find any art on it. If it's an Illustrator file, save it with \"Create PDF Compatible File\" on.", ...(h && h.name === f.name ? { garments: h.garments, gBusy: h.gBusy, gErr: h.gErr, file: h.file, keepFile: h.keepFile } : {}) })); return; }
      setHelper((h) => h && { ...h, busy: "Reading the colors…" });
      // the biggest print on each side first; a second one at a spot that's taken waits unchecked
      got.sort((x, y) => Number(x.side === "back") - Number(y.side === "back") || y.widthIn * y.heightIn - x.widthIn * x.heightIn);
      const taken = new Set<string>(), rows: HelpRow[] = [];
      // the shirt's color on this file (most common among the prints' readings)
      const sh = got.map((g) => g.shirtHex).filter(Boolean) as string[];
      const shirt = sh.sort((a, b) => sh.filter((x) => x === b).length - sh.filter((x) => x === a).length)[0] || "";
      let knocked = 0;
      for (const [i, pc0] of got.entries()) {
        let pc = pc0;
        let url = URL.createObjectURL(pc.file);
        let img = await loadImg(url).catch(() => null);
        let cols = img ? detectColors(img, 6).filter((c) => c.share >= 0.02) : [];
        // art in the shirt's own color is the shirt showing through (Oct 22, Nick: "if you see a blue shirt and the art
        // has that blue… it should just knock it out and say remove that color, that's the shirt")
        const sc = pc.shirtHex || shirt;
        if (sc && cols.some((c) => deltaE(c.hex, sc) < 10)) {
          const f2 = await knockColor(pc.file, sc).catch(() => null);
          if (f2) {
            URL.revokeObjectURL(url); pc = { ...pc, file: f2 }; url = URL.createObjectURL(f2); knocked++;
            img = await loadImg(url).catch(() => null); cols = img ? detectColors(img, 6).filter((c) => c.share >= 0.02 && deltaE(c.hex, sc) >= 10) : [];
          }
        }
        // each color: the nearest PMS written on the page (when it's close), else our closest ink
        const inks: string[] = [];
        for (const c of cols) {
          const near = pms.map((n) => ({ n, e: deltaE(c.hex, colorHex(n) || "#000000") })).sort((a, b) => a.e - b.e)[0];
          const name = near && near.e < 30 ? near.n : (() => { const s0 = suggestInk(c.hex); return s0.rec === "pms" ? s0.pms.name : s0.standard.name; })();
          if (name && !inks.includes(name)) inks.push(name);
        }
        const location = locOfPulled(pc.side, pc.widthIn, pc.dropIn, pc.offIn);
        const hx = (cols[0]?.hex || "#000000").replace("#", "");
        const lum = (0.299 * parseInt(hx.slice(0, 2), 16) + 0.587 * parseInt(hx.slice(2, 4), 16) + 0.114 * parseInt(hx.slice(4, 6), 16)) / 255;
        // a texture over it in the file: the customer's own saved mask goes back on instead (sharp, the same on every logo
        // of theirs), else the file's; none in the file, none here
        const distress: HelpRow["distress"] = pc.mask ? (brandMask ? "brand" : "file") : "none";
        const row: HelpRow = { key: `r${i}`, file: pc.file, url, side: pc.side, location, widthIn: pc.widthIn, heightIn: pc.heightIn, dropIn: pc.dropIn, inks, use: !taken.has(location) && (pc.widthIn >= 1 || pc.heightIn >= 1), light: lum > 0.7, mask: pc.mask, maskPpi: pc.maskPpi, distress };
        if (distress !== "none") { const dd = await distressRow(row, distress).catch(() => null); if (dd) Object.assign(row, dd); else row.distress = "none"; }
        rows.push(row);
        taken.add(location);
      }
      const notes = await proofNotes(buf.slice(0)).catch(() => []);
      setHelper((h) => ({ name: f.name, busy: "", kind, rows, pms, inkOpts: [...new Set([...pms, ...rows.flatMap((r) => r.inks)])], notes, ...(shirt ? { shirtHex: shirt } : {}), knocked, ...(h && h.name === f.name ? { garments: h.garments, gBusy: h.gBusy, gErr: h.gErr, file: h.file, keepFile: h.keepFile } : {}) }));
    } catch (e) { setHelper({ name: f.name, busy: "", rows: [], pms: [], inkOpts: [], err: "Couldn't read it: " + (e instanceof Error ? e.message : String(e)) }); }
  }
  const helpSet = (key: string, ch: Partial<HelpRow>) => setHelper((h) => h && { ...h, rows: h.rows.map((r) => (r.key === key ? { ...r, ...ch } : r)) });
  /** the art with its distress, as the mockup shows it: one layer of the mask, the shirt showing through */
  async function distressRow(r: HelpRow, how: HelpRow["distress"]): Promise<Partial<HelpRow> | null> {
    if (how === "none") return { distress: "none", dfile: undefined, durl: undefined };
    const mask = how === "brand" ? brandMask?.url : r.mask;
    if (!mask) return null;
    const dfile = await applyDistress(r.file, mask, { layers: 1, fit: how === "brand" ? "cover" : "stretch", name: r.file.name.replace(/\.png$/i, "") + " distressed.png" });
    return { distress: how, dfile, durl: URL.createObjectURL(dfile) };
  }
  const helpDistress = async (r: HelpRow, how: HelpRow["distress"]) => { const ch = await distressRow(r, how).catch(() => null); if (ch) helpSet(r.key, ch); };
  /** the texture in this file saved as the customer's distress mask (brand standards), for every logo of theirs after */
  async function saveBrandMask(r: HelpRow) {
    if (!customerId || !r.mask) return;
    const path = `brand/${customerId}/distress-${Date.now().toString(36)}.png`;
    const up = await sb.storage.from("proofs").upload(path, r.mask, { contentType: "image/png" });
    if (up.error) return setMsg("Couldn't save the mask: " + up.error.message);
    const { data } = await sb.from("customers").select("brand_print").eq("id", customerId).maybeSingle();
    const bp = (data?.brand_print || {}) as Record<string, unknown>;
    const { error } = await sb.from("customers").update({ brand_print: { ...bp, distress: { path, name: `From ${helper?.name || "a mockup"}`, layers: 3 } } }).eq("id", customerId);
    if (error) return setMsg("Couldn't save the mask: " + error.message);
    const { data: su } = await sb.storage.from("proofs").createSignedUrl(path, 3600);
    if (su?.signedUrl) setBrandMask({ path, url: su.signedUrl, name: `From ${helper?.name || "a mockup"}`, layers: 3 });
    setMsg("Saved as the customer's distress mask (Brand standards). Every logo of theirs can use it now.");
  }
  /** Helper → Put on the mockup: each checked print saved to the customer's logos and put at its location */
  async function helperApply() {
    if (!helper) return;
    if (!customerId) return setMsg("Pick the customer first. The art is saved to their account.");
    const rows = helper.rows.filter((r) => r.use);
    if (!rows.length) return setMsg("Check at least one print.");
    setHelper((h) => h && { ...h, busy: "Saving the art…" });
    try {
      const { data: u } = await sb.auth.getUser();
      const base = helper.name.replace(/\.(pdf|ai)$/i, "").replace(/_/g, " ");
      const made: { im: Imprint; d: Design }[] = [];
      for (const r of rows) {
        // distressed: the distressed picture is the logo, the clean one its "Distress: off"; the film stacks the mask (3 layers)
        const dz = r.distress !== "none" && r.dfile;
        const how = r.distress === "brand" ? `${brandMask?.name || "their mask"}, ${brandMask?.layers || 3} layers on the film (black composite film)` : r.distress === "file" ? "the texture in the file, 3 layers on the film (black composite film)" : "";
        // the mask itself is kept with the logo, so the separation can stack it for the film (the customer's, or this file's)
        let maskPath = r.distress === "brand" ? brandMask?.path : "";
        if (dz && r.distress === "file" && r.mask) { const mp = `masks/${customerId}/${Date.now().toString(36)}-${r.key}.png`; const up = await sb.storage.from("proofs").upload(mp, r.mask, { contentType: "image/png" }); if (!up.error) maskPath = mp; }
        const d = await uploadDesign(sb, { draft: true, file: dz ? r.dfile! : r.file, ...(dz ? { preview: r.dfile!, clean: r.file, distress: { mask: maskPath || undefined, layers: r.distress === "brand" ? brandMask?.layers || 3 : 3, fit: r.distress === "brand" ? "cover" : "stretch", note: how } } : {}), customer_id: customerId, name: `${base} ${r.side}`, colors: Math.max(1, r.inks.length), inks: r.inks.join(", "), notes: `Pulled from ${helper.name}${dz ? `. Distress: ${how}` : ""}`, by: u.user?.email || "" });
        made.push({ d, im: { ...newImprint(r.location), design_id: d.id, size: `${r.widthIn}" wide`, inks: r.inks.join(", "), colors: Math.max(1, r.inks.length), notes: `From ${helper.name}: ${r.widthIn}" × ${r.heightIn}"${helper.kind !== "art" ? `, ${r.dropIn}" below the collar there` : ""}${dz ? `. Distress: ${how}` : ""}` } });
      }
      setDesigns((x) => [...made.map((m) => m.d), ...x]);
      setUrls({ ...urls, ...(await previewUrls(sb, made.map((m) => m.d))) });
      // each print takes its location's spot when it's there (the art replaced), else an empty spot on that side, else a new one
      setImprints((xs) => {
        let out = [...xs];
        for (const { im } of made) {
          const same = out.find((x) => x.location === im.location) || out.find((x) => !x.design_id && !qt[x.id] && sideOf(x.location) === sideOf(im.location));
          out = same ? out.map((x) => (x.id === same.id ? { ...x, design_id: im.design_id, location: im.location, size: im.size, inks: im.inks, colors: im.colors, drop: "", notes: [x.notes, im.notes].filter(Boolean).join(". ").slice(0, 300) } : x)) : [...out, im];
        }
        return out;
      });
      setRasterOk((r) => ({ ...r, ...Object.fromEntries(made.map((m) => [m.d.id, true])) })); // drawn at 300 dpi off the vector art: no "picture file" warning
      setTab(sideOf(made[0].im.location));
      // the customer's own mockup goes on the order as a production file (Oct 27, Nick: "include the document along with
      // the mockup as a production file… a checkmark"), once
      if (orderId && helper.keepFile && helper.file) {
        const f = helper.file, label = `Customer's mockup: ${f.name}`.slice(0, 200);
        const { data: have } = await sb.from("art_files").select("id").eq("order_id", orderId).eq("name", label).limit(1);
        if (!have?.length) {
          const path = `art/${orderId}/${uid()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
          const up = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined, upsert: false });
          if (!up.error) await sb.from("art_files").insert({ order_id: orderId, name: label, file_path: path, file_type: f.type || "application/pdf", note: "The customer's sheet the mockup was made from (Mockup Creator Helper)" });
        }
      }
      helper.rows.forEach((r) => { URL.revokeObjectURL(r.url); if (r.durl) URL.revokeObjectURL(r.durl); });
      setHelper(null);
      setMsg(`Put ${made.map((m) => `${m.im.location} (${m.im.size})`).join(" and ")} on the mockup from ${helper.name}. Check the sizes against the art.`);
    } catch (e) { setHelper((h) => h && { ...h, busy: "", err: "Couldn't save the art: " + (e instanceof Error ? e.message : String(e)) }); }
  }

  async function uploadNew(im: Imprint, f: File) {
    if (!customerId) return setMsg("Pick the customer first. New art is saved to their account.");
    try {
      let d: Design;
      if (portal) {
        // customers upload straight to storage with a one-time link, then the server records the logo
        const r = await uploadMyLogo(sb, f, undefined, { draft: true });
        d = r.design;
        setDesigns((x) => [d, ...x.filter((y) => y.id !== d.id)]);
        if (r.url) setUrls((x) => ({ ...x, [d.id]: r.url }));
        setImprints((xs) => xs.map((x) => (x.id === im.id ? swapLogo(x, d) : x)));
        askRaster(im.id, d);
        setMsg(`Added ${designLabel(d)} to this mockup.`);
        return;
      }
      const { data: u } = await sb.auth.getUser();
      d = await uploadDesign(sb, { draft: true, file: f, customer_id: customerId, by: u.user?.email || "" });
      setDesigns((x) => [d, ...x.filter((y) => y.id !== d.id)]);
      setUrls({ ...urls, ...(await previewUrls(sb, [d])) });
      setImprints((xs) => xs.map((x) => (x.id === im.id ? swapLogo(x, d) : x)));
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
      const bg = await loadImg(photo(l, v)).catch(() => loadImg(drawn(l, v)));
      const u = photo(l, v), fit = u.startsWith("data:") ? null : fitFor(l, v, fits[u] || measureFor(l, bg, v));
      // the shirt at the same size as on screen (every photo zoomed to fill the frame like the reference tee); kept to its own cell
      const nm = frameOf(l, v);
      main.save(); main.beginPath(); main.rect(ox, oy, pw, ph); main.clip();
      // fitted inside the frame the way it was measured and is shown on screen (object-fit: contain), not stretched: a SanMar
      // photo (2:3) stretched to the 4:5 frame came out 20% wider than the S&S shirts next to it (Oct 20, PC55RS)
      const cr = containRect(bg);
      main.drawImage(bg, ox + (nm.tx + nm.z * cr.x) * k, oy + (nm.ty + nm.z * cr.y) * k, cr.w * nm.z * k, cr.h * nm.z * k);
      main.restore();
      // art goes on its own layer, then gets cut to the shirt outline before it's added to the picture
      const layer = document.createElement("canvas"); layer.width = c.width; layer.height = c.height;
      const x = layer.getContext("2d")!;
      if (crop) x.translate(-crop.x * k, -crop.y * k);
      for (const im of imprints.filter((m) => viewsFor(m.location).includes(v))) {
        const p = place(im, v, fit, l);
        if (!p.d || !artUrl(im, l)) continue;
        const art = await loadImg(artUrl(im, l)).catch(() => null);
        if (art) {
          x.save();
          x.translate(ox + (nm.tx + nm.z * (p.x + p.w / 2)) * k, oy + (nm.ty + nm.z * (p.y + p.h / 2)) * k);
          if (p.rot) x.rotate((p.rot * Math.PI) / 180);
          const kz = k * nm.z;
          if (p.clip) { x.beginPath(); x.rect(p.clip === "left" ? (-p.w / 2) * kz : 0, (-p.h / 2) * kz, (p.w / 2) * kz, p.h * kz); x.clip(); }
          x.drawImage(art, (-p.w / 2) * kz, (-p.h / 2) * kz, p.w * kz, p.h * kz);
          x.restore();
        }
      }
      if (fit?.mask) {
        const m = await loadImg(fit.mask).catch(() => null);
        if (m) { x.globalCompositeOperation = "destination-in"; x.drawImage(m, ox + nm.tx * k, oy + nm.ty * k, pw * nm.z, ph * nm.z); x.globalCompositeOperation = "source-over"; }
      }
      main.save(); main.setTransform(1, 0, 0, 1, 0, 0); main.drawImage(layer, 0, 0); main.restore();
    }
    return c;
  }

  /** Draw one garment color with every imprint, plus a spec strip, as a PNG. */
  /** bare = just the shirt photos with the art (the thumbnail on the order), no title or spec lines. */
  async function render(l: Line, bare = false): Promise<Blob> {
    // the bare picture (order screen, work order, invoice, review page) is as big as the proof (Oct 16, Nick: "we need
    // good resolution, high quality"): about 1,240 px wide per view, saved as a JPEG so it stays light (~250 KB)
    const k = 0.6, pw = PHOTO_W * k, ph = PHOTO_H * k, pad = bare ? 10 : 24, top = bare ? pad : 70;
    // a visual-only print (a reorder waiting for production) gets no details under the shirt: no location, logo number or
    // size (Oct 20, Nick: "when we're doing a visual only mockup, that whole bottom section should just be blank")
    const specs = imprints.filter((im) => !(im.visualOnly && !im.confirmed)).map((im) => { const p = place(im); return { col: Math.max(0, views.indexOf(viewsFor(im.location)[0])), t: `${im.location}: ${p.d ? designLabel(p.d) : "no logo"} · ${p.wIn.toFixed(1)}" × ${(p.hIn || 0).toFixed(1)}"${im.inks ? " · " + im.inks : ""}` }; });
    const quiet = specs.length === 0;
    // each print's line sits under its own side: the back's under BACK (Oct 24, Nick: the back column was empty and every
    // line ran under FRONT), wrapped to the column
    const mx = document.createElement("canvas").getContext("2d")!; mx.font = "15px Helvetica, Arial, sans-serif";
    const wrapTo = (t: string, w: number) => { const out: string[] = []; let cur = ""; for (const wd of t.split(" ")) { const n = cur ? cur + " " + wd : wd; if (cur && mx.measureText(n).width > w) { out.push(cur); cur = wd; } else cur = n; } if (cur) out.push(cur); return out; };
    const cols = views.map((_, i) => specs.filter((sp) => sp.col === i).flatMap((sp) => wrapTo(sp.t, pw - 8)));
    const rows = Math.max(1, ...cols.map((c) => c.length));
    const W = pad * 2 + views.length * pw + (views.length - 1) * pad;
    const H = bare ? ph + pad * 2 : quiet ? 70 + ph + pad : 70 + ph + 30 + rows * 22 + pad;
    // the saved proof at twice the size (thumbnails as they were), the photos drawn at that size: sharp when zoomed
    const S = 2, c = document.createElement("canvas");
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
    // Private Label: the inside of the neck with their label, in the top corner of the last photo (Oct 20, Nick: "it
    // needs to be something we add to the mock-up, just like the sleeve… show the tag removed and it printed inside")
    if (neckSet) {
      const lab = await labelFor(neckSet, neckSize, guessHex(l.color)).catch(() => null);
      const iw = Math.round(pw * 0.34), ih = Math.round(iw * 0.8), ix = pad + (views.length - 1) * (pw + pad) + pw - iw - 6, iy = top + 6;
      x.save(); x.shadowColor = "rgba(0,0,0,0.18)"; x.shadowBlur = 8; x.fillStyle = "#fff"; x.beginPath(); x.roundRect(ix - 3, iy - 3, iw + 6, ih + 26, 8); x.fill(); x.restore();
      drawNeckView(x, ix, iy, iw, ih, guessHex(l.color), lab, neckSet.widthIn || 2.5, `Inside neck · ${neckSize}`);
    }
    if (!bare && !quiet) {
      x.fillStyle = "#7A8599"; x.font = "600 13px Helvetica, Arial, sans-serif";
      views.forEach((v, i) => x.fillText(v.toUpperCase(), pad + i * (pw + pad), top + ph + 18));
      x.fillStyle = "#141D2B"; x.font = "15px Helvetica, Arial, sans-serif"; cols.forEach((c, ci) => c.forEach((s, i) => x.fillText(s, pad + ci * (pw + pad), top + ph + 42 + i * 22)));
    }
    return await new Promise((res) => (bare ? c.toBlob((b) => res(b!), "image/jpeg", 0.9) : c.toBlob((b) => res(b!), "image/png")));
  }

  /** A close-up of one print on the shirt: the print area with a little shirt around it, square, `size` px. */
  async function closeUpCanvas(l: Line, im: Imprint, size: number): Promise<HTMLCanvasElement | null> {
    const v = viewsFor(im.location)[0]; if (!v) return null;
    const u = photo(l, v);
    const bg = await loadImg(u).catch(() => loadImg(drawn(l, v)));
    const fit = u.startsWith("data:") ? null : fitFor(l, v, fits[u] || measureFor(l, bg, v));
    const p = place(im, v, fit, l); if (!p.d) return null;
    // the print with a little shirt around it, drawn straight at the size it's shown (not cut from a smaller picture)
    const nm = frameOf(l, v);
    const side = Math.min(PHOTO_W, Math.max(120, Math.max(p.w, p.h) * nm.z * (p.rot ? 1.35 : 1.12)));
    const cx = nm.tx + nm.z * (p.x + p.w / 2), cy = nm.ty + nm.z * (p.y + p.h / 2);
    const crop = { x: Math.max(0, Math.min(PHOTO_W - side, cx - side / 2)), y: Math.max(0, Math.min(PHOTO_H - side, cy - side / 2)), w: side, h: side };
    return photosCanvas(l, size / side, 0, [v], crop);
  }

  /**
   * The customer PDF: one landscape Letter page per garment color: the shirts, a close-up of every print (location,
   * size, inks), and the garment. Our logo and contact, and the customer's company name, are each on or off (an FBS
   * proof with no company name, or the company's own name with no FBS logo, or both).
   */
  /** Sales tools → Sales sheet creator (components/SalesSheet.tsx): the shop's name, contact and logo for it */
  async function openSheet() {
    // a customer's sheet carries their company (Oct 24, Nick: "the same button… put their company on there… to share
    // with their clients"): their logo and contact line from their Settings, never ours
    if (portal) {
      const b = await mySheetBrand();
      setSheetShop(b.ok ? { name: b.name, line: b.line, logoUrl: b.logoUrl } : { name: "", line: "", logoUrl: "" });
      setSheetOpen(true);
      return;
    }
    let shop = { name: "FBS Print", phone: "", email: "", address: "", logoUrl: "" };
    const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle();
    if (data?.data) shop = { ...shop, ...(mergeSettings(data.data as Record<string, unknown>).shop || {}) };
    setSheetShop({ name: shop.name, line: [shop.name, fmtPhone(shop.phone), shop.email].filter(Boolean).join("  ·  "), logoUrl: shop.logoUrl || "/brand/fbs-logo.svg" });
    setSheetOpen(true);
  }
  /** one color's shirts side by side, about h px tall, for the sales sheet */
  async function sheetShirts(key: string, sides: View[], h: number) {
    const l = lines.find((x) => x.id === key);
    if (!l) throw new Error("That color isn't on the mockup anymore.");
    await loadShirtFonts().catch(() => {});
    return photosCanvas(l, h / PHOTO_H, Math.round(h * 0.03), sides);
  }

  /**
   * The proof PDF, laid out like the order's art proof (app/print/[id] ProofDoc) so both look and read the same (Oct 22,
   * Nick: "I like what you did on the proof on the order itself… I just want to use that logic"): page 1 the first
   * shirt big with who it's for, the prints, the garments and the approval box (fill-in checkboxes, notes, signature,
   * name, date); then each other shirt color on its own page, full width (the same style and color once); then each
   * print blown up on the shirt color with its size drawn on, the largest print area, placement, how it's printed and
   * its inks. Drawn from what's on screen (the drags on each color included), at 300 dpi.
   */
  async function exportPdf(o: { ours: boolean; company: boolean; description: string; /** private label: their own name and logo on top */ brand?: { name: string; logoUrl: string }; /** who it's for, typed (a customer's own client) */ forName?: string }) {
    const todo = lines.filter((z) => z.style || z.color);
    if (!todo.length) return setMsg("Add a garment and color first.");
    if (!imprints.some((im) => designOf(im))) return setMsg("Put a logo on the shirt first.");
    setPdfBusy(true); setMsg("Making the PDF…");
    try {
      await loadShirtFonts().catch(() => {});
      await Promise.all(["800 40px Archivo", '400 20px "Public Sans"', '600 20px "Public Sans"', '700 20px "Public Sans"', '800 20px "Public Sans"'].map((f) => document.fonts.load(f).catch(() => null)));
      let shop = { name: "FBS Print", phone: "", email: "", address: "", logoUrl: "" };
      if (!portal) { const { data } = await sb.from("settings").select("data").eq("id", 1).maybeSingle(); if (data?.data) shop = { ...shop, ...(mergeSettings(data.data as Record<string, unknown>).shop || {}) }; }
      if (o.brand) shop = { ...shop, name: o.brand.name, logoUrl: o.brand.logoUrl };
      const logo = o.ours ? (o.brand ? (o.brand.logoUrl ? await loadImg(o.brand.logoUrl).catch(() => null) : null) : await loadImg(shop.logoUrl || "/brand/fbs-logo.svg").catch(() => null)) : null;
      const cust = customers.find((c) => c.id === customerId);
      // layout in units of 1/200": the order proof's sizes (inches, points, CSS px) turned into these
      const DPI = 200, PW = 8.5 * DPI, PH = 11 * DPI, R = 1.5, IN = DPI, PT = DPI / 72, PX = DPI / 96;
      const L = 0.45 * IN, CW = PW - 2 * L, TOP = 0.42 * IN, BOT = PH - 0.32 * IN;
      const C = { ink: "#141D2B", ink2: "#3c4658", ink3: "#6b7587", line: "#d6dbe3", ok: "#1a8a5a" };
      const body = (w: number, pt: number) => `${w} ${pt * PT}px "Public Sans", Arial, sans-serif`;
      const disp = (pt: number) => `800 ${pt * PT}px Archivo, "Arial Narrow", sans-serif`;
      const dark = (hex: string) => { const h = hex.replace("#", ""); if (h.length !== 6) return false; const [r, g, b2] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.299 * r + 0.587 * g + 0.114 * b2 < 120; };
      const prints = imprints.filter((im) => designOf(im) || im.visualOnly);
      const MATCH_PREV = "Printed to match your previous order";
      const sizeOf = (im: Imprint) => { const w = printWidth(im, im.location, ratioIm(im)); return { w, h: w * (ratioIm(im) || 0.6) }; };
      const sizeLabel = (im: Imprint) => { const z = sizeOf(im); return z.w > 0 ? `${z.w.toFixed(2)}" W × ${z.h.toFixed(2)}" H` : ""; };
      const inkNamesOf = (im: Imprint) => im.visualOnly ? [] : inkList(im).map((t) => ({ name: t.name.startsWith("As uploaded") ? "As uploaded" : t.name, hex: t.hex || "#cccccc" }));
      // the garment pages: one per style and color (lines of the same style and color are the same picture)
      const keyOf = (l: Line) => `${(l.style || "").trim().toLowerCase()}|${(l.color || "").trim().toLowerCase()}`;
      const shirts = todo.filter((l, i) => todo.findIndex((y) => keyOf(y) === keyOf(l)) === i);
      const capOf = (l: Line) => [[l.brand, l.style].filter(Boolean).join(" "), l.color].filter(Boolean).join(" · ");
      const total = 1 + (shirts.length - 1) + prints.length;
      const who = o.company && cust ? [cust.company || cust.name, cust.company && cust.name && cust.name !== cust.company ? cust.name : ""].filter(Boolean).join(" · ") : "";
      const jobName = order?.nickname || groupName || "Mockup";
      const pages: { jpeg: Uint8Array }[] = [];
      const fields: { page: number; kind: "check" | "text"; name: string; x: number; y: number; w: number; h: number; multi?: boolean }[] = [];
      let pageNo = 0;

      const newPage = () => {
        const c = document.createElement("canvas"); c.width = Math.round(PW * R); c.height = Math.round(PH * R);
        const x = c.getContext("2d")!; x.scale(R, R); x.imageSmoothingQuality = "high";
        x.fillStyle = "#ffffff"; x.fillRect(0, 0, PW, PH); x.textBaseline = "alphabetic";
        pageNo++;
        return { c, x };
      };
      const wrap = (x: CanvasRenderingContext2D, t: string, w: number) => {
        const out: string[] = []; let row = "";
        for (const word of t.split(/\s+/).filter(Boolean)) { const tr = row ? row + " " + word : word; if (x.measureText(tr).width > w && row) { out.push(row); row = word; } else row = tr; }
        if (row) out.push(row); return out;
      };
      const fit = (x: CanvasRenderingContext2D, t: string, w: number) => { if (x.measureText(t).width <= w) return t; let s2 = t; while (s2.length > 1 && x.measureText(s2 + "…").width > w) s2 = s2.slice(0, -1); return s2.trimEnd() + "…"; };
      const rrect = (x: CanvasRenderingContext2D, rx: number, ry: number, w: number, h: number, r: number) => { x.beginPath(); x.roundRect(rx, ry, w, h, r); };
      const lbl = (x: CanvasRenderingContext2D, t: string, lx: number, ly: number, pt = 9) => {
        x.fillStyle = C.ink3; x.font = body(700, pt); x.letterSpacing = `${0.06 * pt * PT}px`; x.fillText(t.toUpperCase(), lx, ly); x.letterSpacing = "0px";
      };
      const foot = (x: CanvasRenderingContext2D) => {
        x.fillStyle = C.ink3; x.font = body(400, 8.5);
        x.fillText(fit(x, ["Art proof", order ? `#${order.number} ${order.nickname || ""}`.trim() : groupName, who].filter(Boolean).join(" · "), CW * 0.75), L, BOT);
        x.textAlign = "right"; x.fillText(`Page ${pageNo} of ${total}`, PW - L, BOT); x.textAlign = "left";
      };
      const done = async (pg: { c: HTMLCanvasElement; x: CanvasRenderingContext2D }) => { foot(pg.x); pages.push(await canvasPage(pg.c, 612, 792, 0.95)); };
      /** the second-page header: a big title on the left, the order on the right, a heavy rule under them */
      const head2 = (x: CanvasRenderingContext2D, title: string, right: string) => {
        x.fillStyle = C.ink; x.font = disp(20); x.fillText(fit(x, title, CW * 0.62), L, TOP + 20 * PT);
        x.fillStyle = C.ink2; x.font = body(400, 11); x.textAlign = "right"; x.fillText(fit(x, right, CW * 0.36), PW - L, TOP + 20 * PT); x.textAlign = "left";
        const y = TOP + 20 * PT + 6 * PX + 4 * PT;
        x.fillStyle = C.ink; x.fillRect(L, y, CW, 2 * PX);
        return y + 2 * PX;
      };
      /** a shirt's front and back as big as fits w × h, centered in the box */
      const shirtsIn = async (x: CanvasRenderingContext2D, l: Line, bx: number, by: number, w: number, h: number) => {
        const n = Math.max(1, views.length), gap = 0.2 * IN;
        const k = Math.min((w - (n - 1) * gap) / (n * PHOTO_W), h / PHOTO_H);
        const hi = await photosCanvas(l, k * R, gap * R), sw = hi.width / R, sh = hi.height / R;
        const sx = bx + (w - sw) / 2, sy = by + (h - sh) / 2;
        x.drawImage(hi, sx, sy, sw, sh);
        return { sx, sy, sw, sh };
      };

      // ── page 1: the cover ──
      {
        const pg = newPage(), x = pg.x, first = shirts[0];
        let y = TOP;
        // the top: our logo on the left; "Art Proof", the order and the date on the right
        if (logo) { const lh = 0.5 * IN, lw = Math.min(2.6 * IN, ((logo.naturalWidth || 4) / (logo.naturalHeight || 1)) * lh); x.drawImage(logo, L, y, lw, lh); }
        else if (o.ours) { x.fillStyle = C.ink; x.font = disp(20); x.fillText(shop.name, L, y + 20 * PT); }
        x.textAlign = "right";
        x.fillStyle = C.ink; x.font = disp(22); x.fillText("Art Proof", PW - L, y + 20 * PT);
        x.fillStyle = C.ink2; x.font = body(400, 11); x.fillText(fit(x, [order ? `#${order.number}` : "", groupName && groupName !== order?.nickname ? groupName : ""].filter(Boolean).join(" · ") || jobName, CW * 0.5), PW - L, y + (22 + 4 + 11) * PT);
        x.fillStyle = C.ink3; x.font = body(400, 9); x.fillText(`Prepared ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`, PW - L, y + (22 + 4 + 11 + 3 + 10) * PT);
        x.textAlign = "left";
        y += Math.max(0.5 * IN, (22 + 4 + 11 + 3 + 10 + 3) * PT) + 12 * PX;
        // who it's for, the job, in hands
        const cols: { k: string; b: string; f: string; w: number }[] = [];
        if (o.forName !== undefined) { if (o.forName.trim()) cols.push({ k: "For", b: o.forName.trim(), f: "", w: 1.6 }); }
        else if (who) cols.push({ k: "For", b: cust?.company || cust?.name || "—", f: [cust?.company && cust?.name && cust.name !== cust.company ? cust.name : "", cust?.email].filter(Boolean).join(" · "), w: 1.6 });
        cols.push({ k: "Job", b: jobName, f: [order?.po_number ? `PO ${order.po_number}` : "", o.description.trim()].filter(Boolean).join(" · "), w: 1.2 });
        if (order) {
          const d = parseDate(order.due_date);
          cols.push({ k: "In hands", b: d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).replace(",", "") : "To be set", f: ({ pickup: "Pickup", ship: "Ship", deliver: "Delivery" } as Record<string, string>)[order.delivery_method] || "Pickup", w: 0.9 });
        }
        x.fillStyle = C.ink; x.fillRect(L, y, CW, 2 * PX);
        const gapC = 16 * PX, totW = cols.reduce((a, c) => a + c.w, 0), usable = CW - gapC * (cols.length - 1);
        let cx = L, maxH = 0;
        for (const col of cols) {
          const w = (usable * col.w) / totW; let cy = y + 2 * PX + 8 * PX + 7.5 * PT;
          lbl(x, col.k, cx, cy, 7.5); cy += 4 * PX + 12 * PT;
          x.fillStyle = C.ink; x.font = body(700, 12); x.fillText(fit(x, col.b, w), cx, cy);
          if (col.f) { x.fillStyle = C.ink3; x.font = body(400, 10); for (const r of wrap(x, col.f, w).slice(0, 2)) { cy += 2 * PX + 11.5 * PT; x.fillText(r, cx, cy); } }
          maxH = Math.max(maxH, cy - y); cx += w + gapC;
        }
        y += maxH + 8 * PX;
        x.fillStyle = C.line; x.fillRect(L, y, CW, 1 * PX); y += 1 * PX + 8 * PX;

        // from the bottom up: the approval box, then the prints and garments, then the picture fills what's left
        const okPad = 14 * PX, okW = CW - 2 * okPad;
        x.font = body(400, 9.5);
        const okText = wrap(x, "Spelling, art, ink colors, print sizes and placement. Ink colors are matched to the names listed (PMS or stock ink); colors on a screen or a home printer are close but not exact. Sizes are the printed size on the garment. We start production once this proof is approved.", okW);
        const boxes = ["Approved as shown", "Approved with the changes noted", "Changes needed, send a new proof"];
        x.font = body(400, 10);
        const boxRows: string[][] = [[]]; { let bw = 0; for (const t of boxes) { const w = 14 * PX + 7 * PX + x.measureText(t).width + 18 * PX; if (bw + w > okW && boxRows[boxRows.length - 1].length) { boxRows.push([]); bw = 0; } boxRows[boxRows.length - 1].push(t); bw += w; } }
        const okH = 8 * PX + 12 * PT * 1.35 + 3 * PX + okText.length * 9.5 * PT * 1.4 + 7 * PX + boxRows.length * 10 * PT * 1.6 + 8 * PX + 0.5 * IN + 32 * PX + 3 * PX + 8.5 * PT * 1.4 + 10 * PX;
        const okY = BOT - 8.5 * PT - 6 * PX - okH;
        // the box
        x.strokeStyle = C.ink; x.lineWidth = 2 * PX; rrect(x, L, okY, CW, okH, 12 * PX); x.stroke();
        let oy = okY + 8 * PX + 12 * PT;
        x.fillStyle = C.ink; x.font = body(800, 12); x.fillText("Please check everything before you approve", L + okPad, oy);
        oy += 0.35 * 12 * PT + 3 * PX;
        x.fillStyle = C.ink2; x.font = body(400, 9.5); for (const r of okText) { oy += 9.5 * PT * 1.4; x.fillText(r, L + okPad, oy - 0.3 * 9.5 * PT); }
        oy += 7 * PX;
        x.font = body(400, 10);
        for (const row of boxRows) {
          let bx = L + okPad; const by = oy + 10 * PT * 1.6;
          for (const t of row) {
            const cb = 14 * PX, ty = by - 0.35 * 10 * PT;
            x.strokeStyle = C.ink; x.lineWidth = 1.5 * PX; rrect(x, bx, ty - cb + 2 * PX, cb, cb, 3 * PX); x.stroke();
            fields.push({ page: 0, kind: "check", name: ["approved", "approved-with-changes", "changes-needed"][boxes.indexOf(t)], x: bx, y: ty - cb + 2 * PX, w: cb, h: cb });
            x.fillStyle = C.ink; x.fillText(t, bx + cb + 7 * PX, ty); bx += cb + 7 * PX + x.measureText(t).width + 18 * PX;
          }
          oy = by;
        }
        oy += 8 * PX;
        x.strokeStyle = C.line; x.lineWidth = 1 * PX; rrect(x, L + okPad, oy, okW, 0.5 * IN, 6 * PX); x.stroke();
        lbl(x, "Changes or notes", L + okPad + 7 * PX, oy + 3 * PX + 8.5 * PT, 8.5);
        fields.push({ page: 0, kind: "text", name: "changes", x: L + okPad + 3 * PX, y: oy + 16 * PX, w: okW - 6 * PX, h: 0.5 * IN - 19 * PX, multi: true });
        oy += 0.5 * IN + 32 * PX;
        const sg = 18 * PX, sw0 = okW - 2 * sg, sws = [2, 1.6, 1].map((f) => (sw0 * f) / 4.6);
        let sx = L + okPad;
        ["Signature", "Name", "Date"].forEach((t, i) => {
          x.fillStyle = C.ink; x.fillRect(sx, oy, sws[i], 1.5 * PX);
          lbl(x, t, sx, oy + 3 * PX + 8.5 * PT, 8.5);
          fields.push({ page: 0, kind: "text", name: t.toLowerCase(), x: sx, y: oy - 25 * PX, w: sws[i], h: 23 * PX });
          sx += sws[i] + sg;
        });

        // the prints (left) and the garments (right)
        const rowsP = prints.map((im) => ({ im, inks: inkNamesOf(im) }));
        const hP = rowsP.reduce((a, r) => a + 3 * PX + 10.5 * PT * 1.3 + (r.inks.length ? 3 * PX + 10 * PT * 1.3 : 0), 0);
        // the garments: each style once with its colors under it, each with a swatch, wrapping (Oct 22: 11 colors cut off)
        const garm = todo.filter((l, i) => todo.findIndex((y2) => `${y2.brand}|${y2.style}|${y2.color}`.toLowerCase() === `${l.brand}|${l.style}|${l.color}`.toLowerCase()) === i);
        const pw = (CW - 20 * PX) * (1.4 / 2.4), gx = L + pw + 20 * PX, gw = CW - pw - 20 * PX, rowG = 10.5 * PT * 1.3 + 3 * PX;
        const byStyle: { st: string; ls: Line[] }[] = [];
        for (const l of garm) { const st = [l.brand, l.style].filter(Boolean).join(" ") || "Garment"; const g = byStyle.find((z) => z.st === st); if (g) g.ls.push(l); else byStyle.push({ st, ls: [l] }); }
        /** where each color chip goes (x offset, row) under its style; draws when asked */
        const flow = (ls: Line[], draw?: { x0: number; y0: number }) => {
          x.font = body(400, 10); let ix = 0, row = 0;
          for (const l of ls) {
            const t = l.color || "—", w = 14 * PX + 6 * PX + x.measureText(t).width + 14 * PX;
            if (ix + w > gw && ix > 0) { ix = 0; row++; }
            if (draw) {
              const yy = draw.y0 + row * rowG;
              x.fillStyle = shirtHex(l); x.fillRect(draw.x0 + ix, yy - 11 * PX, 14 * PX, 14 * PX); x.strokeStyle = "rgba(0,0,0,.25)"; x.lineWidth = 1 * PX; x.strokeRect(draw.x0 + ix, yy - 11 * PX, 14 * PX, 14 * PX);
              x.fillStyle = C.ink2; x.fillText(fit(x, t, gw - 20 * PX), draw.x0 + ix + 20 * PX, yy);
            }
            ix += w;
          }
          return row + 1;
        };
        const hG = byStyle.reduce((a, g) => a + rowG + flow(g.ls) * rowG, 0);
        const sumH = 1 * PX + 6 * PX + 7.5 * PT * 1.3 + Math.max(hP, hG, 10.5 * PT * 1.3);
        const sumY = okY - 10 * PX - sumH;
        x.fillStyle = C.line; x.fillRect(L, sumY, CW, 1 * PX);
        let py = sumY + 1 * PX + 6 * PX + 7.5 * PT;
        lbl(x, "Prints", L, py, 7.5); lbl(x, "Garments", gx, py, 7.5);
        let gy = py;
        for (const r of rowsP) {
          py += 3 * PX + 10.5 * PT * 1.3;
          const how = r.im.visualOnly ? MATCH_PREV : [printHow(r.im), sizeLabel(r.im)].filter(Boolean).join(" · ");
          x.fillStyle = C.ink; x.font = body(700, 10.5); x.fillText(r.im.location, L, py);
          const lw = x.measureText(r.im.location).width;
          x.font = body(400, 10.5); x.fillText(fit(x, ` · ${how}`, pw - lw), L + lw, py);
          if (r.inks.length) {
            py += 3 * PX + 10 * PT * 1.3; let ix = L; x.font = body(400, 10);
            for (const t of r.inks) {
              const w = 14 * PX + 6 * PX + x.measureText(t.name).width + 12 * PX;
              if (ix + w > L + pw) break;
              x.fillStyle = t.hex; x.fillRect(ix, py - 11 * PX, 14 * PX, 14 * PX); x.strokeStyle = "rgba(0,0,0,.25)"; x.lineWidth = 1 * PX; x.strokeRect(ix, py - 11 * PX, 14 * PX, 14 * PX);
              x.fillStyle = C.ink2; x.fillText(t.name, ix + 20 * PX, py); ix += w;
            }
          }
        }
        if (!rowsP.length) { x.fillStyle = C.ink; x.font = body(400, 10.5); x.fillText("No prints yet.", L, py + 3 * PX + 10.5 * PT * 1.3); }
        for (const g of byStyle) {
          gy += rowG;
          x.fillStyle = C.ink; x.font = body(700, 10.5); x.fillText(fit(x, g.st, gw), gx, gy);
          const n = flow(g.ls, { x0: gx, y0: gy + rowG });
          gy += n * rowG;
        }

        // the first shirt, as big as the space between
        const capH = first && capOf(first) ? 4 * PX + 10.5 * PT * 1.3 : 0, heroTop = y, heroH = sumY - 8 * PX - heroTop - capH;
        if (first) {
          const s0 = await shirtsIn(x, first, L, heroTop, CW, heroH);
          if (capH) { x.fillStyle = C.ink2; x.font = body(600, 10.5); x.textAlign = "center"; x.fillText(capOf(first), PW / 2, s0.sy + s0.sh + 4 * PX + 10.5 * PT); x.textAlign = "left"; }
        }
        await done(pg);
      }

      // ── the other shirt colors, one to a page, full width ──
      for (const l of shirts.slice(1)) {
        const pg = newPage(), x = pg.x;
        const y = head2(x, capOf(l) || "Mockup", order ? `#${order.number} · ${order.nickname || ""}` : groupName) + 12 * PX;
        await shirtsIn(x, l, L, y, CW, Math.min(8.6 * IN, BOT - 8.5 * PT - 14 * PX - y));
        await done(pg);
      }

      // ── each print up close ──
      const first = shirts[0], hex = shirtHex(first), dk = dark(hex);
      for (let di = 0; di < prints.length; di++) {
        const im = prints[di], pg = newPage(), x = pg.x;
        let y = head2(x, im.location || "Print", `Print ${di + 1} of ${prints.length}${order ? ` · #${order.number}` : ""}`) + 12 * PX;
        // the art as big as the panel takes (6.6" × 5.7"), its real measurements drawn on
        const sz = sizeOf(im), max = spotFor(im.location);
        const APW = 6.6, APH = 5.7, s = sz.w && sz.h ? Math.min(APW / sz.w, APH / sz.h) : 0;
        const aw = (s ? sz.w * s : APW) * IN, ah = (s ? sz.h * s : APH) * IN, top = 0.45 * IN, panelH = 7 * IN;
        const cxm = L + CW / 2;
        x.save(); rrect(x, L, y, CW, panelH, 12 * PX); x.clip();
        x.fillStyle = hex; x.fillRect(L, y, CW, panelH);
        if (max && s > 0 && max.maxW * s < 7.4) {
          const mw = max.maxW * s * IN, mh = max.maxH * s * IN;
          x.setLineDash([6 * PX, 4 * PX]); x.lineWidth = 2 * PX; x.strokeStyle = dk ? "rgba(255,255,255,.4)" : "rgba(0,0,0,.3)";
          rrect(x, cxm - mw / 2, y + top, mw, mh, 4 * PX); x.stroke(); x.setLineDash([]);
          x.fillStyle = dk ? "rgba(255,255,255,.7)" : "rgba(0,0,0,.55)"; x.font = body(400, 9);
          x.fillText(`largest print area ${max.maxW}" × ${max.maxH}"`, cxm - mw / 2, y + top - 19 * PX + 9 * PT);
        }
        const art = artUrl(im) ? await loadImg(artUrl(im)).catch(() => null) : null;
        // a badge with a tail: the circle in the middle of the panel, the tail off to its side
        const al = cxm - aw / 2 + centerShift(im).x * aw;
        if (art && s > 0) x.drawImage(art, al, y + top, aw, ah);
        else { x.fillStyle = dk ? "rgba(255,255,255,.7)" : "rgba(0,0,0,.5)"; x.font = body(400, 14); x.textAlign = "center"; x.fillText("Art coming", cxm, y + panelH / 2); x.textAlign = "left"; }
        if (art && s > 0) {
          const col = dk ? "#ffffff" : "#000000"; x.fillStyle = col; x.strokeStyle = col; x.lineWidth = 2 * PX;
          // width under the art: a line with end ticks, the inches under it
          const wy = y + top + ah + 0.06 * IN, wl = al;
          x.fillRect(wl, wy + 6 * PX, aw, 2 * PX); x.fillRect(wl, wy, 2 * PX, 12 * PX); x.fillRect(wl + aw - 2 * PX, wy, 2 * PX, 12 * PX);
          x.font = body(800, 14); x.textAlign = "center"; x.fillText(`${sz.w.toFixed(2)}"`, al + aw / 2, wy + 12 * PX + 14 * PT); x.textAlign = "left";
          // height to the right: a line, the inches beside it
          const hx = al + aw + 0.14 * IN;
          x.fillRect(hx, y + top, 2 * PX, ah);
          x.textBaseline = "middle"; x.fillText(`${sz.h.toFixed(2)}"`, hx + 10 * PX, y + top + ah / 2); x.textBaseline = "alphabetic";
        }
        x.restore();
        y += panelH + 12 * PX;
        // location, print size, placement, how it's printed
        const specs: [string, string][] = im.visualOnly ? [["Location", im.location || "—"], ["Print", MATCH_PREV]] : [
          ["Location", im.location || "—"], ["Print size", sizeLabel(im) || "—"], ["Placement", im.drop ? `${im.drop}" below the collar` : "Standard"], ["Print", printHow(im)],
        ];
        const cellW = CW / 4, cellH = 7 * PX + 9 * PT * 1.35 + 1 * PX + 13 * PT * 1.35 + 7 * PX;
        x.strokeStyle = C.ink; x.lineWidth = 2 * PX; rrect(x, L, y, CW, cellH, 10 * PX); x.stroke();
        specs.forEach(([k, v], i) => {
          const cx2 = L + i * cellW;
          if (i > 0) { x.fillStyle = C.line; x.fillRect(cx2, y + 2 * PX, 1 * PX, cellH - 4 * PX); }
          lbl(x, k, cx2 + 10 * PX, y + 7 * PX + 9 * PT);
          let pt = 13; x.font = body(800, pt); while (pt > 9 && x.measureText(v).width > (i === specs.length - 1 && specs.length < 4 ? CW - cx2 + L : cellW) - 20 * PX) { pt -= 0.5; x.font = body(800, pt); }
          x.fillStyle = C.ink; x.fillText(fit(x, v, cellW * (specs.length < 4 && i === specs.length - 1 ? 4 - i : 1) - 20 * PX), cx2 + 10 * PX, y + 7 * PX + 9 * PT * 1.35 + 1 * PX + 13 * PT);
        });
        y += cellH + 12 * PX;
        // the inks, big swatches
        const inks = inkNamesOf(im);
        if (inks.length) {
          lbl(x, im.method === "embroidery" ? "Thread colors" : "Ink colors", L, y + 9 * PT); y += 9 * PT * 1.35 + 6 * PX;
          let ix = L; x.font = body(700, 13);
          const sq = 26 * PX, rowH = Math.max(sq, 13 * PT * 1.35);
          for (const t of inks) {
            const w = sq + 8 * PX + x.measureText(t.name).width + 22 * PX;
            if (ix + w > L + CW && ix > L) { ix = L; y += rowH + 8 * PX; }
            if (y + rowH > BOT - 8.5 * PT - 20 * PX) break;
            x.fillStyle = t.hex; rrect(x, ix, y, sq, sq, 6 * PX); x.fill(); x.strokeStyle = "rgba(0,0,0,.25)"; x.lineWidth = 1 * PX; x.stroke();
            x.fillStyle = C.ink; x.textBaseline = "middle"; x.fillText(t.name, ix + sq + 8 * PX, y + sq / 2); x.textBaseline = "alphabetic";
            ix += w;
          }
          y += rowH + 12 * PX;
        }
        // the print's notes, and when its inks change with the shirt color
        const notes = [shopNotes(im.notes), paints[im.id]?.shirt ? "The ink colors change with the shirt color; each color's page shows its inks." : ""].filter(Boolean).join("  ");
        if (notes && y < BOT - 8.5 * PT - 30 * PX) {
          x.font = body(400, 11); const rows = wrap(x, notes, CW - 60 * PX);
          x.fillStyle = C.ink; x.font = body(700, 11); x.fillText("Notes:", L, y + 11 * PT); x.font = body(400, 11);
          rows.slice(0, Math.max(1, Math.floor((BOT - 8.5 * PT - 20 * PX - y) / (11 * PT * 1.35)))).forEach((r, i) => x.fillText(r, L + 50 * PX, y + 11 * PT + i * 11 * PT * 1.35));
        }
        await done(pg);
      }

      // the pages into a PDF with the approval box's fill-in fields (check a box, type the changes, sign with Acrobat)
      const { PDFDocument, StandardFonts } = await import("pdf-lib");
      const pdf = await PDFDocument.create();
      const fileName = [order ? String(order.number) : "", o.company && cust ? custLabel(cust) : "", jobName, "Proof"].filter(Boolean).join(" - ").replace(/[\\/:*?"<>|#]+/g, "").replace(/\s+/g, " ").trim();
      pdf.setTitle(fileName);
      const form = pdf.getForm(), hv = await pdf.embedFont(StandardFonts.Helvetica), k = 612 / PW;
      for (const [i, pgi] of pages.entries()) {
        const page = pdf.addPage([612, 792]);
        page.drawImage(await pdf.embedJpg(pgi.jpeg), { x: 0, y: 0, width: 612, height: 792 });
        for (const f of fields.filter((z) => z.page === i)) {
          const at = { x: f.x * k, y: 792 - (f.y + f.h) * k, width: f.w * k, height: f.h * k, borderWidth: 0 };
          if (f.kind === "check") form.createCheckBox(f.name).addToPage(page, at);
          else { const t = form.createTextField(f.name); if (f.multi) t.enableMultiline(); t.addToPage(page, { ...at, font: hv }); t.setFontSize(f.multi ? 10 : 12); }
        }
      }
      const bytes = await pdf.save();
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })); a.download = `${fileName || "Proof"}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setMsg(`Downloaded ${fileName}.pdf.`); setPdfOpen(false);
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
    g.imprints = sized.map((im) => {
      const saved = g.imprints.find((x) => x.id === im.id);
      // production confirmed this print while the builder was open: its confirmed specs win (lib/designSpecs.ts)
      if (saved?.confirmed && !saved.confirm && im.confirm) return { ...saved, ...im, size: saved.size, inks: saved.inks, colors: saved.colors, underbase: saved.underbase, drop: saved.drop, sizeFrom: saved.sizeFrom, remake: saved.remake, notes: saved.notes, confirm: undefined, confirmed: saved.confirmed };
      // only what was changed here goes back: anything else changed on the order meanwhile (production's drop, the
      // notes, the Order chat) is kept (Oct 23: #40133's cleaned notes and confirmed drops came back from an open
      // Mockup Creator)
      const was = loadedIms.current[im.id];
      if (!saved || !was) return { ...(saved || {}), ...im };
      const out: Record<string, unknown> = { ...saved };
      const keys = new Set([...Object.keys(im), ...Object.keys(was)]);
      for (const k of keys) {
        const a = (im as unknown as Record<string, unknown>)[k], b = (was as unknown as Record<string, unknown>)[k];
        if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) { if (a === undefined) delete out[k]; else out[k] = a; }
      }
      return out as unknown as Imprint;
    });
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
    // a garment drawn here from the customer's sheet (Oct 27): its look goes on the order's line, and its name and color
    // when the order's line had none
    for (const l of lines) {
      const ol = g.lines.find((x) => x.id === l.id); if (!ol) continue;
      if (l.look) ol.look = l.look;
      if (l.look && !(ol.style || "").trim()) { ol.style = l.style; ol.brand = l.brand; if (!(ol.color || "").trim()) ol.color = l.color; }
    }
    if (mockupSaved) g.mockupAt = new Date().toISOString();
    g.mockupSize = shownSize && runSizes.includes(shownSize) ? shownSize : undefined;
    // the hand moves on the shirt pictures, kept for the next time it's opened (only this group's prints)
    const ids = new Set(g.imprints.map((x) => x.id));
    const offs = Object.fromEntries(Object.entries(offsets).filter(([k, v]) => ids.has(k.split(":").pop() || "") && (Math.abs(v.dx) > 0.5 || Math.abs(v.dy) > 0.5)).map(([k, v]) => [k, { dx: Math.round(v.dx * 10) / 10, dy: Math.round(v.dy * 10) / 10 }]));
    g.mockupOffsets = Object.keys(offs).length ? offs : undefined;
    if (thumbs.length) g.mockupThumbs = thumbs;
    // each print's art as shown here, saved for the order's little print tiles (staff saves; the art the blow-up uses)
    if (!portal) await Promise.all(g.imprints.map(async (im) => {
      const u = artUrl(im);
      if (!u || !im.design_id) return;
      try {
        const b = await fetch(u).then((r) => r.blob());
        if (!b.size || !/^image\//.test(b.type || "image/png")) return;
        const path = `shown/${order.id}/${im.id}-${Date.now().toString(36)}.png`;
        const up = await sb.storage.from("proofs").upload(path, b, { contentType: b.type || "image/png" });
        if (!up.error) im.shownArt = path;
      } catch { /* the tile falls back to the logo itself */ }
    }));
    const { error } = await sb.from("orders").update({ groups }).eq("id", order.id);
    if (error) { setMsg("Couldn't update the order: " + error.message); return false; }
    loadedIms.current = Object.fromEntries(g.imprints.map((d) => [d.id, JSON.parse(JSON.stringify(d)) as Imprint]));
    // embroidery: the threads, backing and stitches it was set up with, kept on the logo for its next reorder
    if (!portal) {
      const l0 = lines[active] || lines[0], gm = l0 ? garmentFor(l0) : undefined;
      for (const im of g.imprints) if (im.method === "embroidery" && im.design_id && !isQuick(im.design_id)) void rememberEmbroidery(sb, im, order.number, [l0?.brand, l0?.style, gm?.description, l0?.color].filter(Boolean).join(" ")).catch(() => null);
    }
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
  const baseSig = useRef<string | null>(null);
  const [leave, setLeave] = useState<string | null>(null);
  useEffect(() => {
    // the first click or key press: what's there now is the starting point for "changed"
    const take = () => { if (baseSig.current === null) baseSig.current = sigNowRef.current(); };
    // leaving by a link (the order, the sidebar) with changes not saved: ask first
    const onClick = (e: MouseEvent) => {
      if (!dirtyRefOut.current() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || (a.getAttribute("href") || "").startsWith("#")) return;
      if (a.origin === location.origin && a.pathname === location.pathname && a.search === location.search) return;
      e.preventDefault(); e.stopPropagation(); setLeave(a.href);
    };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirtyRefOut.current()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("pointerdown", take, true); window.addEventListener("keydown", take, true);
    document.addEventListener("click", onClick, true); window.addEventListener("beforeunload", onUnload);
    return () => { window.removeEventListener("pointerdown", take, true); window.removeEventListener("keydown", take, true); document.removeEventListener("click", onClick, true); window.removeEventListener("beforeunload", onUnload); };
  }, []);
  const sigNowRef = useRef<() => string>(() => "");
  const dirtyRefOut = useRef<() => boolean>(() => false);
  const autoSave = useRef<() => Promise<boolean>>(async () => false);
  autoSave.current = async () => { saveOk.current = false; await saveAll(true); return saveOk.current; };
  // after Save mockups to order: seconds left before going back to the order (null: not counting)
  const [backIn, setBackIn] = useState<number | null>(null);
  useEffect(() => {
    if (backIn == null || !orderId) return;
    if (backIn <= 0) { location.assign(`/shop/orders/${orderId}`); return; }
    const t = setTimeout(() => setBackIn((x) => (x == null ? null : x - 1)), 1000);
    return () => clearTimeout(t);
  }, [backIn, orderId]);
  async function saveAll(force = false) {
    if (!customerId) return setMsg("Pick a customer so the mockups save to their account.");
    // a visual-only reorder print keeps its colors as uploaded on purpose (production sets the inks on the run): not asked
    if (!force && imprints.some((im) => !(im.visualOnly && !im.confirmed) && unsetColors(im).length)) { setAskUploaded(true); return; }
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
        const paths: string[] = [], ids: string[] = [];
        let num = 0;
        // the mockup keeps its setup so it can be opened to edit and ordered; every color saved together is one set and
        // one number (Oct 24, Nick). A proof being changed isn't a library mockup.
        const set = changeId ? "" : (mockSet.current ||= crypto.randomUUID());
        const snap = set ? { set, name: groupName, lines: lines.filter((z) => z.style || z.color).map((z) => ({ id: z.id, style: z.style, brand: z.brand, color: z.color, garment: z.garment, ...(z.own ? { own: z.own } : {}), ...(z.hex ? { hex: z.hex } : {}), ...(z.look ? { look: z.look } : {}) })), imprints: imprints.map((d) => ({ ...d })), offsets, mockupSize: shownSize || null } : undefined;
        for (const l of lines.filter((z) => z.style || z.color)) {
          const blob = await render(l), thumb = await render(l, true);
          const title = `${groupName || "Mockup"} — ${[l.brand, l.style].filter(Boolean).join(" ")} ${l.color}`.trim();
          const t = await mockupUploadUrls();
          if (!t.ok) throw new Error(t.error);
          const a = await sb.storage.from("proofs").uploadToSignedUrl(t.path, t.token, blob, { contentType: "image/png" });
          if (a.error) throw new Error(a.error.message);
          await sb.storage.from("proofs").uploadToSignedUrl(t.thumbPath, t.thumbToken, thumb, { contentType: "image/jpeg" });
          const r = await saveMyMockup({ path: t.path, title, design_ids: [...new Set(imprints.map((i) => i.design_id).filter(Boolean))] as string[], snapshot: snap });
          if (!r.ok) throw new Error(r.error);
          if (r.id) ids.push(r.id);
          if (r.number) num = r.number;
          paths.push(t.path);
          out.push({ title, url: URL.createObjectURL(blob) });
        }
        if (changeId) {
          // their version goes to the shop with the proof; we check it and send a new proof
          const r2 = await submitOwnChange(changeId, {
            lines: lines.filter((z) => z.style || z.color).map((z) => ({ id: z.id, style: z.style, brand: z.brand, color: z.color, garment: z.garment, ...(z.own ? { own: z.own } : {}), ...(z.hex ? { hex: z.hex } : {}), ...(z.look ? { look: z.look } : {}) })),
            imprints: imprints.map((d) => ({ ...d })),
            mockupPaths: paths, note: "",
          });
          if (!r2.ok) throw new Error(r2.error);
          window.location.href = change ? `/portal/orders/${change.orderId}?reviewed=changes` : "/portal";
          return;
        }
        // saved again: the earlier pictures of this mockup step aside (it keeps its number)
        if (set && ids.length) await retireMyMockups(set, ids);
        if (set && ids[0]) setSavedMock({ id: ids[0], num });
        // made for an order they're building: it goes into that group, then back to the order
        if (requestId && ids[0]) {
          const a = await attachMockupToRequest(requestId, groupId, ids[0]);
          if (!a.ok) throw new Error(a.error);
          window.location.href = `/portal/request/${requestId}`;
          return;
        }
        setSaved(out);
        setMsg(`Saved${num ? ` as M-${num}` : ""}: ${out.length} mockup${out.length > 1 ? "s" : ""} in your artwork. Order it from your artwork any time.`);
      } catch (e) { setMsg("Couldn't save: " + (e instanceof Error ? e.message : String(e))); }
      setSaving(false);
      return;
    }
    const { data: u } = await sb.auth.getUser();
    try {
      // this group's earlier mockups: archived once the new ones are saved, so only the current version shows
      // (Oct 15, Nick: "It should only be the one active version... not a history of it along the way")
      const newMockups: string[] = [];
      // on an order that's still a quote, a mockup is a draft: on the order, not in the customer's library until the
      // order is sent or approved (Oct 17, Nick; the database makes it real then: migration 166)
      const draft = orderId ? ["quote", "request"].includes(String((await sb.from("orders").select("status").eq("id", orderId).maybeSingle()).data?.status || "")) : false;
      // a mockup saved to a draft order makes it an order (Oct 24: saving commits; the mockup needs an order to belong to)
      if (orderId) { const c = await sb.rpc("order_commit", { p_id: orderId }); if (c.error) throw new Error(c.error.message); }
      const before = orderId && groupId ? ((await sb.from("mockups").select("id, proof_id").eq("order_id", orderId).eq("group_id", groupId).is("archived_at", null)).data || []) as { id: string; proof_id: string | null }[] : [];
      for (const l of lines.filter((z) => z.style || z.color)) {
        const blob = await render(l);
        const title = `${groupName || "Mockup"} — ${[l.brand, l.style].filter(Boolean).join(" ")} ${l.color}`.trim();
        const path = orderId ? `${orderId}/mockup-${Date.now()}-${uid().slice(0, 6)}.png` : `mockups/${customerId}/${Date.now()}-${uid().slice(0, 6)}.png`;
        const up = await sb.storage.from("proofs").upload(path, blob, { contentType: "image/png" });
        if (up.error) throw new Error(up.error.message);
        // a save is a mockup, not a proof (Oct 16, Nick): proofs are only the versions sent to the customer (lib/proofs.ts)
        const { data: nm } = await sb.from("mockups").insert({ customer_id: customerId, order_id: orderId || null, group_id: groupId || null, proof_id: null, title, file_path: path, design_ids: [...new Set(imprints.map((i) => i.design_id).filter(Boolean))], created_by: u.user?.email || "", draft, ...(orderId ? {} : { snapshot: { set: (mockSet.current ||= crypto.randomUUID()) } }) }).select("id").single();
        if (nm?.id) newMockups.push(nm.id);
        // a small photos-only picture for the order screen and the customer's artwork lists
        const thumb = await render(l, true);
        const tpath = path.replace(/\.png$/, "-thumb.png");
        const tu = await sb.storage.from("proofs").upload(tpath, thumb, { contentType: "image/jpeg" });
        if (!tu.error) thumbs.push(tpath);
        out.push({ title, url: URL.createObjectURL(blob) });
      }
      // a mockup saved to the customer keeps its setup, so it can be opened and edited again like an order's; saved
      // again, the earlier pictures of the same mockup step aside (Oct 22, Nick)
      if (!orderId && newMockups.length) {
        const set = mockSet.current || crypto.randomUUID();
        mockSet.current = set;
        const snap = { set, name: groupName, lines: lines.filter((z) => z.style || z.color).map((z) => ({ id: z.id, style: z.style, brand: z.brand, color: z.color, garment: z.garment, ...(z.own ? { own: z.own } : {}), ...(z.hex ? { hex: z.hex } : {}), ...(z.look ? { look: z.look } : {}) })), imprints: imprints.map((d) => ({ ...d })), offsets, mockupSize: shownSize || null };
        await sb.from("mockups").update({ snapshot: snap }).in("id", newMockups);
        const { data: old } = await sb.from("mockups").select("id").eq("customer_id", customerId).is("order_id", null).is("archived_at", null).eq("snapshot->>set", set);
        const gone = ((old || []) as { id: string }[]).map((x) => x.id).filter((id) => !newMockups.includes(id));
        if (gone.length) await sb.from("mockups").update({ archived_at: new Date().toISOString() }).in("id", gone);
      }
      if (before.length) {
        const at = new Date().toISOString();
        // the group's earlier saves step aside; a proof already sent stays with the customer until the next version is sent
        await sb.from("mockups").update({ archived_at: at }).in("id", before.map((x) => x.id));
      }
      await syncOrder(true, thumbs);
      // each version keeps the group as it was saved (garments and prints), so the shop can go back to it later
      // (Oct 15, Nick: "be able to go back in time")
      if (orderId && newMockups.length) {
        const { data: od } = await sb.from("orders").select("groups").eq("id", orderId).maybeSingle();
        const sg = ((od?.groups || []) as Order["groups"]).find((x) => x.id === groupId);
        if (sg) await sb.from("mockups").update({ snapshot: { lines: sg.lines.map((l) => ({ id: l.id, style: l.style, brand: l.brand, color: l.color, garment: l.garment })), imprints: sg.imprints, mockupSize: sg.mockupSize || null, mockupThumbs: sg.mockupThumbs || [] } }).in("id", newMockups);
      }
      saveOk.current = true;
      baseSig.current = sigNowRef.current();
      setSaved(out);
      setMsg(orderId ? `Saved ${out.length} mockup${out.length > 1 ? "s" : ""} to the order. Send it to the customer from the order's Art & production tab.` : `Saved ${out.length} mockup${out.length > 1 ? "s" : ""} to the customer's account.`);
    } catch (e) { setMsg("Couldn't save: " + (e instanceof Error ? e.message : String(e))); }
    setSaving(false);
  }

  // a mockup needs a customer (art and mockups save to their account) and at least one garment
  // a garment not in any catalog with its look read off the customer's sheet (the Helper's Draw this blank, or Create
  // order's reading: Oct 27, Nick on Peter Millar's Ridge Vest, "I don't have Peter Millar… I've got to draw that") is drawn
  const ready = !!customerId && lines.some((l) => l.style.trim() && (garmentFor(l) || !!l.own || !!l.look));
  // a size bigger than the smallest size ordered can take (a 9.5" front on a 2T-4T run) is brought down to the
  // largest that fits, and the print says why (the note goes to the order with the mockup)
  useEffect(() => {
    if (!capBody || !ready) return;
    const fixes: Record<string, { size: string; note: string }> = {};
    for (const im of imprints) {
      const d = designOf(im); if (!d || im.sizeFrom === "customer" || im.sizeFrom === "film") continue; // the customer's own size, or the size printed before (film): not changed
      const r = ratioIm(im) || 0, m = (im.size || "").match(/^([\d.]+)/); if (!m) continue;
      const want = /tall/i.test(im.size) ? (r ? +m[1] / r : +m[1]) : +m[1];
      const cap = Math.floor(sideMaxWidth(im.location, r) * 4) / 4;
      if (want > cap + 0.01) fixes[im.id] = { size: `${cap}" wide`, note: `${cap}" wide: the largest that fits the ${capBody.size}, the smallest size on this order (one screen prints every size). Was ${im.size}.` };
    }
    if (!Object.keys(fixes).length) return;
    setImprints((xs) => xs.map((x) => (fixes[x.id] ? { ...x, size: fixes[x.id].size, notes: [(x.notes || "").replace(/\s*\d+(\.\d+)?" wide: the largest that fits[^.]*\.[^.]*\.( Was [^.]*\.?)?/g, ""), fixes[x.id].note].filter((z) => z.trim()).join(" ").slice(0, 300) } : x)));
  }, [capBody?.size, ready, imprints.map((x) => `${x.id}:${x.size}:${x.design_id}`).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  /* ---------- Design with Canva (staff, and customers in their portal) ----------
   * Canva opens in a new tab on a blank design the size of this side's print area (or one of our Canva-made designs,
   * "Edit in Canva"), in the person's OWN Canva account (Canva's editor links only work for the account that owns
   * the design); staff without their own use the shop's. Return in Canva lands on /api/canva/return, which saves the
   * design as the customer's logo and comes back here with ?canva=<trip>. The tab we started from waits (checks every
   * few seconds and when it's looked at again) and puts the design on the shirt; the returned tab hands it over and
   * closes. With no tab waiting (it was closed), the returned tab places it itself. Not connected yet: one line about
   * signing in to Canva, then Canva's sign-in in a new tab, which tells this tab when it's done and closes. */
  type CanvaSt = { configured: boolean; me: { connected: boolean; name: string }; isStaff: boolean; isOwner: boolean; connected?: boolean };
  const [canva, setCanva] = useState<CanvaSt | null>(null);
  const [canvaWait, setCanvaWait] = useState<{ session: string; side: Side; imId: string; msg: string } | null>(null);
  type CanvaBackdrop = { w: number; h: number; k: number; view: View; z: number; tx: number; ty: number };
  const [canvaPlace, setCanvaPlace] = useState<{ d: Design; side: Side; imId: string; session: string; fileUrl: string; previewUrl: string; backdrop?: CanvaBackdrop | null } | null>(null);
  const [canvaAsk, setCanvaAsk] = useState(false);
  const loadCanva = () => fetch("/api/canva/status", { cache: "no-store" }).then((r) => r.json()).then((j: CanvaSt & { error?: string }) => { if (!j.error && j.me) setCanva(j); }).catch(() => null);
  useEffect(() => { if (CANVA_IN_MOCKUP) void loadCanva(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** the Canva doorway shows for customers (their own login, not a staff preview) and for staff; off for now (CANVA_IN_MOCKUP) */
  const showCanva = CANVA_IN_MOCKUP && !!canva?.configured && (portal ? !canva.isStaff : canva.isStaff);
  /** ready to open Canva now: their own Canva account, or (staff) the shop's */
  const canvaReady = showCanva && !!canva && (canva.me.connected || (canva.isStaff && !!canva.connected));
  type CanvaTrip = { session?: { id: string; status: string; error: string | null; side: string; im_id: string; backdrop?: CanvaBackdrop | null }; design?: Design | null; fileUrl?: string; previewUrl?: string; error?: string };
  const canvaTrip = (id: string): Promise<CanvaTrip> => fetch(`/api/canva/status?session=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ error: "Couldn't reach the portal." }));
  const asSide = (v: string): Side => (v === "back" || v === "sleeve" ? v : "front");
  /** check the trip we're waiting on; true when it's finished (saved or failed) */
  async function checkCanva(id: string, quiet = false): Promise<boolean> {
    const r = await canvaTrip(id);
    const s0 = r.session;
    if (!s0) { if (!quiet) setMsg(r.error || "Couldn't find the Canva design."); return false; }
    if (s0.status === "saved" && r.design) {
      setCanvaWait(null);
      setCanvaPlace({ d: r.design, side: asSide(s0.side), imId: s0.im_id, session: s0.id, fileUrl: r.fileUrl || "", previewUrl: r.previewUrl || "", backdrop: s0.backdrop || null });
      return true;
    }
    if (s0.status === "error") { setCanvaWait(null); setMsg(`Canva: ${s0.error || "the design didn't come back."}`); return true; }
    if (s0.status === "returned") setCanvaWait((w) => (w ? { ...w, msg: "Getting the design from Canva…" } : w));
    else if (!quiet) setCanvaWait((w) => (w ? { ...w, msg: "Still in Canva. Click Return in Canva when you're done." } : w));
    return false;
  }
  // waiting: every 4 seconds, and when this tab is looked at again
  useEffect(() => {
    if (!canvaWait) return;
    const id = canvaWait.session;
    const tick = () => { void checkCanva(id, true); };
    const t = setInterval(tick, 4000);
    window.addEventListener("focus", tick);
    return () => { clearInterval(t); window.removeEventListener("focus", tick); };
  }, [canvaWait?.session]); // eslint-disable-line react-hooks/exhaustive-deps
  // tabs talk: the returned tab asks "is anyone waiting for this trip?" and the waiting tab answers and takes it;
  // a tab back from Canva's sign-in says "connected" and the tab that sent it there answers and carries on
  const canvaWaitRef = useRef(canvaWait); canvaWaitRef.current = canvaWait;
  const canvaAskRef = useRef(canvaAsk); canvaAskRef.current = canvaAsk;
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("fbs-canva");
    ch.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; session?: string; name?: string };
      if (m?.type === "returned" && m.session && canvaWaitRef.current?.session === m.session) { ch.postMessage({ type: "mine", session: m.session }); void checkCanva(m.session, true); }
      if (m?.type === "connected" && canvaAskRef.current) {
        ch.postMessage({ type: "got-connected" });
        setCanvaAsk(false); void loadCanva();
        setMsg(`Your Canva account${m.name ? ` (${m.name})` : ""} is connected. Press Design with Canva.`);
      }
    };
    return () => ch.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // this page opened from Canva's Return (?canva=<trip>), Canva's sign-in (?canva_connected=<name>), or with a problem
  const canvaParam = useRef(sp.get("canva") || "");
  useEffect(() => {
    const bad = sp.get("canva_error"), joined = sp.get("canva_connected");
    if (bad) setMsg(`Canva: ${bad}`);
    const id = canvaParam.current;
    if (!id && !bad && joined == null) return;
    canvaParam.current = "";
    try { const u = new URL(window.location.href); for (const k of ["canva", "canva_error", "canva_connected"]) u.searchParams.delete(k); window.history.replaceState(null, "", u.toString()); } catch { /* keep the address */ }
    const ch = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("fbs-canva") : null;
    if (joined != null) {
      // back from Canva's sign-in in its own tab: tell the tab that sent us, then close; else carry on here
      let heard = false;
      if (ch) ch.onmessage = (e: MessageEvent) => { if ((e.data as { type?: string })?.type === "got-connected") heard = true; };
      ch?.postMessage({ type: "connected", name: joined });
      setMsg(`Your Canva account${joined ? ` (${joined})` : ""} is connected. Press Design with Canva.`);
      setTimeout(() => { ch?.close(); if (heard) { setMsg("Connected. Carry on in the Mockup Creator tab you started from."); setTimeout(() => { try { window.close(); } catch { /* a tab we didn't open */ } }, 1200); } }, 1200);
      return;
    }
    if (!id) { ch?.close(); return; }
    let taken = false;
    if (ch) ch.onmessage = (e: MessageEvent) => { const m = e.data as { type?: string; session?: string }; if (m?.type === "mine" && m.session === id) taken = true; };
    ch?.postMessage({ type: "returned", session: id });
    setMsg("Getting the design from Canva…");
    setTimeout(async () => {
      ch?.close();
      if (taken) {
        setMsg("Saved. The design is on the shirt in the Mockup Creator tab you started from.");
        setTimeout(() => { try { window.close(); } catch { /* a tab we didn't open */ } }, 1500);
        return;
      }
      for (let i = 0; i < 40; i++) { if (await checkCanva(id, true)) return; await new Promise((r) => setTimeout(r, 3000)); }
      setMsg("The design is still coming back from Canva. Reload in a minute.");
    }, 1500);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** a Canva design saved without a mockup picture (a Canva Free account can't export see-through PNGs): draw it from
   *  the PDF with a clear page, crop it to the art, and keep it on the design (noting a solid background if there is one) */
  async function canvaPreview(p: { d: Design; session: string; fileUrl: string }) {
    madePv.current.add(p.d.id);
    const blob = await fetch(p.fileUrl).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
    if (!blob) return;
    const pv0 = await makePreview(new File([blob], p.d.file_name || "design.pdf", { type: "application/pdf" })).catch(() => null);
    if (!pv0) return;
    const pv = (await cropFileToArt(pv0).catch(() => null)) || pv0;
    // corners still solid after cropping = the design has a background (white or a color)
    const opaque = await new Promise<boolean>((res) => {
      const url = URL.createObjectURL(pv), img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
          const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
          const a = (x: number, y: number) => g.getImageData(x, y, 1, 1).data[3];
          res([a(0, 0), a(c.width - 1, 0), a(0, c.height - 1), a(c.width - 1, c.height - 1)].every((v) => v > 240));
        } catch { res(false); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(false); };
      img.src = url;
    });
    const fd = new FormData(); fd.set("session", p.session); fd.set("file", pv, "preview.png"); if (opaque) fd.set("opaque", "1");
    const r = await fetch("/api/canva/preview", { method: "POST", body: fd }).then((x) => x.json()).catch(() => null) as { design?: Design | null; url?: string } | null;
    if (r?.design) { const nd = r.design; setDesigns((xs) => xs.map((x) => (x.id === nd.id ? nd : x))); if (r.url) setUrls((x) => ({ ...x, [nd.id]: r.url! })); }
    if (opaque) setMsg("The Canva design has a background, so it shows as a box on the shirt. Remove the background in Canva (or tell us to) before printing.");
  }
  // a design back from Canva goes on its side of the shirt (once the page has its order / garment loaded)
  useEffect(() => {
    if (!canvaPlace) return;
    const go = () => {
      const p = canvaPlace, { d, side, imId } = p;
      setCanvaPlace(null);
      // made on the blank's photo: drawn from the PDF (the shirt already taken out) and put where it was drawn
      if (p.backdrop && !d.preview_path && p.fileUrl) { void canvaOnShirt(p as typeof p & { backdrop: CanvaBackdrop }); return; }
      setDesigns((xs) => (xs.some((x) => x.id === d.id) ? xs : [d, ...xs]));
      if (p.previewUrl) setUrls((x) => ({ ...x, [d.id]: p.previewUrl }));
      else if (!d.preview_path && p.fileUrl) void canvaPreview(p);
      setImprints((xs) => {
        const t = xs.find((x) => x.id === imId) || xs.find((x) => sideOf(x.location) === side && !x.design_id && !qt[x.id]);
        if (t) return xs.map((x) => (x.id === t.id ? { ...x, design_id: d.id } : x));
        return [...xs, { ...newImprint(side === "back" ? "Full Back" : side === "sleeve" ? "Left Sleeve" : "Full Front"), design_id: d.id }];
      });
      setTab(side);
      setMsg(`Saved ${designLabel(d)} from Canva to ${portal ? "your logos" : "the customer's account"}.`);
    };
    if (ready) { go(); return; }
    const t = setTimeout(go, 6000);
    return () => clearTimeout(t);
  }, [canvaPlace, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  /* ---------- Design with Canva on the blank (Oct 10, Nick: "drop the S&S or SanMar picture for the blank") ----------
   * The garment photo for the side, drawn like the mockup (normalized to the reference frame) BD_K times its size with
   * the print area dashed and labeled, becomes the Canva design's picture (the whole canvas). What comes back: the
   * server takes the photo out of Canva's PDF (lib/canva/backdrop); here the PDF is drawn with a clear page, the art
   * found on it, cropped for the mockup, and put on the shirt at the size and spot it was drawn. */
  const BD_K = 3;
  async function canvaBackdrop(l: Line, v: View, loc: string): Promise<{ blob: Blob; meta: CanvaBackdrop } | null> {
    try {
      const W = PHOTO_W * BD_K, H = PHOTO_H * BD_K;
      const u = photo(l, v);
      const bg = await loadImg(u).catch(() => loadImg(drawn(l, v)));
      const fit = u.startsWith("data:") ? null : fitFor(l, v, fits[u] || measureFor(l, bg, v));
      const nm = frameOf(l, v);
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const g = c.getContext("2d")!;
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
      { const cr = containRect(bg); g.drawImage(bg, (nm.tx + nm.z * cr.x) * BD_K, (nm.ty + nm.z * cr.y) * BD_K, cr.w * nm.z * BD_K, cr.h * nm.z * BD_K); }
      // the print area, dashed, with its name and size (light lines on a dark shirt, dark on a light one)
      const bd = bodyFor(l), sp = spotFor(loc, bd);
      const b = basePlacement(loc, sp.maxW, sp.maxH / sp.maxW, null, zScale(bd, l, v), v, adjusted(fit, settingsLine(l, v), v), bd);
      const ax = (nm.tx + nm.z * b.area.x) * BD_K, ay = (nm.ty + nm.z * b.area.y) * BD_K, aw = b.area.w * nm.z * BD_K, ah = b.area.h * nm.z * BD_K;
      const hx = shirtHex(l).replace("#", ""), lum = (0.299 * parseInt(hx.slice(0, 2), 16) + 0.587 * parseInt(hx.slice(2, 4), 16) + 0.114 * parseInt(hx.slice(4, 6), 16)) / 255;
      const ink = lum < 0.55 ? "rgba(255,255,255,0.85)" : "rgba(40,48,60,0.7)";
      g.setLineDash([10 * BD_K, 7 * BD_K]); g.lineWidth = 1.6 * BD_K; g.strokeStyle = ink; g.strokeRect(ax, ay, aw, ah);
      g.setLineDash([]); g.fillStyle = ink; g.font = `600 ${15 * BD_K}px Helvetica, Arial, sans-serif`;
      g.fillText(`${loc} print area · ${sp.maxW}" × ${sp.maxH}"`, ax + 8 * BD_K, ay - 8 * BD_K);
      let blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
      if (blob && blob.size > 4_200_000) blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.78));
      if (!blob || blob.size > 4_300_000) return null;
      return { blob, meta: { w: W, h: H, k: BD_K, view: v, z: nm.z, tx: nm.tx, ty: nm.ty } };
    } catch { return null; }
  }
  /** A design back from Canva that was made on the blank: picture from the PDF, then onto the shirt where it was drawn */
  async function canvaOnShirt(p: { d: Design; side: Side; imId: string; session: string; fileUrl: string; backdrop: CanvaBackdrop }) {
    const { d, side, imId, backdrop: B } = p;
    madePv.current.add(d.id);
    setMsg("Bringing your Canva design onto the shirt…");
    const blob = await fetch(p.fileUrl).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
    const page = blob ? await makePreview(new File([blob], d.file_name || "design.pdf", { type: "application/pdf" }), 3600).catch(() => null) : null;
    if (!page) { setMsg("Couldn't draw the Canva design. Reload the page to try again."); return; }
    // the art on the page: everything not see-through
    const img = await loadImg(URL.createObjectURL(page)).catch(() => null);
    if (!img) { setMsg("Couldn't draw the Canva design."); return; }
    const Rw = img.naturalWidth, Rh = img.naturalHeight, cv = document.createElement("canvas");
    cv.width = Rw; cv.height = Rh;
    const g = cv.getContext("2d", { willReadFrequently: true })!; g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, Rw, Rh).data;
    let x0 = Rw, y0 = Rh, x1 = -1, y1 = -1;
    for (let y = 0; y < Rh; y++) for (let x = 0; x < Rw; x++) if (px[(y * Rw + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    if (x1 < 0) { setMsg("The Canva design came back empty: nothing was added on the shirt. Add your design in Canva, then click Return again."); return; }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, crop = document.createElement("canvas");
    crop.width = bw; crop.height = bh; crop.getContext("2d")!.drawImage(cv, x0, y0, bw, bh, 0, 0, bw, bh);
    const pv = await new Promise<Blob | null>((r) => crop.toBlob(r, "image/png"));
    if (!pv) return;
    const fd = new FormData(); fd.set("session", p.session); fd.set("file", pv, "preview.png");
    const r = await fetch("/api/canva/preview", { method: "POST", body: fd }).then((x) => x.json()).catch(() => null) as { design?: Design | null; url?: string } | null;
    const nd = r?.design || { ...d, width_px: bw, height_px: bh };
    setDesigns((xs) => (xs.some((x) => x.id === nd.id) ? xs.map((x) => (x.id === nd.id ? nd : x)) : [nd, ...xs]));
    if (r?.url) setUrls((x) => ({ ...x, [nd.id]: r.url! }));
    // where it was drawn: page pixels → the picture we gave Canva → this photo's pixels
    const f = B.w / Rw, v = B.view, l = line, bdy = body;
    const toPhoto = (X: number, Y: number) => ({ x: (X / B.k - B.tx) / B.z, y: (Y / B.k - B.ty) / B.z });
    const tl = toPhoto(x0 * f, y0 * f), br = toPhoto((x1 + 1) * f, (y1 + 1) * f);
    const pw = br.x - tl.x, ph = br.y - tl.y, rr = ph / (pw || 1);
    const fit = adjusted(fitFor(l, v), settingsLine(l, v), v), sc = zScale(bdy, l, v);
    const start = imprints.find((x) => x.id === imId)?.location || (v === "back" ? "Full Back" : "Full Front");
    const ppiPhoto = basePlacement(start, 1, rr, null, sc, v, fit, bdy).w || PX_PER_IN * sc;
    let wIn = Math.round((pw / ppiPhoto) * 100) / 100;
    let z = start;
    if (!fit?.flat) {
      // the reference frame (where locations are judged): undo this photo's fit
      const kf = fit?.zs || fit?.s || 1, refL = fit ? CENTER_X + (tl.x - fit.cx) / kf : tl.x, refT = fit ? (v === "front" && fit.neck != null ? REF_NECK.front + (tl.y - fit.neck) / kf : REF[v].top + (tl.y - fit.top) / kf) : tl.y;
      const ppiRef = PX_PER_IN * sc;
      z = autoSpot(start, v, (refL + pw / kf / 2 - CENTER_X) / ppiRef, (refT - COLLAR_Y[v]) / ppiRef, wIn, wIn * rr);
    }
    // bigger than the print area allows: shrunk around its middle, so it stays centered where it was drawn
    const drawn = wIn;
    wIn = Math.max(0.5, Math.min(sideMaxWidth(z, rr), wIn));
    if (wIn < drawn) { const d0 = (drawn - wIn) * ppiPhoto; tl.x += d0 / 2; tl.y += (d0 * rr) / 2; }
    const nb = basePlacement(z, wIn, rr, null, sc, v, fit, bdy);
    const target = imprints.find((x) => x.id === imId) || imprints.find((x) => sideOf(x.location) === side && !x.design_id && !qt[x.id]);
    const id = target?.id || uid();
    setImprints((xs) => target
      ? xs.map((x) => (x.id === id ? { ...x, design_id: nd.id, location: z, size: `${wIn}" wide`, drop: "", keepLocation: false } : x))
      : [...xs, { ...newImprint(z), id, design_id: nd.id, size: `${wIn}" wide` }]);
    setOffsets((o) => ({ ...o, [id]: { dx: (tl.x - nb.x) / (nb.k || 1), dy: (tl.y - nb.y) / (nb.k || 1) } }));
    setTab(side);
    setMsg(`Saved ${designLabel(nd)} from Canva to ${portal ? "your logos" : "the customer's account"}: ${wIn}" wide, where it was drawn.`);
  }
  /** Canva's sign-in for the person's own account, in a new tab (this tab keeps the mockup as it is) */
  function connectCanva() {
    const back = new URL(window.location.href);
    window.open(`/api/canva/connect?for=me&return_to=${encodeURIComponent(back.pathname + back.search)}`, "_blank");
  }
  /** Start a trip to Canva: a new design for this side's print area, or `from` (one of our Canva-made designs) again */
  async function designInCanva(from?: Design, im?: Imprint, onSide?: Side) {
    if (!customerId) return setMsg(portal ? "Your account is still loading. Try again in a moment." : "Pick the customer first. The design is saved to their account.");
    if (!canvaReady) { setCanvaAsk(true); return; }
    const side = im ? sideOf(im.location) : onSide || curTab;
    const target = im || imprints.find((x) => sideOf(x.location) === side && !x.design_id && !qt[x.id]);
    const loc = target?.location || (side === "back" ? "Full Back" : side === "sleeve" ? "Left Sleeve" : "Full Front");
    const area = spotFor(loc);
    // the tab opens now, during the click (so it isn't blocked as a pop-up), and goes to Canva when the link is ready
    const win = window.open("about:blank", "_blank");
    const back = new URL(window.location.href);
    if (!portal && customerId && !back.searchParams.get("customer") && !orderId) back.searchParams.set("customer", customerId);
    const payload = { side, location: loc, w_in: area.maxW, h_in: area.maxH, customer_id: customerId, order_id: orderId || null, group_id: groupId, im_id: target?.id || "", return_to: back.pathname + back.search, from_design: from?.id };
    // a new design for the front or back: on the blank's photo (sleeves: the plain print-area canvas)
    const bd = !from && side !== "sleeve" && line ? await canvaBackdrop(line, side as View, loc) : null;
    let body0: BodyInit, headers: Record<string, string> = {};
    if (bd) { const fd = new FormData(); fd.set("json", JSON.stringify({ ...payload, backdrop: bd.meta })); fd.set("backdrop", bd.blob, "blank.jpg"); body0 = fd; }
    else { body0 = JSON.stringify(payload); headers = { "Content-Type": "application/json" }; }
    const r = await fetch("/api/canva/design", { method: "POST", headers, body: body0 }).then((x) => x.json()).catch(() => ({ error: "Couldn't reach the portal." })) as { session?: string; edit_url?: string; error?: string; needs_connect?: boolean };
    if (!r.edit_url || !r.session) {
      win?.close();
      if (r.needs_connect) { setCanvaAsk(true); void loadCanva(); return; }
      return setMsg(r.error || "Couldn't open Canva.");
    }
    if (win) { win.opener = null; win.location.href = r.edit_url; } else window.open(r.edit_url, "_blank", "noopener");
    setCanvaAsk(false);
    setCanvaWait({ session: r.session, side, imId: target?.id || "", msg: from ? "Editing in Canva… click Return to FBS Print Portal (top right in Canva) when you're done." : bd ? "Designing in Canva on the shirt: put your design inside the dashed print area, then click Return to FBS Print Portal (top right)." : "Designing in Canva. For shirt templates, click Templates in Canva and search \u201ct-shirt\u201d. Click Return to FBS Print Portal (top right) when you're done." });
  }

  // on a phone, opening a mockup asks about each print's size first: "Full Front: 9" wide · Keep / Change size"
  useEffect(() => {
    if (sizerShown.current || auto || portal || !ready || typeof window === "undefined") return;
    if (!window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth > 820) return;
    const ids = imprints.filter((im) => designOf(im) && !isQuick(im.design_id)).map((im) => im.id);
    if (!ids.length) return;
    sizerShown.current = true;
    setSizer({ ids, i: 0, pick: null });
  }, [ready, imprints, designs]); // eslint-disable-line react-hooks/exhaustive-deps

  // opened from the AI Workbench: once every logo is loaded, one-color prints get their ink (the logo "in black"), the
  // same way auto mode does; nothing is saved until staff click Save Mockup
  useEffect(() => {
    if (wbInk.current !== "wait" || !ready || !imprints.length || imprints.some((im) => !designOf(im) || paints[im.id]?.design !== im.design_id)) return;
    wbInk.current = "done";
    for (const im of imprints) {
      const want = autoWant.current[im.id], pt = paints[im.id];
      if (im.method !== "screen" || !want || want.colors !== 1 || !want.inks || !pt) continue;
      const name = want.inks.split(/[,;\/+]/)[0].trim(), hex = name ? colorHex(name) : null;
      // a mockup made by hand before keeps its picks: a color left out ("none", e.g. the white around the art) stays out
      // (Oct 24, #40170: the Order chat's remake turned the Left Chest's white into PMS 230 C)
      const prev = im.inkMap && im.inkMap.design === im.design_id ? im.inkMap.map : null;
      const keep = (h: string) => { const e = prev?.[h] || prev?.[h.toUpperCase()]; return e && (!e.hex || /^none$/i.test(e.name)) ? e : null; };
      if (hex) setInks(im.id, Object.fromEntries(pt.sources.map((x) => [x.hex, keep(x.hex) || { name, hex }])));
    }
  }, [ready, imprints, paints, designs, urls]); // eslint-disable-line react-hooks/exhaustive-deps

  // auto mode (from Inbox → Create order): once the shirt and every logo are loaded, set one-color prints to their
  // ink, save, and move on. Gives up after 30 s with the reason, leaving everything as it is to finish by hand.
  useEffect(() => {
    if (!auto || !order) return;
    // a garment being drawn to match their photo takes about a minute: the 30 s starts once it's done
    if (garDrawing) return;
    const t = setTimeout(() => { if (autoState.current === "") { autoState.current = "stuck"; setMsg("Couldn't build the mockup by itself: the garment or the art didn't load. Check it, then Save."); } }, 30_000);
    return () => clearTimeout(t);
  }, [auto, order, garDrawing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!auto || !order || !ready || saving || garDrawing || drawPending || autoState.current === "stuck" || autoState.current === "saving" || autoState.current === "done") return;
    if (!imprints.length || imprints.some((im) => !designOf(im) || paints[im.id]?.design !== im.design_id)) return;
    autoState.current = "saving";
    setMsg("Building our mockup from the customer's art…");
    // one-color prints: every color in the art prints in the ink the order names (e.g. all Black)
    for (const im of imprints) {
      const want = autoWant.current[im.id], pt = paints[im.id];
      if (im.method !== "screen" || !want || want.colors !== 1 || !pt) continue;
      const name = (want.inks || "").split(/[,;\/+]/)[0].trim(), hex = name ? colorHex(name) : null;
      // a mockup made by hand before keeps its picks: a color left out ("none", e.g. the white around the art) stays out
      // (Oct 24, #40170: the Order chat's remake turned the Left Chest's white into PMS 230 C)
      const prev = im.inkMap && im.inkMap.design === im.design_id ? im.inkMap.map : null;
      const keep = (h: string) => { const e = prev?.[h] || prev?.[h.toUpperCase()]; return e && (!e.hex || /^none$/i.test(e.name)) ? e : null; };
      if (hex) setInks(im.id, Object.fromEntries(pt.sources.map((x) => [x.hex, keep(x.hex) || { name, hex }])));
    }
    // a moment for the art to repaint, then save (not cancelled by the re-renders in between)
    const o = order;
    setTimeout(async () => {
      const ok = await autoSave.current();
      if (!ok) { autoState.current = "stuck"; return; }
      autoState.current = "done";
      if (quiet) { try { window.parent.postMessage({ type: "fbs:mockup-saved", order: o.id, group: groupId }, location.origin); } catch { /* */ } return; }
      const gs = orderGroups(o), at = gs.findIndex((x) => x.id === groupId);
      const next = gs.slice(at + 1).find((x) => x.imprints.some((d) => d.design_id) && !x.mockupAt);
      setMsg(next ? "Saved. On to the next group…" : "Saved. Opening the order…");
      setTimeout(() => location.assign(next ? `/shop/artwork/mockup?order=${o.id}&group=${next.id}&auto=1${fromEmail ? `&email=${fromEmail}` : ""}` : `/shop/orders/${o.id}${fromEmail ? `?email=${fromEmail}` : ""}`), 900);
    }, 1800);
  }, [auto, order, ready, saving, garDrawing, drawPending, imprints, paints, designs, urls]); // eslint-disable-line react-hooks/exhaustive-deps
  const notReady = !customerId ? "Pick a customer first — their designs and mockups live on their account." : "Pick at least one garment to put the art on."
  // unsaved changes (Oct 27, Nick: "we're exiting a lot of times without saving… if you make changes and you go back to
  // an order, a pop-up that says are you sure you want to discard changes"). What's on screen at the first click or key
  // press is the starting point (the art, inks and circle finding all load by themselves before that); a save resets it.
  const editSig = JSON.stringify({
    i: imprints.map((x) => { const { shownArt: _a, center, ...rest } = x; void _a; return { ...rest, c: center?.by === "you" ? center : null }; }),
    o: offsets, l: lines, p: Object.fromEntries(Object.entries(paints).map(([k, v]) => [k, [v.map, v.unite ?? null]])),
  });
  const sigNow = useRef(editSig); sigNow.current = editSig;
  const dirty = !portal && !viewId && !auto && baseSig.current !== null && baseSig.current !== editSig;
  const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const markSaved = () => { baseSig.current = sigNow.current; };
  sigNowRef.current = () => sigNow.current; dirtyRefOut.current = () => dirtyRef.current;
  return (
    <BrandCtx.Provider value={brand}>
      {leave && (
        <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="lv-t">
          <div className="mk-modal">
            <h2 id="lv-t">Discard your changes?</h2>
            <p>You changed this mockup and it isn&apos;t saved to the order yet. If you leave now, the changes are lost.</p>
            <div className="row" style={{ gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="btn ghost" onClick={() => setLeave(null)}>Keep editing</button>
              <button type="button" className="btn danger" onClick={() => { const to = leave; markSaved(); dirtyRef.current = false; setLeave(null); location.assign(to); }}>Discard changes</button>
              {orderId && !lock && <button type="button" className="btn primary" disabled={saving || !ready} onClick={async () => {
                const to = leave, vis = imprints.length > 0 && imprints.every((im) => im.visualOnly && !im.confirmed);
                setLeave(null); saveOk.current = false;
                await saveAll(vis);
                if (saveOk.current) { dirtyRef.current = false; location.assign(to); }
              }}>{saving ? "Saving…" : "Save and leave"}</button>}
            </div>
          </div>
        </div>
      )}
      {/* a logo's colors came up for a customer with brand standards: which set, or not now (Oct 16, Nick) */}
      {brandAsk && paints[brandAsk] && (() => {
        const im = imprints.find((x) => x.id === brandAsk);
        const gs = brand.groups.filter((g) => g.colors.length);
        if (!im || !gs.length) return null;
        return (
          <div className="bs-overlay" onClick={(e) => { if (e.target === e.currentTarget) setBrandAsk(null); }}>
            <BrandPick modal groups={gs.map((g) => ({ label: g.label, colors: g.colors, go: () => matchBrand(im, g.key) }))} onPick={(g) => { g.go(); setBrandAsk(null); }} onClose={() => setBrandAsk(null)} />
          </div>
        );
      })()}
      {/* back to the order: a full load, so mockups saved here show (a client-side link showed the order as it was) */}
      {!portal && orderId ? <a className="back" href={`/shop/orders/${orderId}`}>← Order #{order?.number || ""}</a>
        : <Link className="back" href={portal ? (requestId ? `/portal/request/${requestId}` : backHref || "/portal") : "/shop/artwork"}>← {portal ? (requestId ? "Back to the order" : "Dashboard") : "Artwork"}</Link>}
      {portal && lock && <div className="mk-lockbar" role="note">
        <span className="mk-lockbar-l"><span className="mk-lockbar-fbs" aria-hidden>fbs</span><b>{lock.fbs ? "FBS made mockup" : "Ordered mockup"}</b></span>
        <span className="mk-lockbar-m"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>{lock.orderNo ? `On order #${lock.orderNo}` : "Only editable by FBS staff"}</span>
        <button type="button" className="btn sm primary" onClick={copyLocked}>Make a copy to edit</button>
      </div>}
      {portal && change && viewId && <div className="callout mk-change"><b>Your proof for order #{change.orderNumber}</b> This is the shirt and prints exactly as we set them up. Turn it, zoom in, look at each print. To change something, go back and choose Make changes. <a href={`/portal/orders/${change.orderId}/review/${viewId}`}>Back to the review</a></div>}
      {portal && change && !viewId && <div className="callout mk-change"><b>Changing the art for order #{change.orderNumber}</b> Change the shirt color, the size or where it sits, then press Save. It comes to us: we&apos;ll check it can print and send you a new proof. <a href={`/portal/orders/${change.orderId}`}>Cancel</a></div>}
      {sizeAskB && sizeAskB.length > 0 && (() => {
        const who = custLabel(customers.find((c) => c.id === customerId)) || "this customer";
        const stds = (brandPrint?.sizes || []).filter((r) => r.width > 0 && imprints.some((im) => im.location === r.location));
        return (
          <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Check the sizes against their brand standards">
            <div className="dla" style={{ maxWidth: 480 }}>
              <h3>Check the print sizes</h3>
              <p className="dla-sub">{who}&apos;s brand standards: {stds.map((r) => `${r.location} ${r.width}" wide`).join(", ")}.</p>
              <ul className="mk-ba-list">{sizeAskB.map((a) => <li key={a.id}><b>{a.loc}</b>: this order has <b>{a.have}&quot;</b> wide, their standard is <b>{a.want}&quot;</b>.</li>)}</ul>
              <div className="dla-acts">
                <button type="button" className="btn" onClick={() => setSizeAskB(null)}>Keep the order&apos;s size{sizeAskB.length === 1 ? "" : "s"}</button>
                <button type="button" className="btn primary" onClick={() => { const a = sizeAskB; setImprints((xs) => xs.map((x) => { const y = a.find((z) => z.id === x.id); return y ? { ...x, size: `${y.want}" wide`, sizeFrom: "brand" as const } : x; })); setSizeAskB(null); setMsg("Set to their standard size. Save to keep it on the order."); }}>Use their standard</button>
              </div>
            </div>
          </div>
        );
      })()}
      <div className="page-head mk-head">
        <div><div className="eyebrow">{custLabel(customers.find((c) => c.id === customerId)) || (portal ? "Your artwork" : "Artwork")}</div><h1>{orderId ? `Mockup · ${groupName}` : "Mockup Creator"}</h1></div>
        <div className="row"><span className="save-state">{msg}</span>{orderId && <button className="btn" type="button" disabled={saving} onClick={async () => { if (await syncOrder()) { baseSig.current = sigNowRef.current(); setMsg("Order updated."); } }}>Update order only</button>}{orderId && !portal && imprints.some((im) => im.method === "screen") && <button className="btn" type="button" disabled={saving || !ready} title="A separation for each screen-print location (front, back, sleeve), from each logo's print plan; opens the first" onClick={createSeps}>Create Separations</button>}{<span className="mk-sales"><button className={"btn" + (salesOpen ? " on" : "")} type="button" disabled={!ready} aria-haspopup="menu" aria-expanded={salesOpen} title={ready ? "Sales sheets and other things to sell from" : notReady} onClick={() => setSalesOpen((o) => !o)}>Sales tools ▾</button>
          {salesOpen && <div className="mk-sales-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setSalesOpen(false); void openSheet(); }}><b>Sales sheet creator</b><span>Every color on one page: lay it out, add text and pictures, download a picture or PDF</span></button></div>}</span>}
          <button className={"btn" + (pdfOpen ? " on" : "")} type="button" disabled={!ready || pdfBusy} title={ready ? "A PDF of the mockup to send the customer" : notReady} onClick={() => setPdfOpen((o) => !o)}>Export PDF</button>{!viewId && !lock && <button className={"btn primary" + (backIn != null ? " mk-back-cd" : "")} type="button" disabled={(saving && backIn == null) || !ready} title={backIn != null ? "Click to stay here" : ready ? undefined : notReady} style={backIn != null ? { ["--cd" as string]: `${backIn / 3}` } : undefined} onClick={async () => {
          // counting down back to the order: a click stays here
          if (backIn != null) { setBackIn(null); setMsg("Saved. Staying here."); return; }
          setAdjust(false);
          const vis = imprints.length > 0 && imprints.every((im) => im.visualOnly && !im.confirmed);
          saveOk.current = false;
          await saveAll(vis);
          // saved to an order: back to it in 3 seconds, loaded fresh so the new mockup shows, unless the button is
          // clicked again (Oct 23, Nick: "a 3-second countdown to return to the order, unless you click it again… just
          // like the archive email button")
          if (saveOk.current && orderId && !portal) setBackIn(3);
        }}>{backIn != null && <span className="mk-cd-tip" aria-live="polite">Back to the order in {backIn}… click to stay</span>}{saving && backIn == null ? "Saving…" : imprints.length > 0 && imprints.every((im) => im.visualOnly && !im.confirmed) ? "Save visual mockup" : orderId ? "Save mockups to order" : "Save mockup"}</button>}</div>
      </div>

        {sheetOpen && (
          <SalesSheet colors={lines.filter((z) => z.style && z.color).map((z) => ({ key: z.id, color: z.color, style: [z.brand, z.style].filter(Boolean).join(" "), hex: shirtHex(z) }))}
            arts={imprints.filter((im) => designOf(im) && artUrl(im)).map((im) => ({ label: im.location, url: artUrl(im) }))}
            views={views as ("front" | "back")[]} shirts={sheetShirts} title0={groupName} customer={portal ? "" : custLabel(customers.find((c) => c.id === customerId)) || ""}
            details={[
              // the garments, then each print: where, how, its inks and size (Oct 24, Nick: "add the details, the imprint locations")
              ...[...new Set(lines.filter((z) => z.style).map((z) => [z.brand, z.style, garmentFor(z)?.description || z.garment].filter(Boolean).join(" ")))],
              ...imprints.filter((im) => im.location).map((im) => [im.location, METHODS[im.method], im.inks, im.size ? `${im.size}` : ""].filter(Boolean).join(" · ")),
            ]}
            shop={sheetShop} onClose={() => setSheetOpen(false)} />
        )}
        {pdfOpen && (
          <section className="panel mk-pdf">
            <div className="mk-pdf-h"><b>Export PDF</b><span className="faint">Laid out like the order's art proof, ready to send the customer.</span></div>
            {portal ? (
              <div className="mk-pdf-opts">
                <div className="chips">{([["private", "Private label (your logo)"], ["fbs", "FBS Print"], ["none", "No logo"]] as const).map(([k, t]) => <button key={k} type="button" className={"chip" + (pdfBrand === k ? " on" : "")} onClick={() => setPdfBrand(k)}>{t}</button>)}</div>
                <span className="faint">{pdfBrand === "private" ? "Your company's name and logo on top (set your logo in Settings). Nothing from FBS." : pdfBrand === "fbs" ? "FBS Print's logo on top." : "No logo on top."}</span>
                {pdfBrand !== "fbs" && <label className="mk-f"><span>For (your client, optional)</span><input type="text" value={pdfFor} placeholder="e.g. Lakeview Booster Club" onChange={(e) => setPdfFor(e.target.value)} /></label>}
              </div>
            ) : (
                        <div className="mk-pdf-opts">
              <label className="sep-chk"><input type="checkbox" checked={pdfOurs} onChange={(e) => setPdfOurs(e.target.checked)} /> Our logo &amp; contact (FBS)</label>
              <label className="sep-chk"><input type="checkbox" checked={pdfCompany} onChange={(e) => setPdfCompany(e.target.checked)} /> Company name ({custLabel(customers.find((c) => c.id === customerId)) || "the customer"})</label>
            </div>
            )}
            <p className="faint mk-pdf-note">Page 1: the first shirt big, the prints, the garments and the approval box (they can check a box and sign in Acrobat). Then each other color on its own page, and each print blown up on its own page with its size and inks.{!pdfOurs && !pdfCompany ? " No names on it." : ""}</p>
            <label className="mk-f mk-pdf-desc"><span>Description (optional)</span><textarea rows={2} placeholder="e.g. Fall fundraiser tee, front chest logo with full back" value={pdfDesc} onChange={(e) => setPdfDesc(e.target.value)} /></label>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn primary" disabled={pdfBusy} onClick={async () => {
                if (!portal) return exportPdf({ ours: pdfOurs, company: pdfCompany, description: pdfDesc });
                if (pdfBrand === "fbs") return exportPdf({ ours: true, company: true, description: pdfDesc });
                const b = pdfBrand === "private" ? await mySheetBrand() : null;
                return exportPdf({ ours: pdfBrand === "private", company: false, description: pdfDesc, brand: b && b.ok ? { name: b.name, logoUrl: b.logoUrl } : { name: "", logoUrl: "" }, forName: pdfFor });
              }}>{pdfBusy ? "Making the PDF…" : "Download PDF"}</button>
              <button type="button" className="btn ghost" onClick={() => setPdfOpen(false)}>Close</button>
            </div>
          </section>
        )}
        {!orderId && (
          <section className="panel mk-setup">
            {!portal && <div className="mk-f"><span>Customer</span><CustomerPick field value={customerId || null} options={customers.map((c) => ({ id: c.id, label: custLabel(c), sub: c.company && c.name ? c.name : c.email || "" }))} onPick={(v) => setCustomerId(v || "")} /></div>}
            <label className="mk-f"><span>Mockup name</span><input type="text" aria-label="Mockup name" placeholder="e.g. Spring promo tee" value={groupName} onChange={(e) => setGroupName(e.target.value)} /></label>
            {/* the garments grouped by style, each style's colors as chips under it (Oct 22, Nick: "this top part… is
                jumbled… maybe grouping like styles and just listing colors under"); a color chip shows that shirt */}
            {(() => {
              const keyOf = (l: Line) => (l.style.trim() ? `${l.style.trim().toLowerCase()}|${(l.brand || "").toLowerCase()}` : `new:${l.id}`);
              const groups: { key: string; idx: number[] }[] = [];
              lines.forEach((l, i) => { const k = keyOf(l), g = groups.find((x) => x.key === k); if (g) g.idx.push(i); else groups.push({ key: k, idx: [i] }); });
              const setStyle = (ids: string[], f: (x: Line) => Line) => setLines((ls) => {
                const out = ls.map((x) => (ids.includes(x.id) ? f(x) : x));
                // colors the new style doesn't come in drop off (one line of the style stays)
                const keep = out.filter((x, j) => !ids.includes(x.id) || x.color || out.findIndex((y) => ids.includes(y.id)) === j);
                return keep.length ? keep : out;
              });
              const pickStyle = (ids: string[], gg: { style: string; brand: string; description: string; colors?: string[] }) => setStyle(ids, (x) => ({ ...x, style: gg.style, brand: gg.brand, garment: gg.description, color: gg.colors?.includes(x.color) ? x.color : "" }));
              const removeLine = (i: number) => { setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ ...ls[0], color: "" }])); setActive((a) => (a >= i && a > 0 ? a - 1 : a)); };
              return (
                <div className="mk-f mk-gar"><span className="mk-gar-h"><span>Garments</span><span>Color</span></span>
                  {groups.map((gr) => {
                    const l0 = lines[gr.idx[0]], g = garmentFor(l0), ids = gr.idx.map((i) => lines[i].id);
                    const have = gr.idx.map((i) => lines[i].color).filter(Boolean);
                    return (
                      <div key={l0.id} className="mk-gar-row">
                        {l0.own ? (
                          <div className="mk-style mk-own"><b data-notranslate>{l0.style || "Your garment"}</b><small className="mk-style-n">Your photos · not from a supplier</small></div>
                        ) : <div className="mk-style">
                          <StylePicker value={l0.style} catalog={catalog} busy={!!lookingUp}
                            onType={(v) => setLines((ls) => ls.map((x) => (ids.includes(x.id) ? { ...x, style: v, brand: "", garment: "" } : x)))}
                            onPick={(gg) => pickStyle(ids, gg)}
                            onPickSS={async (h) => { const gg = await lookupStyle(h.style, h.styleID || undefined, h.supplier); if (gg) pickStyle(ids, gg); }} />
                          <small className="mk-style-n" data-notranslate>{lookingUp ? "Pulling it in…" : g ? `${g.brand} · ${g.description}` : l0.style.trim() ? `Not in a catalog: shown as a drawn ${STOCK_LABEL[drawnKind(l0)].toLowerCase()} (or pick a style from the list)` : "Type a style #, e.g. 6210, 5000, PC54"}</small>
                        </div>}
                        <div className="mk-gar-colors">
                          {gr.idx.filter((i) => lines[i].color).map((i) => {
                            const l = lines[i], hex = l.own || l.hex ? shirtHex(l) : garmentHex(g?.color_images?.[l.color]?.hex, l.color);
                            return (
                              // drag a color to put it in order (Oct 23, Nick: "I should be able to drag that chip over so it shows in
                              // that order… when I make the sales tools"): the colors' order is the order everywhere after
                              <span key={l.id} className={"mk-gc" + (i === active ? " on" : "") + (dragC === i ? " drag" : "")} draggable
                                onDragStart={(e) => { setDragC(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
                                onDragEnd={() => setDragC(null)}
                                onDragOver={(e) => { if (dragC != null && dragC !== i && gr.idx.includes(dragC)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
                                onDrop={(e) => { e.preventDefault(); const from = dragC; setDragC(null); if (from == null || from === i || !gr.idx.includes(from)) return; moveLine(from, i); }}>
                                <button type="button" className="mk-gc-pick" onClick={() => setActive(i)} title={`Show ${l.color}`}><span className="mk-gc-dot" style={{ background: hex }} />{l.color}</button>
                                <button type="button" className="mk-gc-x" aria-label={`Remove ${l.color}`} onClick={() => removeLine(i)}>✕</button>
                              </span>
                            );
                          })}
                          {l0.own && <button type="button" className="mk-gc-add mk-own-add" title="Add another color: upload its photos" onClick={() => setOwnUp({ name: l0.style, color: "", front: null, back: null, lock: true })}>＋ Color</button>}
                          {g && <AddColor colors={(g.colors || []).filter((c) => !have.includes(c))} onAdd={(c) => {
                            const blank = gr.idx.find((i) => !lines[i].color);
                            if (blank != null) { setLines((ls) => ls.map((x, j) => (j === blank ? { ...x, color: c } : x))); setActive(blank); }
                            else { setLines((ls) => [...ls, { ...l0, id: uid(), color: c }]); setActive(lines.length); }
                          }} />}
                        </div>
                        {groups.length > 1 && <button type="button" className="btn icon ghost mk-gar-x" aria-label={`Remove ${l0.style || "this style"}`} title="Remove this style and its colors" onClick={() => { setLines((ls) => ls.filter((x) => !ids.includes(x.id))); setActive(0); }}>✕</button>}
                      </div>
                    );
                  })}
                  <div className="mk-help-row"><button type="button" className="btn sm mk-help-pick" onClick={() => setPopOpen(true)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden><path d="M8 4l-4 3 2 4 2-1v10h8V10l2 1 2-4-4-3c-1 2-3 2-4 2s-3 0-4-2z" /></svg>Need help picking garments?</button></div>
                  {popOpen && <PopularGarments askHref={portal ? `/portal?area=messages${asId ? `&as=${asId}` : ""}` : undefined} onClose={() => setPopOpen(false)} onPick={(g) => {
                    setPopOpen(false);
                    setLines((ls) => { const blank = ls.find((x) => !x.style.trim()); const ln = { style: g.style, brand: g.brand, color: "", garment: g.garment }; return blank ? ls.map((x) => (x.id === blank.id ? { ...x, ...ln } : x)) : [...ls, { id: uid(), ...ln }]; });
                  }} />}
                  <div className="row mk-add-row" style={{ gap: 8 }}>
                    <button className="btn sm mk-add" type="button" onClick={() => setLines((ls) => [...ls, { id: uid(), style: "", brand: "", color: "", garment: "" }])}>+ Add a style</button>
                    {/* a garment the suppliers don't carry (Oct 24, Nick: "images not in catalog, upload my own images") */}
                    <button className="btn sm ghost mk-add mk-own-up" type="button" onClick={() => setOwnUp({ name: "", color: "", front: null, back: null })}>Not in the catalog? Upload photos</button>
                  </div>
                </div>
              );
            })()}
          </section>
        )}
      {ownUp && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Upload your own garment photos" onClick={() => !ownUp.busy && setOwnUp(null)}>
          <div className="dla mk-own-dlg" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="dla-x" aria-label="Close" disabled={!!ownUp.busy} onClick={() => setOwnUp(null)}>×</button>
            <h3>{ownUp.lock ? `Another color of ${ownUp.name}` : "Your own garment photos"}</h3>
            <p className="dla-sub">For a garment we don&apos;t carry: a straight-on photo of the front (and the back, if you have one), on a plain background. We find the shirt and place your art on it; drag the art to line it up.</p>
            <div className="grid g2" style={{ gap: 10 }}>
              <div className="field"><label htmlFor="own-n">Garment</label><input id="own-n" type="text" placeholder="e.g. LA Apparel 1801" value={ownUp.name} disabled={ownUp.lock} onChange={(e) => setOwnUp({ ...ownUp, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="own-c">Color</label><input id="own-c" type="text" placeholder="e.g. Black" value={ownUp.color} onChange={(e) => setOwnUp({ ...ownUp, color: e.target.value })} /></div>
            </div>
            <div className="mk-own-pics">
              {(["front", "back"] as const).map((sd) => {
                const f = ownUp[sd];
                return (
                  <label key={sd} className={"mk-own-pic" + (f ? " has" : "")}>
                    {f ? <img src={URL.createObjectURL(f)} alt="" /> : <span>＋ {sd === "front" ? "Front photo" : "Back photo (optional)"}</span>}
                    <input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { const x = e.target.files?.[0] || null; e.target.value = ""; setOwnUp((o) => (o ? { ...o, [sd]: x } : o)); }} />
                    {f && <small>{sd === "front" ? "Front" : "Back"} · click to change</small>}
                  </label>
                );
              })}
            </div>
            {ownUp.err && <div className="pv-err">{ownUp.err}</div>}
            <div className="dla-acts">
              <span className="faint" style={{ fontSize: 12, marginRight: "auto" }}>{ownUp.busy}</span>
              <button type="button" className="btn ghost" disabled={!!ownUp.busy} onClick={() => setOwnUp(null)}>Cancel</button>
              <button type="button" className="btn primary" disabled={!!ownUp.busy || !ownUp.front || !ownUp.name.trim() || !ownUp.color.trim()} onClick={() => void addOwn()}>Use these photos</button>
            </div>
          </div>
        </div>
      )}
      {askUploaded && (
        <div className="confirm-bar" style={{ marginBottom: 10 }}>
          <span>Some design colors are still &quot;as uploaded&quot; instead of a standard ink ({imprints.filter((im) => !(im.visualOnly && !im.confirmed) && unsetColors(im).length).map((im) => `${im.location}: ${unsetColors(im).length}`).join(", ")}). Set them to the closest Wilflex RFU inks?</span>
          <button type="button" className="btn sm primary" onClick={() => { imprints.forEach(matchStandard); setAskUploaded(false); setMsg("Matched to the closest standard inks. Check them, then save."); }}>Use closest standard inks</button>
          <button type="button" className="btn sm" onClick={() => saveAll(true)}>Save as uploaded</button>
          <button type="button" className="btn sm ghost" onClick={() => setAskUploaded(false)}>Cancel</button>
        </div>
      )}
          {lines.length > 1 && !!orderId && (
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
              <span className="chips">{runSizes.map((z) => {
                const on = (shownSize && runSizes.includes(shownSize) ? shownSize : body.size) === z;
                return <button key={z} type="button" className={"chip" + (on ? " on" : "")} aria-pressed={on} title={on ? "The mockup and proof show this size" : `See the same print on a ${z}`} onClick={() => setShownSize(z)}>{z}</button>;
              })}</span>
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
              <Stage key={v} grid={grid} norm={frameOf(line, v)}
                neckLine={USE_HAND_AREAS && v === "front" && line && fitFor(line, v)?.neck != null && !fitFor(line, v)?.flat ? { y: fitFor(line, v)!.neck!, tag: neckTag(line), onSet: (y) => { const a = settingsLine(line, "front"); const r = a && a !== line ? regs[`${photo(a, "front")}>${photo(line, "front")}`] : null; if (a && r) setNeck(a, r.a * y + r.by); else setNeck(line, y); } } : undefined} cx={fitFor(line, v)?.cx}
                areaEdit={false}
                onArea={(dx, dy, kMul) => nudgeArea(line, v, dx, dy, kMul)}
                areaNote={undefined}
                corner={<>
                  {(v === "front" || single) && (
                    <div className="mk-corner l">
                      <label className="mk-pill"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Print areas</label>
                      <label className="mk-pill" title="An inch grid over the garment: its size, the max print area and each print's size"><input type="checkbox" checked={measure} onChange={(e) => setMeasure(e.target.checked)} /> Measure</label>
                      {Object.keys(offsets).length > 0 && <button className="mk-pill" type="button" onClick={() => setOffsets({})}>Reset positions</button>}
                      {isHoodie(line) && <label className="mk-pill" title="On the back: drag roughly along the bottom edge of the hood; it snaps to the edge and prints go behind the hood (remembered for this hoodie and color)"><input type="checkbox" checked={hoodDraw} onChange={(e) => setHoodDraw(e.target.checked)} /> Hoodie tool{hoodOf(line) ? " ✓" : ""}</label>}
                    </div>
                  )}
                  {/* scale, each side on its own, top right of its photo (Oct 24, Nick: "scale front, scale back") */}
                  {zoomG && <div className="mk-corner tr">{zoomCtl(v)}</div>}
                  {/* no flat back photo at S&S or SanMar: pick one (Oct 26) */}
                  {v === "back" && line && backAsk(line) && (() => { const q = backAsk(line)!; return (
                    <div className="mk-noback" role="group" aria-label="Pick a back photo">
                      <b>No flat back photo of {garmentFor(line)?.style} {q.name}</b>
                      <span className="faint">S&amp;S and SanMar don&apos;t have one. Pick what to use for the back:</span>
                      <div className="mk-noback-pics">
                        {q.others.map((o) => <button key={o.path} type="button" disabled={!!backBusy} onClick={() => void pickBack(line, o.path, /model/i.test(o.label) ? "model" : /side/i.test(o.label) ? "side" : "picked")}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={ssImg(o.path)} alt="" /><span>{o.label}</span></button>)}
                        <button type="button" disabled={!!backBusy} onClick={() => void pickBack(line, "drawn", "drawn")}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={drawn(line, "back")} alt="" /><span>Drawn back</span></button>
                      </div>
                      <label className={"btn sm" + (backBusy ? " off" : "")}>{backBusy === "upload" ? "Uploading…" : "Upload a back photo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={!!backBusy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadBack(line, f); }} /></label>
                      {backErr && <span className="err">{backErr}</span>}
                      <span className="faint">Saved on the garment, so every mockup of this color uses it.</span>
                    </div>
                  ); })()}
                  {(v === "back" || single) && <div className="mk-corner r"><span className="mk-pill" title={body.cap ? `Max print area ${body.cap.maxW}" × ${body.cap.maxH}" (the bag less 1.5" around)` : `${body.widthIn}" wide × ${body.lengthIn}" long (${body.from === "supplier" ? "the supplier's size chart" : "typical for this size"})`}>Shown on {shownOn}{capBody && !body.cap ? ` · sized for the ${capBody.size}` : ""}</span></div>}
                </>} overlay={<>{measure ? measured(v) : null}{v === "back" && hoodDraw && line && isHoodie(line) && <HoodTrace edge={hoodOf(line)} onDone={(pts) => void saveHood(line, pts)} onClear={() => void saveHood(line, null)} />}</>} mask={fitFor(line, v)?.mask} src={line ? photo(line, v) : stockSvg("tee", v)} label={v}
                items={imprints.filter((im) => viewsFor(im.location).includes(v)).map((im) => ({ id: im.id, p: place(im, v), url: artUrl(im, line || undefined), locked: !!im.visualOnly && !im.confirmed && !adjust }))}
                onMove={(id, dx, dy) => {
                  const im = imprints.find((x) => x.id === id);
                  const p = im && place(im, v);
                  if (p && p.clip) {
                    // sleeve: turn the drag into along-the-sleeve moves
                    const a = (-p.rot * Math.PI) / 180;
                    [dx, dy] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
                  }
                  if (p) { dx /= p.k; dy /= p.k; }
                  // the first color's drag moves the logo on every color; another color's drag is its own fine-tune on top
                  // of that, kept for that color only (Oct 22, Nick: "go into each individual one… drag… it just stays there")
                  const key = !line || !anchorLine || line.id === anchorLine.id ? id : `${line.id}:${id}`;
                  setOffsets((o) => ({ ...o, [key]: { dx: (o[key]?.dx || 0) + dx, dy: (o[key]?.dy || 0) + dy } }));
                }}
                onResize={(id, newW) => {
                  const im = imprints.find((x) => x.id === id); if (!im) return;
                  const old = place(im, v);
                  const inches = newW / (PX_PER_IN * scale * old.k);
                  // a size the customer asked for: ask before the first change (the drag stops until they say yes)
                  guardSize(id, () => { if (old.clip) growTo(im, inches); else settle(im, inches); });
                }}
                // letting go leaves the logo where it was dragged on the picture: no snapping back, no change of
                // location (Oct 22, Nick: "when I move the logo on the shirt, it just snaps it back")
                onEnd={() => {}}
                onPick={pickColor}
                onSelect={showImprint} />
            ))}
            {neckSet && line && (
              <div className="mk-neck-card" title="Private Label: the maker's tag cut out and their label printed inside the neck">
                <NeckLabelView set={neckSet} size={neckSize} shirtHex={guessHex(line.color)} width={190} />
                <small>{neckSet.name || "Neck label"}{neckSet.content ? ` · ${neckSet.content}` : ""}</small>
              </div>
            )}
          </div>
            <div className="mk-closeups" ref={cuRef} style={{ gridTemplateColumns: `repeat(${cuCols},minmax(0,1fr))` }}>
              {/* front locations first, then back, sleeves always last (in order-form order within each) */}
              {imprints.map((im, i) => ({ im, i })).sort((a, b) => {
                const rank = (x: Imprint) => (viewsFor(x.location).length > 1 ? 2 : spotFor(x.location).view === "back" ? 1 : 0);
                const pos = (x: Imprint) => { const k = LOCATIONS.indexOf(x.location); return k < 0 ? 999 : k; };
                return rank(a.im) - rank(b.im) || pos(a.im) - pos(b.im) || a.i - b.i;
              }).map(({ im }, i) => closeUp(im, cuSize, i === 0))}
            </div>
          </div>
          {designerFor && (
            <div className="sd-modal-back" role="dialog" aria-modal="true" aria-label="Design Lab">
              <div className="sd-modal">
                <ShirtDesigner key={designerFor.side + designerFor.imId} start={designerFor.start} onCanva={showCanva ? () => { const sd = designerFor.side; setDesignerFor(null); void designInCanva(undefined, undefined, sd); } : undefined} shirt={designerFor.shirt} saveLabel={`Save & put on the ${designerFor.side === "sleeve" ? "sleeve" : designerFor.side} →`} onClose={() => setDesignerFor(null)}
                  subtitle={[customers.find((c) => c.id === customerId)?.company || customers.find((c) => c.id === customerId)?.name || "", designerFor.side === "sleeve" ? "Sleeve" : designerFor.side === "back" ? "Back" : "Front"].filter(Boolean).join(" · ")}
                  logos={designs.filter((d) => urls[d.id] && !d.archived_at && !isQuick(d.id) && (!d.draft || imprints.some((x) => x.design_id === d.id))).map((d) => ({ id: d.id, name: designLabel(d), url: urls[d.id] }))}
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
          {centerAsk && !sizeAsk && !sizer && (() => {
            const im = centerAsk, d = designOf(im), u = artUrl(im), c = im.center!;
            return (
              <div className="mk-modal-back" role="dialog" aria-modal="true" aria-labelledby="ctr-t">
                <div className="mk-modal mk-ctr-ask">
                  <h2 id="ctr-t">Center on the circle?</h2>
                  <p>The {(im.location || "print").toLowerCase()} logo{d?.name ? <> ({d.name})</> : null} has a circle with something sticking out to the side. Should the circle be centered on the shirt, with the rest hanging off to the side?</p>
                  {u && <div className="mk-ctr-pic">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" />
                    <i className="mk-ctr-mid" aria-hidden title="the middle of the logo" />
                    <i className="mk-ctr-dot" aria-hidden style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }} title="the circle's middle" />
                  </div>}
                  <p className="faint" style={{ fontSize: 12.5 }}><span className="mk-ctr-key blue" /> the circle&apos;s middle &nbsp; <span className="mk-ctr-key" /> the middle of the whole logo</p>
                  <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" className="btn ghost" onClick={() => setCenterSkip((o) => ({ ...o, [im.id + im.design_id]: true }))}>Ask me later</button>
                    <button type="button" className="btn" onClick={() => answerCenter(im, false)}>Center the whole logo</button>
                    <button type="button" className="btn primary" onClick={() => answerCenter(im, true)}>Center on the circle</button>
                  </div>
                </div>
              </div>
            );
          })()}
          {sizer && (() => {
            const im = imprints.find((x) => x.id === sizer.ids[sizer.i]);
            if (!im) return null;
            const d = designOf(im), p = place(im), r = ratioIm(im) || 0;
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
                    {(() => { const r = brandRule(im); return r ? <div className="mk-cust-size brand">{(im.size || "").startsWith(`${r.width}"`) ? "Brand standard" : `Their standard is ${r.width}"`}: {r.note || `${r.which === "design" ? "this logo" : r.which === "any" ? "logos" : `${r.which} logos`} on the ${r.location.toLowerCase()}`} at {r.width}&quot;.</div> : null; })()}
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
          {/* saved from the customer's portal: order it right here (Oct 24, Nick: "when you make the mock-up and you save it
              from the customer view… the order button needs to be in there too") */}
          {portal && savedMock && (
            <div className="mk-saved-order">
              <span><b>{savedMock.num ? `M-${savedMock.num}` : "Your mockup"} is saved</b> in your artwork. Order it now, or come back any time.</span>
              <MockupOrderButton id={savedMock.id} canAct />
            </div>
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
          {(() => { const vis = imprints.some((im) => im.visualOnly && !im.confirmed); return vis && ready ? (
            <div className={"mk-vis-bar" + (adjust ? " on" : "")}>
              <div className="mk-vis-stamp"><b>Reorder mockup helper</b><span>Production confirms the details on the first run</span></div>
              {adjust
                ? <p>Drag the art on the shirt and pull its corner to size it. This only changes the picture: production still sets the size, inks and placement on the run.</p>
                : <p>The print settings stay as they are until production confirms them. You can still move and size the art so the picture looks right.</p>}
              <button type="button" className={"btn sm" + (adjust ? " primary" : "")} onClick={() => setAdjust((x) => !x)}>{adjust ? "Done adjusting" : "Adjust visual size & placement"}</button>
            </div>
          ) : null; })()}
          <section className={"panel" + (ready ? "" : " mk-off") + (imprints.some((im) => im.visualOnly && !im.confirmed) ? " mk-vis-lock" : "")} inert={!ready || imprints.some((im) => im.visualOnly && !im.confirmed) || undefined}>
            <div className="panel-h"><h2>Imprints</h2><div className="row" style={{ gap: 4 }}><button className="btn sm" type="button" onClick={() => { const opts = locsFor(curTab); setImprints([...imprints, newImprint(opts.find((z) => !imprints.some((i) => i.location === z)) || opts[0])]); setTab(curTab); }}title={`Add a ${curTab === "sleeve" ? "sleeve" : curTab} print location`}>+ Add location</button></div></div>
            <div className="chips mk-tabs">
              {SIDES.map((t) => { const n = imprints.filter((im) => sideOf(im.location) === t.id).length; return <button key={t.id} type="button" className={"chip" + (curTab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>{t.label}{n ? ` (${n})` : ""}</button>; })}
            </div>
            <div className="panel-b stack">
              {/* their other brand rules, in plain words (Brand standards → Other rules), Oct 16 */}
              {!portal && (brandPrint?.rules || []).length > 0 && <div className="mk-brand-rules"><b>Their brand rules</b><ul>{brandPrint!.rules!.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
              {imprints.every((im) => sideOf(im.location) !== curTab) && <div className="faint" style={{ fontSize: 13 }}>No {curTab === "sleeve" ? "sleeve" : curTab} prints yet.</div>}
              {imprints.filter((im) => sideOf(im.location) === curTab).map((im) => {
                const p = place(im);
                return (
                  <div key={im.id} className="mk-imp" data-imp={im.id}>
                    <div className="mk-imp-top">
                      <select aria-label="Location" className="mk-loc" value={im.location} onChange={(e) => setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, location: e.target.value } : x)))}>{!locsFor(curTab).includes(im.location) && <option>{im.location}</option>}{locsFor(curTab).map((z) => <option key={z}>{z}</option>)}</select>
                      <select aria-label={`Decoration method for ${im.location}`} value={im.method} onChange={(e) => { const m = e.target.value as Method; setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, method: m, colors: m === "embroidery" ? Math.min(x.colors, 15) : x.colors } : x)));
                        // heat press: the art back to its own colors (knock-outs stay)
                        if (m === "dtf") setPaints((pp) => { const pt = pp[im.id]; if (!pt) return pp; const map = { ...pt.map }; for (const x of pt.sources) if (map[x.hex]?.name !== "none") map[x.hex] = { name: "Full color", hex: x.hex }; return { ...pp, [im.id]: { ...pt, map } }; }); }}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    </div>
                    {/* Upload logo right under the location (Oct 9, Nick: no Logo / Text switch; text comes from + Add Text) */}
                    <label className="btn sm mk-upload" style={{ cursor: "pointer" }}>Upload logo<input type="file" hidden accept={DESIGN_ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; if (qt[im.id]) textMode(im, false); uploadNew(im, f); }} /></label>
                    {canvaReady && (designOf(im) as (Design & { canva_design_id?: string | null }) | undefined)?.canva_design_id && <button type="button" className="btn sm ghost" disabled={!!canvaWait} title="Opens this design in Canva; press Return in Canva to bring the changes back (saved as a new design)" onClick={() => designInCanva(designOf(im), im)}>Edit in Canva</button>}
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
                            <span>Add art, more lines, outlines or a photo in the Design Lab →</span>
                          </button>
                        </div>
                      );
                    })() : (<>
                    <DesignSearch designs={designs.filter((d) => !isQuick(d.id) && (!d.draft || imprints.some((x) => x.design_id === d.id)))} urls={urls} value={im.design_id} placeholder="Pick a logo…"
                      onPick={(d) => { setImprints((xs) => xs.map((x) => (x.id === im.id ? (d ? swapLogo(x, d) : { ...x, design_id: undefined }) : x))); if (d) askRaster(im.id, d); }}
                      onStar={async (d, starred) => {
                        setDesigns((ds) => ds.map((x) => (x.id === d.id ? { ...x, starred } : x)));
                        const { error } = portal ? await starMyDesign(d.id, starred).then((r) => ({ error: r.ok ? null : r.error })) : await sb.rpc("set_design_star", { p_design: d.id, p_starred: starred });
                        if (error) setDesigns((ds) => ds.map((x) => (x.id === d.id ? { ...x, starred: !starred } : x)));
                      }} />
                    {!p.d && <div className="ink-warn">Which logo goes on the {im.location}? Pick one{portal ? " of your logos" : " of the customer's logos"}, or upload new art.</div>}
                    {/* embroidery: threads and stitches, its own panel (Oct 23, Nick: "keep this completely separate") */}
                    {p.d && im.method === "embroidery" && paints[im.id]?.method === "embroidery" && (
                      <>
                        <EmbroideryPanel im={im} rows={colorRows(paints[im.id])} artUrl={artUrl(im)} wIn={p.wIn} hIn={p.hIn || 0} portal={portal} designId={p.d.id}
                          garment={(() => { const l = lines[active] || lines[0]; const g = l ? garmentFor(l) : undefined; return [l?.brand, l?.style, g?.description, l?.garment].filter(Boolean).join(" "); })()}
                          shirtLight={(() => { const l = lines[active] || lines[0]; return !!l && deltaE(shirtHex(l), "#ffffff") < 20; })()}
                          onPick={(hexes, v) => { setHover(null); setInks(im.id, Object.fromEntries(hexes.map((h) => [h, v]))); }}
                          onHover={(hexes, v) => setHover(v ? { id: im.id, hexes, v } : null)}
                          setIm={(patch) => setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, ...patch, ...(patch.emb ? { emb: { ...(x.emb || {}), ...patch.emb } } : {}) } : x)))} />
                        <label className="check emb-look"><input type="checkbox" checked={stitchOn} onChange={(e) => setStitchOn(e.target.checked)} /> Show it stitched on the mockup</label>
                      </>
                    )}
                    {/* heat press: a full color transfer, only its size matters (Oct 26, Nick: "with heat press… all the options go
                        away. It's all just a full color image and you're figuring by size") */}
                    {p.d && im.method === "dtf" && (
                      <div className="mk-full">
                        <b>Heat press (DTF)</b> <span className="faint">Full color, as it shows here: no inks or screens, just the size below.</span>
                        {/* knock a color out (Oct 26, Nick: "you don't need the color identifier… but you should be able to knock out colors") */}
                        {paints[im.id] && paints[im.id].sources.length > 0 && (
                          <div className="mk-ko">
                            <span className="faint">Knock out:</span>
                            {paints[im.id].sources.map((x) => {
                              const off = paints[im.id].map[x.hex]?.name === "none";
                              return <button key={x.hex} type="button" className={"gang-dot" + (off ? " off" : "")} style={{ background: x.hex }} aria-pressed={off} title={off ? `${x.hex} knocked out: click to print it` : `Knock out ${x.hex} (the shirt shows through)`} onClick={() => setInks(im.id, { [x.hex]: off ? { name: "Full color", hex: x.hex } : { name: "none", hex: x.hex } })} />;
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    {/* full color art: how it prints (Oct 26) */}
                    {p.d && !portal && im.method !== "embroidery" && im.method !== "dtf" && (() => {
                      if (paints[im.id]?.plan?.method === "sim" || im.fullColor) fullSeen.current.add(im.id);
                      if (!fullSeen.current.has(im.id)) return null;
                      const how = im.method === "dtf" ? "dtf" : im.fullColor ? "full" : paints[im.id]?.plan?.method === "spot" ? "spot" : "";
                      return (
                        <div className={"mk-full" + (how ? "" : " ask")}>
                          <b>Full color art</b> <span className="faint">a photo or shading, not flat colors. How will it print?</span>
                          <div className="chips">
                            <button type="button" className={"chip" + (how === "dtf" ? " on" : "")} onClick={() => void printAs(im, "dtf")}>Heat press (DTF)</button>
                            <button type="button" className={"chip" + (how === "full" ? " on" : "")} onClick={() => void printAs(im, "full")}>Screen print, full color</button>
                            <button type="button" className={"chip" + (how === "spot" ? " on" : "")} onClick={() => void printAs(im, "spot")}>Spot colors</button>
                          </div>
                          {how === "full" && <span className="faint">The picture goes on the mockup as is, about {im.colors} colors for now. Production confirms the colors and the price on Production details before the quote goes out; the customer&apos;s proof is picture only. Seps: made in Separo.</span>}
                          {how === "dtf" && <span className="faint">A full color transfer: no screens, nothing for production to confirm.</span>}
                          {how === "spot" && <span className="faint">Planned as spot colors: pick the inks below.</span>}
                        </div>
                      );
                    })()}
                    {p.d && im.method !== "embroidery" && im.method !== "dtf" && paints[im.id]?.plan && !(im.visualOnly && !im.confirmed) && <div className={"mk-plan" + (paints[im.id].plan!.method === "sim" ? " sim" : "")}><b>How it prints:</b> {printWhy(paints[im.id].plan!, inkList(im).length)}</div>}
                    {p.d && im.method !== "embroidery" && im.method !== "dtf" && paints[im.id] && paints[im.id].sources.length > 0 && (
                      <LogoColors rows={colorRows(paints[im.id])}
                        onPick={(hexes, v) => { setHover(null); setInks(im.id, Object.fromEntries(hexes.map((h) => [h, v]))); }}
                        onHover={(hexes, v) => setHover(v ? { id: im.id, hexes, v } : null)}
                        onSplit={() => setUnite(im.id, false)}
                        onCombine={(picks) => { setHover(null); setInks(im.id, picks); setUnite(im.id, true); }}
                        onMatchAll={unsetColors(im).length > 0 ? () => matchStandard(im) : undefined}
                        brandGroups={brand.groups.filter((g) => g.colors.length).map((g) => ({ label: g.label, colors: g.colors, go: () => matchBrand(im, g.key) }))} />
                    )}
                    </>)}
                    <div className="mk-imp-foot">
                      <div className="row mk-wh" style={{ gap: 4 }}>
                        {(() => {
                          const tall = /tall/i.test(im.size);
                          const typed = (im.size.match(/^([\d.]+)/) || [])[1] || "";
                          const set = (v: string, dim: "wide" | "tall") => {
                            let t = v.replace(/[^\d.]/g, "");
                            // cap at the biggest print this side of the shirt takes (sleeves: 3.5" x 3.5"); the location follows when you leave the box
                            const r = ratioIm(im) || 0;
                            const capW = sideMaxWidth(im.location, r), cap = dim === "wide" ? capW : capW * (r || 1);
                            if (t && !t.endsWith(".") && +t > cap) t = String(Math.round(cap * 100) / 100);
                            guardSize(im.id, () => setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, size: t ? `${t}" ${dim}` : "", sizeFrom: "staff" as const } : x))));
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
                      {/* "Center on the circle" isn't a checkbox any more (Oct 27, Nick): it's found and asked in a pop-up; once
                          it's on, a note says so with a way back */}
                      {designOf(im) && im.center?.on && im.center.d === im.design_id && (
                        <span className="mk-ctr-on faint">Centered on the circle · <button type="button" className="linkbtn" onClick={() => void toggleCenter(im, false)}>undo</button></span>
                      )}
                      {/* Color change (Oct 24, Nick: "when you click on… the second garment… another one right there that says color
                          change… confirm you're changing the color on this garment only… select the color"): this garment's ink(s) */}
                      {designOf(im) && im.method !== "dtf" && line && (() => {
                        const first = lines.find((l) => (l.color || "").trim()) || lines[0];
                        if (!first || colorKey(first.color) === colorKey(line.color) || !(line.color || "").trim()) return null;
                        const ck = colorKey(line.color), cur = im.inkBy?.[ck];
                        const names = [...new Set([...Object.values(paints[im.id]?.map || {}).map((v) => v.name).filter((n) => n && n !== "none"), ...(im.inks || "").split(",").map((x) => x.trim()).filter(Boolean)])].slice(0, 8);
                        const put = (next: Record<string, string> | null) => setImprints((xs) => xs.map((x) => {
                          if (x.id !== im.id) return x;
                          const inkBy = { ...(x.inkBy || {}) };
                          if (next) inkBy[ck] = next; else delete inkBy[ck];
                          const y = { ...x, inkBy: Object.keys(inkBy).length ? inkBy : undefined };
                          return { ...y, inkChanges: colorChanges(y) };
                        }));
                        const n = colorChanges({ inkBy: cur ? { [ck]: cur } : {} });
                        return (
                          <>
                            <label className="mk-ctr" title={im.method === "embroidery" ? `Sew this location in another thread on the ${line.color} only` : `Print this location in another ink on the ${line.color} only`}>
                              <input type="checkbox" checked={!!cur} disabled={!names.length} onChange={(e) => put(e.target.checked ? Object.fromEntries(names.map((nm) => [nm, ""])) : null)} />
                              {changeWord(im.method)}
                            </label>
                            {cur && (
                              <div className="mk-cchg">
                                <span className="mk-cchg-n">On the {[line.style, line.color].filter(Boolean).join(" ")} only. {first.color ? `The ${first.color} stays as it is.` : ""}</span>
                                {names.map((nm) => (
                                  <div key={nm} className="mk-cchg-r">
                                    <i style={{ background: colorHex(nm) || "#ccc" }} /><span>{nm}</span><span aria-hidden>→</span>
                                    <input type="text" list="mk-ink-names" aria-label={`${nm} on the ${line.color}`} placeholder={im.method === "embroidery" ? "the thread on this color" : "the ink on this color"} value={cur[nm] || ""} onChange={(e) => put({ ...cur, [nm]: e.target.value })} />
                                    {cur[nm] && colorHex(cur[nm]) ? <i style={{ background: colorHex(cur[nm])! }} /> : null}
                                  </div>
                                ))}
                                <span className="faint">{im.method === "embroidery" ? (n ? `${n} thread change${n === 1 ? "" : "s"}: charged on the order (per thread)` : "Type the thread it sews in on this color") : n ? `${n} color change${n === 1 ? "" : "s"}: charged as ${n === 1 ? "an ink change" : "ink changes"} on the order (per screen)` : "Type the ink it prints in on this color"}</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                      {/* Color change across variations (Oct 27, Nick: #40111, the Section Stack on the Charcoal tee and the
                          Neon Blue long sleeve are two groups, and neither showed the button): the same art at the same spot
                          in another group of the order. Ticked, the two print from one set of screens (setup once) and each
                          changed ink is an ink change (calcOrder, Imprint.changeOf) */}
                      {designOf(im) && im.method === "screen" && order && curGroup && (() => {
                        const nameOf = (id?: string) => (designs.find((d) => d.id === id)?.name || "").trim().toLowerCase();
                        const mine = nameOf(im.design_id), loc = (im.location || "").toLowerCase();
                        const others = orderGroups(order).filter((g) => g.id !== curGroup.id).flatMap((g) => (g.imprints || []).map((x) => ({ g, x })))
                          .filter(({ x }) => x.method === "screen" && x.id !== im.id && (x.location || "").toLowerCase() === loc && (x.design_id === im.design_id || (!!mine && nameOf(x.design_id) === mine)));
                        if (!others.length) return null;
                        const gName = (g: { name?: string }, i?: number) => g.name || `Group ${(i ?? 0) + 1}`;
                        // the other side already points here: say so instead of offering it twice
                        const back = others.find(({ x }) => x.changeOf?.imprint === im.id);
                        if (back && !im.changeOf) return <div className="mk-cchg"><span className="mk-cchg-n">{gName(back.g)} prints this art as a color change of this print, from the same screens.</span></div>;
                        const cur = im.changeOf, base = others.find(({ x }) => x.id === cur?.imprint) || others[0];
                        const baseInks = (base.x.inks || "").split(",").map((v) => v.trim()).filter(Boolean);
                        const myInks = (im.inks || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
                        const put = (next: Imprint["changeOf"] | null) => setImprints((xs) => xs.map((x) => {
                          if (x.id !== im.id) return x;
                          const y = { ...x, changeOf: next || undefined };
                          return { ...y, inkChanges: colorChanges(y) };
                        }));
                        const start = (b: typeof base) => put({ imprint: b.x.id, group: b.g.id, inks: Object.fromEntries((b.x.inks || "").split(",").map((v) => v.trim()).filter(Boolean).map((nm) => [nm, myInks.includes(nm.toLowerCase()) ? nm : ""])) });
                        const n = colorChanges({ changeOf: cur });
                        return (
                          <>
                            <label className="mk-ctr" title={`The same art as ${gName(base.g)}: print it from the same screens, in other inks on this garment`}>
                              <input type="checkbox" checked={!!cur} disabled={!baseInks.length} onChange={(e) => (e.target.checked ? start(base) : put(null))} />
                              {changeWord(im.method)} from {gName(base.g)}
                            </label>
                            {cur && (
                              <div className="mk-cchg">
                                <span className="mk-cchg-n">Same art and screens as {gName(base.g)}{base.g.lines?.[0]?.color ? ` (${base.g.lines[0].color})` : ""}. Setup is charged once; type each ink as it prints here, blank if that color isn&apos;t printed here.</span>
                                {others.length > 1 && <select aria-label="Which print it changes" value={base.x.id} onChange={(e) => { const b = others.find(({ x }) => x.id === e.target.value); if (b) start(b); }}>{others.map(({ g, x }) => <option key={x.id} value={x.id}>{gName(g)} · {x.inks || x.location}</option>)}</select>}
                                {baseInks.map((nm) => (
                                  <div key={nm} className="mk-cchg-r">
                                    <i style={{ background: colorHex(nm) || "#ccc" }} /><span>{nm}</span><span aria-hidden>→</span>
                                    <input type="text" list="mk-ink-names" aria-label={`${nm} here`} placeholder="not printed here" value={cur.inks[nm] ?? ""} onChange={(e) => put({ ...cur, inks: { ...cur.inks, [nm]: e.target.value } })} />
                                    {cur.inks[nm] && colorHex(cur.inks[nm]) ? <i style={{ background: colorHex(cur.inks[nm])! }} /> : null}
                                  </div>
                                ))}
                                <span className="faint">{n ? `${n} color change${n === 1 ? "" : "s"}: charged as ${n === 1 ? "an ink change" : "ink changes"}` : "No ink changes: the same screens and inks"}{(() => { const extra = myInks.filter((x) => !Object.values(cur.inks).some((v) => v.trim().toLowerCase() === x)).length; return extra ? ` · ${extra} ink${extra === 1 ? "" : "s"} not on ${gName(base.g)}: a new screen` : ""; })()}</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                      {capBody && designOf(im) && im.sizeFrom === "customer" && (() => { const r = ratioIm(im) || 0, m = (im.size || "").match(/^([\d.]+)/), want = m ? (/tall/i.test(im.size) ? (r ? +m[1] / r : +m[1]) : +m[1]) : 0, cap = Math.floor(sideMaxWidth(im.location, r) * 4) / 4; return want > cap + 0.01 ? <div className="mk-cust-size">The customer asked for {im.size}, bigger than fits the {capBody.size} ({cap}&quot; max). Check with them.</div> : null; })()}
                      {capBody && designOf(im) && <div className="mk-capnote">Up to {Math.floor(sideMaxWidth(im.location, ratioIm(im) || 0) * 4) / 4}&quot; wide: the largest that fits the {capBody.size}, the smallest size ordered (one screen prints every size).</div>}
                      {/* the location's actions together on the right (Oct 9, Nick) */}
                      <div className="mk-imp-acts">
                        <button className="btn sm ghost danger" type="button" onClick={() => setImprints((xs) => xs.filter((x) => x.id !== im.id))}>Remove location</button>
                      </div>
                      {p.d && im.method === "screen" && !portal && (() => {
                        // Brand standards (Oct 23, Nick: "a little pop-up at the bottom of the imprints… brand standards… soft
                        // print… apply the distress effect… keep that upper section the same… on all prints"; "fashion hit
                        // and soft hand are really the same thing"): how this customer's prints are made, for this print
                        const soft = im.printStyle === "fashion" || !!im.softHand;
                        const ds = (p.d.specs || {}) as { distressLayer?: boolean; distressed?: boolean };
                        const hasDis = !!ds.distressLayer || !!ds.distressed;
                        const disOn = hasDis && im.distress !== "off";
                        const who = custLabel(customers.find((c) => c.id === customerId)) || "this customer";
                        const set = (ch: Partial<Imprint>) => setImprints((xs) => xs.map((x) => (x.id === im.id ? { ...x, ...ch } : x)));
                        return (
                          <div className={"mk-bs" + (bsOpen ? " on" : "")}>
                            <button type="button" className="mk-bs-h" onClick={() => setBsOpen(!bsOpen)} aria-expanded={bsOpen}>
                              <b>Brand standards</b><span className="mk-bs-who">{brandPrint || brandMask ? who : "none set"}</span>
                              {!bsOpen && (soft || disOn) && <span className="faint">{[soft && "Soft Hand (Fashion)", disOn && "Distress"].filter(Boolean).join(" · ")}</span>}
                              <span className="mk-bs-a" aria-hidden>{bsOpen ? "▾" : "▸"}</span>
                            </button>
                            {bsOpen && <div className="mk-bs-b">
                              <label className="check" title="No underbase: each color printed, flashed and printed again through the same screen, so it feels soft"><input type="checkbox" checked={soft} onChange={(e) => set(e.target.checked ? { printStyle: "fashion", softHand: true, underbase: undefined } : { printStyle: undefined, softHand: undefined })} /> Soft Hand (Fashion)</label>
                              {(hasDis || brandMask) && <>
                                <label className="check"><input type="checkbox" checked={disOn} disabled={distressing === im.id || (hasDis && !urls[p.d.id + ":clean"] && disOn)}
                                  onChange={async (e) => {
                                    if (hasDis) { set({ distress: e.target.checked ? undefined : "off" }); return; }
                                    // not distressed yet: their mask laid over this logo (kept clean underneath, so it can be turned off)
                                    setDistressing(im.id); setMsg("Putting their distress on the logo…");
                                    const { fixDesignArt } = await import("@/lib/artFix");
                                    const r = await fixDesignArt(sb, p.d!.id, ["distress"], { say: ["Added the customer's distressed texture"] });
                                    setDistressing(null);
                                    if (!r.ok) { setMsg(r.error); return; }
                                    set({ distress: undefined }); setMsg("Distress on. Save to keep it on the order."); setArtTick((t) => t + 1);
                                  }} /> {distressing === im.id ? "Putting the distress on…" : "Distress (their mask)"}</label>
                                {brandMask && <div className="mk-bs-mask"><img src={brandMask.url} alt="" /><span className="faint">{brandMask.name} · the shirt shows through · films get {brandMask.layers || 3} layers</span></div>}
                              </>}
                              <p className="faint mk-bs-n">{brandPrint || brandMask ? `Set from ${who}'s brand standards. Change it here for just this print.` : "No brand standards saved for this customer."}</p>
                            </div>}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
              {orderId && <div className="faint" style={{ fontSize: 12 }}>Changes here (locations, designs, sizes, inks) go back to the order when you save.</div>}
            </div>
          </section>
          {/* more than a logo: its own box, apart from the Imprints panel (Oct 9, Nick) */}
          <section className={"panel mk-more-box" + (ready ? "" : " mk-off")} inert={!ready || undefined}>
            <div className="panel-h"><h2>Need more than a logo?</h2></div>
            <div className="panel-b">
              {/* Canva first (Oct 10, Nick: customers design in Canva, "powered by Canva"); our own tools stay below */}
              {showCanva && <div className="mk-canva">
                <button type="button" className="btn primary mk-canva-btn" disabled={!!canvaWait} onClick={() => designInCanva()}>Design with Canva</button>
                <div className="mk-canva-txt">
                  <span>{portal ? (curTab === "sleeve" ? "Templates, fonts, photos and AI on a canvas the size of your sleeve print. Your design comes back onto this shirt." : "Canva opens on this shirt with the print area marked: templates, fonts, photos and AI. Your design comes back onto the shirt where you put it.") : curTab === "sleeve" ? "A Canva design the size of the sleeve print area; Return in Canva puts it on the shirt." : `Canva opens on this shirt with the ${curTab} print area marked; Return in Canva puts the design on it, the size and spot it was drawn.`}</span>
                  <span className="mk-canva-pb">Powered by Canva</span>
                </div>
                {canvaAsk && !canvaWait && <div className="mk-canva-ask">
                  <span>Sign in to your Canva account, or make a free one, to design here.</span>
                  <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn sm primary" onClick={connectCanva}>Continue to Canva</button>
                    {!portal && canva?.isOwner && <a className="btn sm ghost" href="/shop/settings/canva">Or connect the shop&apos;s account</a>}
                    <button type="button" className="btn sm ghost" onClick={() => setCanvaAsk(false)}>Not now</button>
                  </span>
                </div>}
                {canvaWait && <div className="faint" style={{ fontSize: 12.5 }}>{canvaWait.msg} <a href="#" onClick={(e) => { e.preventDefault(); void checkCanva(canvaWait.session); }}>Check again</a>{" · "}<a href="#" onClick={(e) => { e.preventDefault(); setCanvaWait(null); }}>Stop waiting</a></div>}
              </div>}
              {showCanva && <div className="mk-more-or">Or use our simple designer</div>}
              <div className="mk-more-acts">
                <button type="button" className="mk-more-btn" onClick={addText}><b>Add text</b><span>Type words right onto the {curTab === "sleeve" ? "sleeve" : curTab}</span></button>
                <button type="button" className="mk-more-btn" onClick={() => openLab(curTab, undefined, "ideas")}><b>Pick a ready-made design</b><span>School, sports, church, business and more</span></button>
                <button type="button" className="mk-more-btn" onClick={() => openLab(curTab, undefined, "ai")}><b>Create with AI</b><span>Describe it and get print-ready art</span></button>
                <button type="button" className="mk-more-btn" onClick={() => openLab(curTab, undefined, "art")}><b>Open the Design Lab</b><span>Art, fonts, names &amp; numbers, your logos</span></button>
              </div>
            </div>
          </section>
          {/* the Helper at the bottom, under Need more than a logo (Oct 22, Nick) */}
          {!portal && (
            <section className={"panel mk-help" + (helpOpen ? "" : " closed")}
              onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
              onDrop={(e) => { const f = e.dataTransfer.files?.[0]; if (f) { e.preventDefault(); void helperRead(f); } }}>
              <div className="panel-h"><h2>Helper</h2><button type="button" className="lc-link" onClick={() => setHelpOpen(!helpOpen)}>{helpOpen ? "Hide" : "Show"}</button></div>
              {helpOpen && <div className="panel-b">
                {!helper && <>
                  <p className="faint mk-help-t">Art that came already on a mockup (ours, the customer&apos;s, or a design sheet)? I&apos;ll take the art off the shirts, show you what I found, and put it on this mockup.</p>
                  <button type="button" className="btn sm" onClick={() => helpIn.current?.click()}>Pull art from a mockup…</button>
                  <span className="faint mk-help-d">{portal ? "or drop the PDF / AI file here" : "or drop the PDF / AI file (or a picture of the garment) here"}</span>
                </>}
                <datalist id="mk-ink-names">{[...Object.keys(WILFLEX_HEX), ...Object.keys(STOCK_HEX)].slice(0, 400).map((n) => <option key={n} value={n} />)}</datalist>
                <input ref={helpIn} type="file" accept={portal ? ".pdf,.ai,application/pdf,application/postscript,application/illustrator" : ".pdf,.ai,.jpg,.jpeg,.png,.webp,application/pdf,application/postscript,application/illustrator,image/jpeg,image/png,image/webp"} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void helperRead(f); }} />
                {helper && <>
                  <div className="mk-help-f"><b>{helper.name}</b>{!helper.busy && <button type="button" className="lc-link" onClick={() => { helper.rows.forEach((r) => URL.revokeObjectURL(r.url)); setHelper(null); }}>Start over</button>}</div>
                  {helper.busy && <p className="faint mk-help-t">{helper.busy}</p>}
                  {helper.err && <p className="err mk-help-t">{helper.err}</p>}
                  {!helper.busy && helper.rows.length > 0 && <>
                    <p className="mk-help-q">
                      {(() => { const f = helper.rows.filter((r) => r.side === "front").length, b = helper.rows.filter((r) => r.side === "back").length, sl = helper.rows.filter((r) => r.side === "sleeve").length; const say = (n: number, w: string) => (n ? `${n === 1 ? "a" : n} ${w} print${n === 1 ? "" : "s"}` : ""); return `I found ${[say(f, "front"), say(b, "back"), say(sl, "sleeve")].filter(Boolean).join(" and ")}${helper.kind === "drawn" ? " on drawn shirts" : helper.kind === "art" ? " (just the art, no shirt)" : ""}.`; })()}
                      {helper.pms.length > 0 && <> The colors written on it: <b>{helper.pms.join(", ")}</b>.</>}
                      {" "}Check where each goes, its size and inks.
                    </p>
                    {helper.shirtHex && (() => {
                      // the closest color of the style picked, by its swatch (Oct 22, Nick: "add in that shirt color")
                      const l = lines[active] || lines[0], g = l ? garmentFor(l) : null;
                      const near = g ? Object.entries(g.color_images || {}).filter(([, v]) => v?.hex).map(([k, v]) => ({ k, e: deltaE((v.hex!.startsWith("#") ? v.hex! : "#" + v.hex), helper.shirtHex!) })).sort((a, b) => a.e - b.e)[0] : null;
                      return (
                        <div className="mk-help-shirt">
                          <span className="mk-gc-dot" style={{ background: helper.shirtHex }} />
                          <span>The shirt on this mockup{helper.knocked ? `; that color inside the art is taken out (the shirt shows through) on ${helper.knocked === 1 ? "1 print" : `${helper.knocked} prints`}` : ""}.</span>
                          {near ? <button type="button" className="btn sm" title={`The closest ${[g?.brand, g?.style].filter(Boolean).join(" ")} color to it`} onClick={() => setLines((ls) => ls.map((x, j) => (j === (lines[active] ? active : 0) ? { ...x, color: near.k } : x)))}>Use {near.k}</button>
                            : <span className="faint">Pick the style above to use its closest color.</span>}
                        </div>
                      );
                    })()}
                    {/* the garments on the sheet (Oct 27, Nick: "pull art off and then draw blank… you can name it"): read by the
                        AI; Draw this blank puts it on as the garment, drawn in its color, with its print where the sheet says */}
                    {(helper.gBusy || (helper.garments || []).length > 0 || helper.gErr) && (
                      <div className="mk-help-gar">
                        <div className="mk-help-gar-h"><b>The garments on this sheet</b>{helper.gBusy && <span className="faint"> · reading them…</span>}</div>
                        {helper.gErr && <p className="faint">{helper.gErr}</p>}
                        {(helper.garments || []).map((g, gi) => {
                          const gd = helper.gDraw?.[gi];
                          const look: GarmentLook = { kind: g.kind as StockKind, hex: g.hex, ...(g.trim ? { trim: g.trim } : {}), heather: g.heather, ...(g.stripes ? { stripes: g.stripes } : {}), quilted: g.quilted, from: helper.name, ...(gd?.draw ? { draw: gd.draw } : {}) };
                          const sizes = Object.entries(g.sizes || {}), pcs = sizes.reduce((a, [, n]) => a + n, 0);
                          const setName = (name: string) => setHelper((h) => h && { ...h, garments: (h.garments || []).map((x, i) => (i === gi ? { ...x, name } : x)) });
                          const draw = () => {
                            // the line being shown (or the first empty one) becomes this garment, drawn; a second garment is a new line
                            const cur = lines[active] || lines[0];
                            const free = !cur || !(cur.style || "").trim() || !garmentFor(cur);
                            const nl: Line = { id: free && cur ? cur.id : uid(), style: g.name, brand: g.brand || "", garment: "", color: g.color, look };
                            setLines((ls) => (free && cur ? ls.map((x) => (x.id === cur.id ? { ...x, ...nl } : x)) : [...ls, nl]));
                            gLine.current[`${helper.name}|${gi}`] = nl.id;
                            // drawn to match their photo (any cut, buttons, snaps): the stock drawing until it's back
                            if (!gd?.draw && !gd?.busy && helper.pic) void helperDraw(helper.name, gi, g, helper.pic);
                            // its print where the sheet says, on the art pulled off (one print and one piece of art)
                            const pr = g.prints || [], use = helper.rows.filter((r) => r.use);
                            if (pr.length === 1 && use.length === 1) {
                              const want = fitLocation(pr[0].location, [{ style: g.name, garment: STOCK_LABEL[look.kind || "tee"] }]);
                              const side: HelpRow["side"] = sideOf(want) === "sleeve" ? "sleeve" : sideOf(want) === "back" ? "back" : "front";
                              const w = pr[0].width_in && pr[0].width_in > 0 ? pr[0].width_in : use[0].widthIn;
                              helpSet(use[0].key, { side, location: want, widthIn: w, heightIn: Math.round((use[0].heightIn / (use[0].widthIn || 1)) * w * 100) / 100 });
                            }
                            setMsg(`${g.name} in ${g.color}: drawn, since it isn't in a catalog${gd?.draw ? "" : "; drawing it to match their photo now"}. Check the color and the print, then Put on.`);
                          };
                          return (
                            <div key={gi} className="mk-help-gr">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={stockSvg(look.kind || "tee", "front", look)} alt="" />
                              <div className="mk-help-gb">
                                <input aria-label="Garment name" value={g.name} onChange={(e) => setName(e.target.value)} />
                                <span className="faint"><i className="mk-gc-dot" style={{ background: g.hex }} /> {g.color} · drawn {STOCK_LABEL[look.kind || "tee"].toLowerCase()}{g.trim ? " · trim " : ""}{g.trim && <i className="mk-gc-dot" style={{ background: g.trim }} />}{g.heather ? " · heather" : ""}{g.stripes ? " · stripes" : ""}{g.quilted ? " · quilted" : ""}</span>
                                {pcs > 0 && <span className="faint">{sizes.map(([z, n]) => `${z} ${n}`).join(" · ")} = {pcs}</span>}
                                {(g.prints || []).map((p, i) => <span key={i} className="faint">{p.location} · {p.method === "screen" ? "screen print" : p.method}{p.width_in ? ` · ${p.width_in}" wide` : ""}{p.ink ? ` · ${p.ink}` : ""}</span>)}
                                {gd?.busy && <span className="faint">Drawing it to match their photo… (about a minute)</span>}
                                {gd?.draw && <span className="faint">Drawn to match their photo{gd.what ? `: ${gd.what}` : ""}</span>}
                                {gd?.err && <span className="faint">{gd.err} <button type="button" className="lc-link" onClick={() => helper.pic && void helperDraw(helper.name, gi, g, helper.pic)}>Try again</button></span>}
                              </div>
                              <button type="button" className="btn sm" onClick={draw}>Draw this blank</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {(helper.notes || []).length > 0 && <p className="faint mk-help-t">The proof says: {helper.notes!.map((n) => `${n.where}${n.w ? ` ${n.w}" × ${n.h}"` : ""}${n.colors.length ? ` (${n.colors.join(", ")})` : ""}`).join("; ")}.</p>}
                    {/* the customer we know (Oct 22, Nick: "hey, I learned about Peticolas already… strip the mask out. Do you
                        want me to apply the mask to this mockup?") */}
                    {brandMask && helper.rows.some((r) => r.mask) && (
                      <div className="mk-help-know">
                        <p>I know {custLabel(customers.find((c) => c.id === customerId)) || "this customer"}: their distress mask was on this art. I took it off and kept the art underneath. Put their mask back on this mockup?</p>
                        <div className="row" style={{ gap: 6 }}>
                          <button type="button" className={"btn sm" + (helper.rows.filter((r) => r.mask).every((r) => r.distress === "brand") ? " primary" : "")} onClick={() => helper.rows.filter((r) => r.mask).forEach((r) => void helpDistress(r, "brand"))}>Yes, their mask</button>
                          <button type="button" className={"btn sm" + (helper.rows.filter((r) => r.mask).every((r) => r.distress === "none") ? " primary" : "")} onClick={() => helper.rows.filter((r) => r.mask).forEach((r) => void helpDistress(r, "none"))}>No, keep it clean</button>
                        </div>
                      </div>
                    )}
                    {!brandMask && helper.rows.some((r) => r.mask) && <p className="faint mk-help-t">There&apos;s a distress texture over this art. I took it off; it&apos;s on each print below (Distress). Save it as their mask and it goes on every logo of theirs.</p>}
                    {helper.rows.map((r) => (
                      <div key={r.key} className={"mk-help-r" + (r.use ? "" : " off")}>
                        <label className="mk-help-use"><input type="checkbox" checked={r.use} onChange={(e) => helpSet(r.key, { use: e.target.checked })} /></label>
                        {/* on the mockup's shirt color when there is one: the distress shows as that color through the ink */}
                        <div className={"mk-help-pic" + (r.light ? " dark" : "")} style={(lines[active] || lines[0])?.color ? { background: shirtHex(lines[active] || lines[0]) } : undefined}><img src={r.durl || r.url} alt={`${r.side} art`} /></div>
                        <div className="mk-help-b">
                          <div className="row" style={{ gap: 6 }}>
                            <select aria-label="Side" value={r.side} onChange={(e) => { const side = e.target.value as HelpRow["side"]; helpSet(r.key, { side, location: side === "sleeve" ? (locsFor("sleeve").includes(r.location) ? r.location : locsFor("sleeve")[0] || "Left Sleeve") : locOfPulled(side, r.widthIn, r.dropIn, 0) }); }}><option value="front">Front</option><option value="back">Back</option><option value="sleeve">Sleeve</option></select>
                            <select aria-label="Location" value={r.location} onChange={(e) => helpSet(r.key, { location: e.target.value })}>{[...new Set([...locsFor(r.side), r.location])].map((l) => <option key={l}>{l}</option>)}</select>
                          </div>
                          <label className="mk-help-w"><input type="number" min="0.5" step="0.25" value={r.widthIn} onChange={(e) => { const w = Math.max(0.25, +e.target.value || 0); helpSet(r.key, { widthIn: w, heightIn: Math.round((r.heightIn / (r.widthIn || 1)) * w * 100) / 100 }); }} />&quot; wide <span className="faint">× {r.heightIn}&quot;</span></label>
                          {(r.mask || brandMask) && <div className="mk-help-ds">
                            <span className="faint">Distress</span>
                            <select aria-label="Distress" value={r.distress} onChange={(e) => void helpDistress(r, e.target.value as HelpRow["distress"])}>
                              <option value="none">None (clean)</option>
                              {brandMask && <option value="brand">Their mask (brand standards)</option>}
                              {r.mask && <option value="file">The texture in this file{r.maskPpi && r.maskPpi < 100 ? ` (low-res, ${r.maskPpi} ppi)` : ""}</option>}
                            </select>
                            {r.mask && !brandMask && customerId && <button type="button" className="lc-link" title="Saved in their brand standards: laid over every logo of theirs from now on" onClick={() => void saveBrandMask(r)}>Save as their mask</button>}
                          </div>}
                          <div className="mk-help-inks">{helper.inkOpts.map((n) => { const on = r.inks.includes(n); return <button key={n} type="button" className={"chip" + (on ? " on" : "")} onClick={() => helpSet(r.key, { inks: on ? r.inks.filter((x) => x !== n) : [...r.inks, n] })}><i style={{ background: colorHex(n) || "#ccc" }} />{n}</button>; })}</div>
                        </div>
                      </div>
                    ))}
                    {orderId && helper.file && <label className="check mk-help-keep"><input type="checkbox" checked={!!helper.keepFile} onChange={(e) => setHelper((h) => h && { ...h, keepFile: e.target.checked })} />Include the customer&apos;s original mockup ({helper.name}) as a production file</label>}
                    <div className="row" style={{ gap: 8 }}>
                      <button type="button" className="btn primary sm" disabled={!customerId || !helper.rows.some((r) => r.use)} title={customerId ? undefined : "Pick the customer first"} onClick={() => void helperApply()}>Put on the mockup</button>
                      <span className="faint mk-help-d">{helper.kind === "drawn" ? "Sizes are read off a drawn shirt: close, not exact." : "Placed centered in each print area, like every print."}</span>
                    </div>
                  </>}
                </>}
              </div>}
            </section>
          )}
        </div>
      </div>
    </BrandCtx.Provider>
  );
}

/** One garment photo with designs you can drag, resize from the corner (proportions locked) and double-click to recolor. */
/** The how-to tip shows the first time someone hovers a logo, then never again (remembered in this browser when it can be). */
let tipSeen = false;
const tipWasSeen = () => { if (tipSeen) return true; try { tipSeen = localStorage.getItem("mk-tip-seen") === "1"; } catch { /* private window */ } return tipSeen; };
const markTipSeen = () => { tipSeen = true; try { localStorage.setItem("mk-tip-seen", "1"); } catch { /* private window */ } };

function Stage({ src, label, items, grid, mask, cx, corner, overlay, norm, onMove, onResize, onEnd, onPick, onSelect, areaEdit, onArea, areaNote, neckLine }: {
  /** the bottom of the sewn neckline on this photo (shown with the print areas; drag it to fix it, saved for this photo) */
  neckLine?: { y: number; tag: string; onSet: (y: number) => void };
  /** the dashed print areas can be dragged (moves this style's prints) and resized from the corner */ areaEdit?: boolean;
  onArea?: (dx: number, dy: number, kMul: number) => void; areaNote?: ReactNode;
  /** drawn over the photo (the measured view) */ overlay?: ReactNode;
  /** zoom and shift that make this photo's shirt fill the frame like the reference tee (normOf) */ norm?: { z: number; tx: number; ty: number };
  src: string; label: string; /** the shirt's center on this photo, so the label sits under the shirt */ cx?: number; corner?: ReactNode; onEnd?: (id: string) => void; grid?: boolean; /** shirt-shaped mask: art never shows past the edge of the shirt */ mask?: string;
  items: { id: string; p: { x: number; y: number; w: number; h: number; rot: number; clip?: "" | "left" | "right"; area: { x: number; y: number; w: number; h: number } }; url: string; /** can't be dragged or sized (a visual-only reorder until "Adjust") */ locked?: boolean }[];
  onMove: (id: string, dx: number, dy: number) => void;
  onResize: (id: string, newW: number) => void;
  onPick: (id: string, relX: number, relY: number, clientX: number, clientY: number) => void;
  /** a logo was clicked: the Imprints panel shows it */ onSelect?: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; sx: number; sy: number; mode: "move" | "size" | "area" | "areaSize" | "neck"; w: number; el?: HTMLElement } | null>(null);
  const [neckDy, setNeckDy] = useState(0);
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
  const z = norm?.z || 1;
  const k = () => (box.current ? box.current.clientWidth / PHOTO_W : 0.42) * z;
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
          if (d.mode === "neck") { setNeckDy((e.clientY - d.sy) / f); return; }
          if (d.mode === "area") { onArea?.((e.clientX - d.x) / f, (e.clientY - d.y) / f, 1); drag.current = { ...d, x: e.clientX, y: e.clientY }; return; }
          if (d.mode === "areaSize") { const dw = (e.clientX - d.x) / f; if (d.w + dw > 40) { onArea?.(0, 0, (d.w + dw) / d.w); d.w += dw; } drag.current = { ...d, x: e.clientX, y: e.clientY }; return; }
          if (d.mode === "move") onMove(d.id, (e.clientX - d.x) / f, (e.clientY - d.y) / f);
          else { const dw = (e.clientX - d.x) / f; if (d.w + dw > 12) { onResize(d.id, d.w + dw); d.w += dw; } }
          drag.current = { ...d, x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          pts.current.delete(e.pointerId);
          const pz = pinch.current;
          if (pz) { if (pts.current.size < 2) { pinch.current = null; drag.current = null; onEnd?.(pz.id); } return; }
          const d = drag.current; drag.current = null;
          if (d?.mode === "neck") { const dy = (e.clientY - d.sy) / k(); setNeckDy(0); if (neckLine && Math.abs(dy) > 0.5) neckLine.onSet(Math.round(neckLine.y + dy)); return; }
          // only after a real drag: a plain click never changes the location
          if (d && onEnd && !d.mode.startsWith("area") && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) onEnd(d.id);
        }}
        onPointerCancel={(e) => { pts.current.delete(e.pointerId); if (pinch.current && pts.current.size < 2) { const id = pinch.current.id; pinch.current = null; onEnd?.(id); } drag.current = null; }}
        onPointerLeave={(e) => { if (e.pointerType === "touch") return; const d = drag.current; drag.current = null; if (d && onEnd && !d.mode.startsWith("area") && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) onEnd(d.id); }}
        onPointerDown={(e) => { if (pts.current.size > 1) return; if (e.target === box.current || (e.target as HTMLElement).classList.contains("mk-bg") || (e.target as HTMLElement).classList.contains("mk-norm")) setSel(""); }}>
        <div className="mk-norm" style={norm && (norm.z !== 1 || norm.tx || norm.ty) ? { transform: `translate(${(norm.tx / PHOTO_W) * 100}%, ${(norm.ty / PHOTO_H) * 100}%) scale(${norm.z})` } : undefined}>
        <img src={src} alt="" draggable={false} className="mk-bg" />
        {grid && items.map((it) => <div key={"a" + it.id} className={"mk-area" + (areaEdit && !it.p.clip ? " edit" : "")} style={{ left: `${it.p.area.x * s}%`, top: `${it.p.area.y * sy}%`, width: `${it.p.area.w * s}%`, height: `${it.p.area.h * sy}%`, transform: it.p.rot ? `rotate(${it.p.rot}deg)` : undefined }}
          title={areaEdit && !it.p.clip ? "Drag to line the print area up on this shirt (saved for this style). Drag the corner to size it." : undefined}
          onPointerDown={areaEdit && !it.p.clip ? (e) => { if ((e.target as HTMLElement).closest(".mk-art")) return; e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { id: "area", x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: "area", w: 0 }; } : undefined}>
          {areaEdit && !it.p.clip && <span className="mk-area-h" onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { id: "area", x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: "areaSize", w: it.p.area.w }; }} />}
        </div>)}
        {grid && neckLine && (
          <div className="mk-neck" style={{ top: `${(neckLine.y + neckDy) * sy}%` }} title="The bottom of the sewn neckline: every drop is measured from here. Drag it onto the seam if it's off (saved for this photo)."
            onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { id: "neck", x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: "neck", w: 0 }; }}>
            <span>Neckline · {neckLine.tag}</span>
          </div>
        )}
        {/* the art itself, cut to the shirt outline */}
        <div className="mk-artlayer" style={mask ? { maskImage: `url(${mask})`, WebkitMaskImage: `url(${mask})` } : undefined}>
          {items.map((it) => it.url ? (
            <div key={"v" + it.id} className="mk-artv" style={{ left: `${it.p.x * s}%`, top: `${it.p.y * sy}%`, width: `${it.p.w * s}%`, height: `${it.p.h * sy}%`, transform: it.p.rot ? `rotate(${it.p.rot}deg)` : undefined, clipPath: it.p.clip === "left" ? "inset(0 50% 0 0)" : it.p.clip === "right" ? "inset(0 0 0 50%)" : undefined }}>
              <img src={it.url} alt="" draggable={false} />
            </div>
          ) : null)}
        </div>
        {overlay}
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
              onSelect?.(it.id);
              if (it.locked) return;
              // double-click (two quick clicks in the same spot) opens the color menu for the color under the cursor
              const now = Date.now(), last = lastDown.current;
              lastDown.current = { t: now, x: e.clientX, y: e.clientY, id: it.id };
              if (last && last.id === it.id && now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8) {
                const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect();
                const cx = r.left + r.width / 2, cy = r.top + r.height / 2, a = (-(it.p.rot || 0) * Math.PI) / 180;
                const vx = (e.clientX - cx) / z, vy = (e.clientY - cy) / z; // screen px back to the element's own (the photo may be zoomed)
                const ux = vx * Math.cos(a) - vy * Math.sin(a), uy = vx * Math.sin(a) + vy * Math.cos(a);
                onPick(it.id, ux / el.offsetWidth + 0.5, uy / el.offsetHeight + 0.5, e.clientX, e.clientY);
                lastDown.current = null;
                return;
              }
              // phones: the first tap only picks the logo (a swipe across it still scrolls the page); once picked, drag to move
              if (e.pointerType === "touch" && sel !== it.id) { lastDown.current = null; setSel(it.id); return; }
              setSel(it.id);
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              // grabbing the bottom-right corner resizes right away (no need to select first)
              const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect();
              const a = (-(it.p.rot || 0) * Math.PI) / 180, vx = (e.clientX - (r.left + r.width / 2)) / z, vy = (e.clientY - (r.top + r.height / 2)) / z;
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
        </div>
        {corner}
      </div>
      <div className="mk-label" style={cx ? { transform: `translateX(${((cx / PHOTO_W) - 0.5) * 100}%)` } : undefined}>{label}</div>
      {areaNote}
    </div>
  );
}

/** Pick the ink a logo color prints as: a Wilflex RFU color, a PMS color, a custom PMS, or drop it. */
/**
 * A typed ink: a stock ink or brand ink by name ("royal" → Royal), or any Pantone from the full coated chart by number
 * ("241", "pms 241", "Pantone 241 C" → PMS 241 C). Null when it isn't one we know (then it's kept as typed, with a picked color).
 */
function resolveInk(text: string, brand: Brand): { name: string; hex: string } | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return null;
  const lc = t.toLowerCase().replace(/^wilflex\s+/, "");
  for (const g of brand.groups) for (const b of g.colors) if (b.ink.toLowerCase() === lc || b.name.toLowerCase() === lc) return { name: b.ink, hex: b.hex || colorHex(b.ink) || "#888888" };
  const named = [...Object.keys(WILFLEX_HEX), ...Object.keys(STOCK_HEX), ...Object.keys(PMS_HEX)].find((n) => n.toLowerCase() === lc);
  if (named) return { name: named, hex: colorHex(named) };
  const num = t.replace(/^(pms|pantone)\s*/i, "").replace(/\s*c$/i, "").trim();
  if (!num) return null;
  const key = `PMS ${num.replace(/\b[a-z]/g, (c) => c.toUpperCase())} C`;
  return PMS_COATED[key] ? { name: key, hex: PMS_COATED[key] } : null;
}
let inkNamesCache: string[] | null = null;
const allInkNames = () => (inkNamesCache ||= [...Object.keys(WILFLEX_HEX), ...Object.keys(STOCK_HEX), ...Object.keys(PMS_HEX), ...Object.keys(PMS_COATED).filter((k) => !PMS_HEX[k])]);

/**
 * The ink a logo color prints as, in ONE field (Oct 24, Nick: "I don't like how this double drop down arrow thing
 * happens… you click it and then it drops down… then it goes to standard colors… rethink how we do that"): type to find
 * (a stock ink, a brand ink, any Pantone by number: "241" → PMS 241 C) or open the list with the one ▾. Each ink shows
 * its swatch. "Keep as uploaded" and "Remove" sit at the top of the list.
 */
type InkOpt = { name: string; hex: string; sub?: string; act?: "keep" | "none" | "typed" };
function InkSelect({ value, onChange }: { value?: { name: string; hex: string }; onChange: (v: { name: string; hex: string } | null) => void }) {
  const brand = useContext(BrandCtx);
  const box = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const inp = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null); // what's being typed (null = show the picked ink)
  const [active, setActive] = useState(0);
  const [at, setAt] = useState<{ left: number; width: number; top?: number; bottom?: number; max: number } | null>(null);
  const shown = value?.name === "none" ? "Remove (shirt shows through)" : value?.name || "";
  const q = (text ?? "").trim().toLowerCase().replace(/^pantone\s*/, "pms ").replace(/\s+/g, " ");
  const hit = text && text.trim() ? resolveInk(text, brand) : null;
  const groups = useMemo(() => {
    const has = (n: string, sub = "") => !q || n.toLowerCase().includes(q) || sub.toLowerCase().includes(q) || n.toLowerCase().replace(/^pms /, "").startsWith(q.replace(/^pms ?/, ""));
    const out: { label: string; opts: InkOpt[] }[] = [];
    const seen = new Set<string>();
    const add = (label: string, opts: InkOpt[]) => { const o = opts.filter((x) => !seen.has(x.name) && has(x.name, x.sub)); o.forEach((x) => seen.add(x.name)); if (o.length) out.push({ label, opts: o }); };
    if (hit) { out.push({ label: "", opts: [hit] }); seen.add(hit.name); }
    if (!q) out.push({ label: "", opts: [{ name: "Keep as uploaded", hex: "", act: "keep" }, { name: "Remove (shirt shows through)", hex: "", act: "none" }] });
    for (const g of brand.groups) if (g.colors.length) add(g.label, g.colors.map((b) => ({ name: b.ink, hex: b.hex || colorHex(b.ink) || "#888888", sub: b.name !== b.ink ? b.name : undefined })));
    add("Our stock inks (Wilflex RFU)", Object.keys(WILFLEX_HEX).map((k) => ({ name: k, hex: colorHex(k) })));
    add("Our other stock inks (Ink Room)", Object.keys(STOCK_HEX).map((k) => ({ name: k, hex: colorHex(k) })));
    add("Common PMS", Object.keys(PMS_HEX).map((k) => ({ name: k, hex: colorHex(k) })));
    if (q) {
      const chart = Object.keys(PMS_COATED).filter((k) => !seen.has(k) && has(k)).slice(0, 40).map((k) => ({ name: k, hex: PMS_COATED[k] }));
      if (chart.length) { out.push({ label: "Pantone chart", opts: chart }); chart.forEach((x) => seen.add(x.name)); }
      if (!hit && text!.trim()) out.push({ label: "", opts: [{ name: text!.trim(), hex: value?.hex || "#888888", act: "typed" }] });
    }
    return out;
  }, [q, brand, hit, text, value?.hex]);
  const flat = groups.flatMap((g) => g.opts);
  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8, up = below < 240 && above > below;
    setAt({ left: r.left, width: Math.max(r.width, 260), max: Math.min(340, up ? above : below), ...(up ? { bottom: window.innerHeight - r.top + 2 } : { top: r.bottom + 2 }) });
  };
  const show = () => { place(); setOpen(true); const i = flat.findIndex((o) => o.name === value?.name); setActive(Math.max(0, i)); };
  const close = () => { setOpen(false); setText(null); };
  const choose = (o: InkOpt) => {
    if (o.act === "keep") onChange(null);
    else if (o.act === "none") onChange({ name: "none", hex: "" });
    else onChange({ name: o.name, hex: o.hex });
    close(); inp.current?.blur();
  };
  // the list follows the field; a scroll elsewhere closes it
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (menu.current?.contains(e.target as Node)) return; if (e.type === "scroll") close(); else if (!box.current?.contains(e.target as Node)) close(); };
    window.addEventListener("scroll", off, true); window.addEventListener("resize", close); document.addEventListener("pointerdown", off);
    return () => { window.removeEventListener("scroll", off, true); window.removeEventListener("resize", close); document.removeEventListener("pointerdown", off); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // not on any chart (typed as the customer wrote it): pick the color to show
  const offChart = !!value && value.name !== "none" && !!value.name && !resolveInk(value.name, brand);
  let n = -1;
  return (
    <span className="ink-dd" ref={box}>
      <input ref={inp} type="text" aria-label="Ink color" role="combobox" aria-expanded={open} autoComplete="off" spellCheck={false}
        placeholder="Keep as uploaded" value={text ?? shown}
        onFocus={(e) => { e.currentTarget.select(); show(); }}
        onClick={() => { if (!open) show(); }}
        onChange={(e) => { setText(e.target.value); setActive(0); if (!open) show(); }}
        onBlur={() => { if (hit && text) onChange(hit); setTimeout(close, 120); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); if (!open) show(); else setActive((a) => Math.min(flat.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); if (open && flat[active]) choose(flat[active]); }
          else if (e.key === "Escape") { close(); e.currentTarget.blur(); }
        }} />
      <button type="button" className="ink-dd-car" tabIndex={-1} aria-label="Show the inks" onMouseDown={(e) => { e.preventDefault(); if (open) close(); else inp.current?.focus(); }}>
        <svg viewBox="0 0 12 12" aria-hidden><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
      </button>
      {offChart && <input type="color" className="ink-dd-hex" aria-label="Screen color" title="Not on the Pantone chart: pick the color to show" value={value!.hex || "#888888"} onChange={(e) => onChange({ name: value!.name, hex: e.target.value })} />}
      {open && at && typeof document !== "undefined" && createPortal(
        <div ref={menu} className="ink-menu" role="listbox" style={{ left: at.left, width: at.width, top: at.top, bottom: at.bottom, maxHeight: at.max }}>
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.label && <div className="ink-menu-g">{g.label}</div>}
              {g.opts.map((o) => {
                const i = ++n, cur = o.act === "keep" ? !value : o.act === "none" ? value?.name === "none" : value?.name === o.name;
                return (
                  <div key={(o.act || "") + o.name} role="option" aria-selected={cur} className={"sm-item" + (i === active ? " on" : "") + (cur ? " cur" : "")}
                    ref={i === active ? (el) => { el?.scrollIntoView({ block: "nearest" }); } : undefined}
                    onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setActive(i)}>
                    <i className={o.act === "keep" || o.act === "none" ? "x " + o.act : ""} style={o.hex ? { background: o.hex } : undefined} />
                    <b data-notranslate={o.act ? undefined : true}>{o.act === "typed" ? `Use “${o.name}” (not on the chart)` : o.name}</b>
                    {o.sub ? <span data-notranslate>{o.sub}</span> : <span />}
                  </div>
                );
              })}
            </div>
          ))}
          {!flat.length && <div className="ink-menu-g">No ink by that name</div>}
        </div>, document.body)}
    </span>
  );
}

/** Close-up of one print location: a patch of shirt color with the whole logo to drag and size (the photos show how it sits on the shirt). */
function CloseUp({ size, title, hex, url, wIn, hIn, maxW, maxH, fold, arm, topAlign, offIn, colors, onMove, onResize, onEnd, onPick, onEyedrop, picked, onResetHex }: {
  /** pick the shirt's color off the photo (Oct 24, Nick: "an eyedropper to select the color in the shirt") */ onEyedrop?: () => void; picked?: boolean; onResetHex?: () => void;
  size: number; topAlign?: boolean; title: string; hex: string; url: string; wIn: number; hIn: number; maxW: number; maxH: number; fold: boolean; offIn: { x: number; y: number };
  /** a long sleeve's spot: "upper" (the shoulder seam above, the art centered) or "cuff" (the cuff hemline below) */ arm?: "upper" | "cuff";
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
  // same spot as on the photos: top of the area for full front/back, a sleeve ¼" above the hemline, else centered
  const cy = (topAlign ? top0 + (hIn * PX) / 2 : fold && arm !== "upper" ? top0 + maxH * PX - Math.min(maxH, hIn + SLEEVE_HEM_GAP) * PX + (hIn * PX) / 2 : H / 2) + offIn.y * PX;
  return (
    <div className="mk-sleeve" style={{ width: BOX }}>
      <div className="mk-cu-h"><span className="lbl">{title.toUpperCase()}</span><span className="mk-cu-max">max {maxW}&quot; × {maxH}&quot;</span>
        {onEyedrop && <span className="mk-cu-eye">
          <button type="button" className="mk-cu-eyeb" title="Shirt color wrong? Click, then click the shirt to pick its color" aria-label="Pick the shirt color" onClick={onEyedrop}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m2 22 1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z" /></svg>
            <span className="sw" style={{ background: hex }} />
          </button>
          {picked && onResetHex && <button type="button" className="mk-cu-eyer" title="Back to the color from the photo" aria-label="Reset the shirt color" onClick={onResetHex}>↺</button>}
        </span>}
      </div>
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
        {fold && arm !== "upper" && <div className="mk-hem" style={{ top: top0 + maxH * PX, left: 0, right: 0 }}><span>{arm === "cuff" ? "CUFF HEMLINE" : "HEMLINE"}</span></div>}
        {fold && arm === "upper" && <div className="mk-hem mk-seam" style={{ top: Math.max(0, top0 - 0.5 * PX), left: 0, right: 0 }}><span>SHOULDER SEAM</span></div>}
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
            // phones: tap to pick it first, then drag (a swipe across an unpicked logo scrolls the page)
            if (e.pointerType === "touch" && !sel) { lastDown.current = null; setSel(true); return; }
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
/** The customer's brand standard sets: pick one and each color in the logo becomes the closest ink in it. */
function BrandPick({ groups, onPick, onClose, modal = false }: { groups: { label: string; colors: BrandInk[]; go: () => void }[]; onPick: (g: { go: () => void }) => void; onClose: () => void; modal?: boolean }) {
  return (
    <div className={"bs-pop" + (modal ? " modal" : "")} role="dialog" aria-label="Apply brand standards">
      <div className="bs-h">{modal ? "This customer has brand standards" : "Apply brand standards"}</div>
      {modal && <div className="bs-sub">Apply a set to this logo? Each color in it becomes the closest ink in the set.</div>}
      {groups.map((g) => (
        <button key={g.label} type="button" className="bs-opt" onClick={() => onPick(g)}>
          <b>{g.label}</b>
          <small>{g.colors.map((c) => (c.name && c.name !== c.ink ? `${c.name} ${c.ink.replace(/^PMS\s+/, "")}` : c.ink)).join(" · ")}</small>
          <span className="bs-sws">{g.colors.map((c, i) => <span key={i} className="sw" style={{ background: c.hex || "transparent" }} title={c.ink} />)}</span>
        </button>
      ))}
      <div className="bs-note">{modal ? <button type="button" className="btn sm ghost" onClick={onClose}>Not now</button> : null}<span>Edit sets on the customer&apos;s Artwork tab.</span></div>
    </div>
  );
}

/** "How it prints" counting only the inks still printing (a color set to Removed drops out of the count) */
const printWhy = (plan: { method: string; why: string }, printing: number) =>
  plan.method === "spot" && /^Screen print, \d+ solid colors?\.$/.test(plan.why) && printing > 0 ? `Screen print, ${printing} solid color${printing === 1 ? "" : "s"}.` : plan.why;

function LogoColors({ rows, onPick, onHover, onSplit, onCombine, onMatchAll, brandGroups = [], distress }: {
  /** the logo's distress layer (Oct 16, Nick: "set that to distress instead of color… it would knock out"): on = the
   *  shirt shows through it; off = printed clean (when there's a clean picture) */
  distress?: { on: boolean; canOff: boolean; set: (on: boolean) => void };
  rows: { hexes: string[]; cur?: Ink; tones?: number[] }[];
  onPick: (hexes: string[], v: { name: string; hex: string } | null) => void;
  /** Combine colors (Oct 20, Nick): several logo colors print from one screen: one ink, or one ink solid and the
   *  other color as a halftone of it */
  onCombine?: (picks: Record<string, Ink>) => void;
  onHover: (hexes: string[], v: { name: string; hex: string } | null) => void;
  onSplit: () => void;
  onMatchAll?: () => void;
  brandGroups?: { label: string; colors: BrandInk[]; go: () => void }[];
}) {
  const [open] = useState(""); // (colors don't fold any more)
  const [bsOpen, setBsOpen] = useState(false);
  const key = (r: { hexes: string[] }) => r.hexes.join();
  const pick = (r: { hexes: string[] }, v: { name: string; hex: string } | null) => { onPick(r.hexes, v); };
  const compactRows = rows.filter((r) => r.cur?.name !== "none").length > 4;
  // Combine colors: pick the colors, then how they print from one screen
  const [comb, setComb] = useState<null | { sel: string[]; how: "solid" | "tone"; ink: string; tone: number }>(null);
  const live = rows.filter((r) => r.cur?.name !== "none");
  const inkOf = (r: { hexes: string[]; cur?: Ink }): Ink => (r.cur && r.cur.name !== "none" ? { name: r.cur.name, hex: r.cur.tone ? colorHex(r.cur.name) || r.cur.hex : r.cur.hex } : closestInk(r.hexes[0]));
  const doCombine = () => {
    if (!comb || !onCombine) return;
    const sel = live.filter((r) => comb.sel.includes(key(r)));
    const base = sel.find((r) => key(r) === comb.ink) || sel[0];
    if (!base || sel.length < 2) return;
    const ink = inkOf(base), picks: Record<string, Ink> = {};
    for (const r of sel) for (const h of r.hexes) picks[h] = comb.how === "tone" && r !== base ? { name: ink.name, hex: toneHex(ink.hex, comb.tone), tone: comb.tone } : { name: ink.name, hex: ink.hex };
    onCombine(picks); setComb(null);
  };
  if (comb) {
    const sel = live.filter((r) => comb.sel.includes(key(r)));
    const base = sel.find((r) => key(r) === comb.ink) || sel[0];
    const other = sel.find((r) => r !== base);
    return (
      <div className="mk-colors mk-comb">
        <div className="lbl">COMBINE COLORS · pick the ones that print from one screen</div>
        {live.map((r) => {
          const k = key(r), on = comb.sel.includes(k);
          return (
            <label key={k} className={"mk-color tight mk-comb-r" + (on ? " on" : "")}>
              <input type="checkbox" checked={on} onChange={() => setComb((c) => (c ? { ...c, sel: on ? c.sel.filter((x) => x !== k) : [...c.sel, k], ink: c.ink && (on ? c.ink !== k : true) ? c.ink : k } : c))} />
              <span className="mk-srcs">{r.hexes.map((h) => <span key={h} className="sw" style={{ background: h }} />)}</span><span className="arrow">→</span>
              <span className="sw" style={{ background: r.cur ? r.cur.hex : r.hexes[0] }} />
              <span className="mk-cname">{r.cur ? r.cur.name : `As uploaded (${closestInk(r.hexes[0]).name}?)`}</span>
            </label>
          );
        })}
        {sel.length >= 2 && (
          <div className="mk-comb-how">
            <label className="check"><input type="radio" name="combhow" checked={comb.how === "solid"} onChange={() => setComb({ ...comb, how: "solid" })} /> Print them all as one ink:</label>
            <label className="check"><input type="radio" name="combhow" checked={comb.how === "tone"} disabled={sel.length !== 2} onChange={() => setComb({ ...comb, how: "tone" })} /> One ink solid, the other as a halftone of it{sel.length !== 2 ? " (pick 2 colors)" : ""}</label>
            <div className="mk-comb-ink">
              <span className="faint">{comb.how === "tone" ? "Solid ink:" : "The ink:"}</span>
              <select value={base ? key(base) : ""} onChange={(e) => setComb({ ...comb, ink: e.target.value })} aria-label="Which ink">
                {sel.map((r) => <option key={key(r)} value={key(r)}>{inkOf(r).name}</option>)}
              </select>
              {comb.how === "tone" && other && base && <span className="faint">{inkOf(other).name === inkOf(base).name ? "the other" : inkOf(other).name} prints as a <input type="number" min={5} max={95} step={5} value={comb.tone} onChange={(e) => setComb({ ...comb, tone: Math.max(5, Math.min(95, +e.target.value || 50)) })} aria-label="Halftone percent" />% halftone of {inkOf(base).name}</span>}
            </div>
            <p className="faint mk-comb-n">{sel.length} colors → 1 screen{comb.how === "tone" ? ", the halftone shown lighter" : ""}. Split them again any time.</p>
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
          <button type="button" className="btn sm ghost" onClick={() => setComb(null)}>Cancel</button>
          <button type="button" className="btn sm primary" disabled={sel.length < 2} onClick={doCombine}>Combine {sel.length >= 2 ? `${sel.length} colors` : ""}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="mk-colors">
      <div className="lbl mk-colors-h">COLORS IN THIS LOGO{onCombine && live.length >= 2 && <button type="button" className="lc-link" title="Print two or more of these colors from one screen: as one ink, or one solid and the other as a halftone of it" onClick={() => setComb({ sel: [], how: "solid", ink: "", tone: 50 })}>Combine colors</button>}</div>
      {distress && (
        <div className="mk-color tight mk-distress" title="The distress layer doesn't print: it knocks the inks out, so the shirt shows through">
          <span className="mk-srcs"><span className="sw dz" /></span><span className="arrow">→</span>
          <select aria-label="Distress layer" value={distress.on ? "on" : "off"} onChange={(e) => distress.set(e.target.value === "on")}>
            <option value="on">Distress (shirt shows through)</option>
            {distress.canOff && <option value="off">Off: print it clean</option>}
          </select>
        </div>
      )}
      {/* every color open, like the first Mockup Creator (Oct 22, Nick: "I like what you originally had… drop-down, use a
          standard color or a PMS, how close, and you could easily select from the top"): its ink, and the closest
          standard ink and PMS to pick with one click. A logo with many colors: one compact line each. */}
      {rows.filter((r) => r.cur?.name !== "none").map((r) => {
        const cur = r.cur, k = key(r);
        const swatches = <span className="mk-srcs">{r.hexes.map((h) => <span key={h} className="sw" style={{ background: h }} title={h} />)}</span>;
        return (
          <div key={k} className={"mk-color-wrap" + (compactRows ? " compact" : "")}>
            <div className="mk-color">
              {swatches}<span className="arrow">→</span>
              <span className="sw" style={{ background: cur ? cur.hex : r.hexes[0] }} />
              <InkSelect value={cur} onChange={(v) => pick(r, v)} />
              {cur && <button type="button" className="lc-reset" title="Back to the color as uploaded" aria-label="Reset to as uploaded" onClick={() => pick(r, null)}>↺</button>}
            </div>
            {r.hexes.length > 1
              ? <div className="mk-united"><span>{r.hexes.length} colors united · prints as one color{r.tones?.length ? ` (${r.tones.map((t) => `${t}% halftone`).join(", ")})` : ""}</span><button type="button" className="btn sm ghost" onClick={onSplit}>Split</button></div>
              : <Match hex={r.hexes[0]} cur={cur} compact={compactRows} onPick={(v) => pick(r, v)} onHover={(v) => onHover(r.hexes, v)} />}
          </div>
        );
      })}
      {/* removed colors drop out of the list (Oct 20, Nick); one line to bring them back */}
      {rows.some((r) => r.cur?.name === "none" && open !== key(r)) && (
        <div className="mk-removed">
          <span className="faint">Removed:</span>
          {rows.filter((r) => r.cur?.name === "none" && open !== key(r)).map((r) => (
            <button key={key(r)} type="button" className="mk-removed-chip" title="Bring this color back (as uploaded)" onClick={() => pick(r, null)}>
              {r.hexes.map((h) => <span key={h} className="sw" style={{ background: h }} />)}<span>Bring back</span>
            </button>
          ))}
        </div>
      )}
      {(brandGroups.length > 0 || onMatchAll) && (
        <div className="bs-foot">
          {brandGroups.length > 0 && (
            <div className="bs-dd">
              <button type="button" className="bs-btn" aria-expanded={bsOpen} onClick={() => setBsOpen(!bsOpen)}>
                <span className="bs-mini">{brandGroups[0].colors.slice(0, 4).map((c, i) => <i key={i} style={{ background: c.hex }} />)}</span>
                Apply brand standards <span className="bs-car">{bsOpen ? "▴" : "▾"}</span>
              </button>
              {bsOpen && <BrandPick groups={brandGroups} onPick={(g) => { g.go(); setBsOpen(false); }} onClose={() => setBsOpen(false)} />}
            </div>
          )}
          {onMatchAll && <button type="button" className="linkbtn bs-std" title="Set each color that's still as uploaded to the closest Wilflex RFU ink" onClick={onMatchAll}>Closest standard inks</button>}
        </div>
      )}
    </div>
  );
}

/** "+ Color" on a style in the Mockup Creator: type or pick one of the style's colors to add it (Oct 22) */
function AddColor({ colors, onAdd }: { colors: string[]; onAdd: (c: string) => void }) {
  const [v, setV] = useState("");
  return (
    <span className="mk-gc-add" title="Add a color of this style">
      <ColorPicker value={v} colors={colors} onChange={(c) => { if (colors.includes(c)) { onAdd(c); setV(""); } else setV(c); }} />
    </span>
  );
}

/**
 * Trace the hood's edge on a hoodie's back photo (Oct 23, Nick): drag roughly along the bottom edge of the hood; it snaps
 * to the color change there (lib/hoodSnap.ts) and every print on this color's back goes behind it.
 */
function HoodTrace({ edge, onDone, onClear }: { edge: [number, number][] | null; onDone: (pts: [number, number][]) => void; onClear: () => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [cur, setCur] = useState<[number, number][] | null>(null);
  const at = (e: { clientX: number; clientY: number }): [number, number] => { const r = svg.current!.getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / r.width) * PHOTO_W), Math.round(((e.clientY - r.top) / r.height) * PHOTO_H)]; };
  const line = (pts: [number, number][]) => pts.map((p) => p.join(",")).join(" ");
  return (
    <div className="mk-trace" onPointerDown={(e) => e.stopPropagation()}>
      <svg ref={svg} viewBox={`0 0 ${PHOTO_W} ${PHOTO_H}`} preserveAspectRatio="none"
        onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); setCur([at(e)]); }}
        onPointerMove={(e) => { if (!cur) return; e.stopPropagation(); const p = at(e), l = cur[cur.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 6) setCur([...cur, p]); }}
        onPointerUp={(e) => { e.stopPropagation(); const pts = cur; setCur(null); if (pts && pts.length > 2) onDone(pts); }}>
        {edge && !cur && <polyline points={line(edge)} fill="none" stroke="#e8336b" strokeWidth={5} />}
        {cur && <polyline points={line(cur)} fill="none" stroke="#1ba0e2" strokeWidth={5} strokeDasharray="10 6" />}
      </svg>
      <div className="mk-trace-bar">{edge ? "The hood's edge is set: prints on this color's back go behind it. Draw again to redo it." : "Drag along the bottom edge of the hood, left to right. It snaps to the edge."}{edge && <button type="button" className="ap-link" onClick={onClear}>Clear it</button>}</div>
    </div>
  );
}
