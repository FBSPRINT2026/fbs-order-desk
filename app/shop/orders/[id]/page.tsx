"use client";
import { accountOfMethod, carrierOf, isThirdParty, notOurShipping, onAccountMethod, type ThirdParty } from "@/lib/thirdParty";
import { bySupplierStyle } from "@/lib/garmentSup";
import { ownedFiles } from "@/lib/ownedFiles";
import ProofHistory from "@/components/ProofHistory";
import CustomerPick from "@/components/CustomerPick";
import ProofSide from "@/components/ProofSide";
import OrderGoodsPanel from "@/components/OrderGoodsPanel";
import OrderStages from "@/components/OrderStages";
import JobLabor from "@/components/team/JobLabor";
import BackLink from "@/components/BackLink";
import { previousStep, type TrailStep } from "@/lib/navTrail";
import JobFiles from "@/components/job/JobFiles";
import JobTalk, { OriginalJobTalk } from "@/components/JobTalk";
import { stampKey, stampOrderMockups } from "@/lib/mockupStamp";
import { NotMovedBanner, needsMove } from "@/components/CustomerMove";
import SendToPrintavo, { PrintavoChanges, PrintavoLink } from "@/components/SendToPrintavo";
import { SITE_URL } from "@/lib/config";
import { type FocusEvent, type ReactNode, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import { openOrderCheck } from "@/components/tools/OrderReview";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  calcOrder, designLabel, ALL_LOCATIONS, mergeSettings, newGroup, orderGroups, PAY_METHODS, priceList, finishingList, persEach, SHIP_METHODS, matchShipMethod, ST, STATUSES, uid,
  type ArtFile, type Customer, type Delivery, type Design, type Garment, type GLine, type Group, type Message, type Order, type OrderEvent, type Payment, type PriceType, type Proof, type Settings, type StatusKey,
} from "@/lib/pricing";
import GroupEditor, { saveFinishing } from "@/components/GroupEditor";
import FinishingPicker from "@/components/FinishingPicker";
import { isRelabel } from "@/components/NeckLabelPick";
import type { NeckLabelSet } from "@/lib/neckLabels";
import OrderSeparations from "@/components/OrderSeparations";
import { previewUrls, uploadDesign } from "@/lib/designs";
import { custLabel, fmtDate, fmtDateLong, fmtStamp, money, todayISO } from "@/lib/format";
import ProductionPanel from "@/components/ProductionPanel";
import { isReorder } from "@/components/ReorderPanel";
import OrderTypeRow, { orderTypeOf, ORDER_TYPE_LABEL } from "@/components/OrderTypeRow";
import CustomerArtwork from "@/components/CustomerArtwork";
import { labelFileName } from "@/lib/printavoNames";
import ProjectPicker from "@/components/ProjectPicker";
import { Pill, pvStatusOf } from "@/components/bits";
import SendProofTool from "@/components/tools/SendProofTool";
import { acceptRequest, requestProofApproval, sendToCustomer, simpleOrderActivity, staffMessage } from "../../actions";
import CreateOrderTool from "@/components/tools/CreateOrderTool";
import DigitizerTool from "@/components/tools/DigitizerTool";
import MenuItem from "@/components/MenuItem";
import ChargeOnFile from "@/components/ChargeOnFile";
import PayReadiness from "@/components/PayReadiness";
import { checkOrder } from "@/lib/orderChecks";
import { ADJUST } from "@/lib/printavoChanges";
import { keepConfirmed, orderNeedsDetails } from "@/lib/productionDetails";
import { specialtyGarment } from "@/lib/fabric";
import { withPrivate } from "@/lib/crm/private";
import { FillFromText, type StatusLine } from "@/components/OrderAssist";
import Timeline from "@/components/Timeline";
import { useCan, useRole, useSeesMoney } from "@/components/RoleContext";
import { firstName, renderTemplate, TEMPLATES, type TemplateKey } from "@/lib/crm/templates";
import { PAY_TERMS, SIZES, isShipFee, lineQty, colorCosts, supplierSizeUp, sizeUpEach, newGLine, newImprint, type Size, type Imprint } from "@/lib/pricing";
import OrderHelper from "@/components/OrderHelper";
import type { HelperAction, HelperOrder } from "@/lib/orderHelperShared";
import { BIG_SIZES, cardForOrder, finishingIncluded, programForGroup, type DesignCtx, type DesignPrice, type RateCard } from "@/lib/programs";
import { programCard, type ProgramCardOpt } from "@/app/shop/program-pricing-actions";
import { PriceSuggestions, ProgramNotes } from "@/components/ProgramPricing";
import ShipQuote from "@/components/ShipQuote";
import { fmtPhone } from "@/lib/phone";
import { archiveOrderArt, draftArtCount, keepOrderArt, orderArtForDelete, type ArtItem } from "@/app/shop/draft-art-actions";
import { qboOrderState, qboSyncOrder, voidOrderInQbo } from "@/app/shop/qbo-order-actions";
import QbLogo from "@/components/QbLogo";
import { clickUpJobOfOrder, reopenClickUpJob } from "@/app/shop/clickup/actions";
import { mockupHref, mockupStale, remakeMockup } from "@/lib/mockupFresh";
import type { DgzSewout } from "@/lib/digitizeStatus";

const EVENT_LABEL: Record<string, string> = {
  details: "Production details",
  created: "Created", sent: "Sent to customer", approved: "Customer approved quote", changes: "Customer asked for changes",
  proof_approved: "Proof approved", proof_changes: "Proof changes requested", proof_restored: "Went back to an earlier proof", proofs_requested: "Proof approval requested",
  art_approved: "Art marked approved by staff", seps_requested: "Separations requested",
  payment: "Payment received", viewed: "Customer viewed", request_submitted: "Customer sent in the request", reorder: "Reordered by the customer",
};

const GOODS_WORD: Record<string, string> = { waiting: "Waiting on goods", on_way: "On the way", arrived: "Arrived, checking in", partial: "Partly arrived", received: "Received", issue: "Receiving issue" };

// the order tabs' icons: on a phone the tabs show these instead of their names (Oct 15, Nick: "the middle tool bar
// has a horizontal scroll… just make those icons without words")
const TAB_ICONS: Record<string, ReactNode> = {
  // goods is a t-shirt, the same as the left menu's Goods (Oct 29, Nick: "should be a T-shirt not a box")
  goods: <path d="M9 3.5L4 5.8 2.5 10.2l3.2 1.3.9-2.2V20.5h10.8V9.3l.9 2.2 3.2-1.3L20 5.8 15 3.5c-.4 1.6-1.6 2.6-3 2.6s-2.6-1-3-2.6z" />,
  order: <><path d="M9 3.5h6v3H9z" /><path d="M7 5H5v15.5h14V5h-2" /><path d="M8.5 11h7M8.5 15h4.5" /></>,
  prod: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-9 8" /></>,
  msg: <path d="M4 5h16v11H10l-5 4v-4H4z" />,
  pay: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h3" /></>,
  act: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
};

/**
 * A Documents / Production menu closes when you move on, but a beat later: on a phone a tapped link takes no focus, so
 * closing on the spot pulled the menu away before the tap landed (Oct 26, Nick: "click like work order… it's not pulling
 * it… doesn't pop up").
 */
const closeSoon = (e: FocusEvent<HTMLDetailsElement>) => { const d = e.currentTarget; setTimeout(() => { if (!d.contains(document.activeElement)) d.open = false; }, 250); };

export default function OrderEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const sb = useMemo(() => createClient(), []);
  const [o, setO] = useState<Order | null>(null);
  const canPay = useCan("payments");
  const seesMoney = useSeesMoney(); // crew (production, receiving, shipping): quantities and what's ordered, no money
  // the production mockup (Oct 21, Nick: "a production view of the mock-up… confirm details, look at the last order, what we
  // did"): Nick and Jose open it from the order; the order page itself is the same for everyone
  const who = useRole();
  const prodRole = who.realRole === "owner" || who.realRole === "production";
  const [missing, setMissing] = useState(false);
  const [settings, setSettings] = useState<Settings>(mergeSettings({}));
  // a duplicate just made (?reprint=1): offer the reprint screen fee once
  const [reprintAsk, setReprintAsk] = useState(false);
  // the Digitizer open for one embroidered print (Oct 27)
  const [digitize, setDigitize] = useState<string | null>(null);
  useEffect(() => { try { const u = new URL(window.location.href); if (u.searchParams.get("reprint") === "1") { setReprintAsk(true); u.searchParams.delete("reprint"); window.history.replaceState(window.history.state, "", u.toString()); } } catch { /* */ } }, []);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const custOpts = useMemo(() => customers.map((c) => ({ id: c.id, label: custLabel(c), sub: c.company && c.name ? c.name : c.email || "" })), [customers]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [proofs, setProofs] = useState<(Proof & { url?: string })[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [prodNotes, setProdNotes] = useState("");
  const [catalog, setCatalog] = useState<Garment[]>([]);
  const [lookingUp, setLookingUp] = useState("");
  // this customer's designs (logos) for the imprint design pickers
  const [designs, setDesigns] = useState<Design[]>([]);
  const [designUrls, setDesignUrls] = useState<Record<string, string>>({});
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  // Style not in the catalog yet: pull it from S&S (saves it to the catalog too)
  async function lookupStyle(style: string, styleID?: number, supplier?: string): Promise<Garment | null> {
    const key = style.trim().toUpperCase();
    if (!key || lookingUp === key) return null;
    setLookingUp(key);
    try {
      const r = await fetch(`/api/ss/lookup?${styleID ? `styleid=${styleID}` : `style=${encodeURIComponent(key)}`}${bySupplierStyle(supplier) ? `&supplier=${supplier}` : ""}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.garment) { say(j.error || "Couldn't find that style at S&S or SanMar."); return null; }
      const g = j.garment as Garment;
      setCatalog((c) => [...c.filter((x) => x.id !== g.id), g].sort((a, b) => a.style.localeCompare(b.style)));
      return g;
    } finally { setLookingUp(""); }
  }
  const [art, setArt] = useState<(ArtFile & { url?: string })[]>([]);
  // a stamped customer mockup's picture without the stamp (Oct 22, Nick: "a button… you have to hold it down so you can
  // see it, but then when you release it, it pops back up"): the customer's original file, signed when it's on the page
  const [plain, setPlain] = useState<Record<string, string>>({});
  useEffect(() => {
    const stamped = art.map((a) => ({ a, k: a.file_path.match(/custmockup-([a-z0-9]+)\.jpg$/)?.[1] })).filter((x) => x.k && !plain[x.a.id]);
    if (!stamped.length || !o) return;
    const origs = (o.groups || []).flatMap((g) => g.customerMockups || []).map((m) => m.path);
    const pairs = stamped.map(({ a, k }) => ({ id: a.id, path: origs.find((p0) => stampKey(p0) === k) })).filter((x): x is { id: string; path: string } => !!x.path);
    if (!pairs.length) return;
    void sb.storage.from("proofs").createSignedUrls(pairs.map((x) => x.path), 3600).then(({ data }) => {
      setPlain((m) => ({ ...m, ...Object.fromEntries(pairs.map((x, i) => [x.id, data?.[i]?.signedUrl || ""]).filter(([, u]) => u)) }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art, o?.groups]);
  const guessed = useRef(false);
  const [newCust, setNewCust] = useState<null | { company: string; name: string; email: string; phone: string; price_type: PriceType; /** staff only: saved to customer_private */ account_owner?: string }>(null);
  const [saveState, setSaveState] = useState("");
  const [flash, setFlash] = useState("");
  const [armed, setArmed] = useState("");
  const [confirmRetail, setConfirmRetail] = useState(false);
  const [jdTab, setJdTab] = useState<"details" | "type">("details");
  const [pickCust, setPickCust] = useState(false); // the customer picker open to change who it is
  const [addrOpen, setAddrOpen] = useState(false);
  // on a phone (Oct 29, Nick): the top buttons fold into one Actions button, the customer into just the name
  const [actsOpen, setActsOpen] = useState(false);
  const [cuOpen, setCuOpen] = useState(false);
  const [discEdit, setDiscEdit] = useState(false); // typing the discount // the customer's address, email and notes shown
  // Customer artwork (Oct 24): which group is bringing in a mockup from another of the customer's orders
  const [custArt, setCustArt] = useState<number | null>(null);
  // the program pricing details: folded away until asked for (Oct 21, Nick: "by default mostly hidden… an arrow you click")
  const [progOpen, setProgOpen] = useSticky("order.programOpen", false);
  /** the customer's program rate card (Program chip), and the base shirt's blank cost now */
  // the customer's program: every rate card (Nine18 has one per location or brand), the design prices and whether new
  // orders take it by themselves; prog = the card this order uses (picked on the order, else guessed from its name)
  const [progAll, setProgAll] = useState<{ cards: ProgramCardOpt[]; items: DesignPrice[]; applyMode: "auto" | "ask" } | null>(null);
  const progCard = progAll ? cardForOrder(progAll.cards, { program_card: o?.program_card, nickname: o?.nickname, po_number: o?.po_number, ship_to: o?.ship_to }) : null;
  const prog = useMemo(() => (progAll ? { card: progCard?.card || null, baseCost: progCard?.baseCost ?? null, items: progAll.items } : null), [progAll, progCard]);
  const [custOwed, setCustOwed] = useState<{ n: number; owed: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Order | null>(null);
  // the customer's own carrier account (customers.ship_on, e.g. Nine18 FEDEX): its name and carrier, for the ship methods
  const [ownAcct, setOwnAcct] = useState<{ id: string; name: string; carrier: string } | null>(null);
  // the page's tabs (Oct 15, Nick: "too much information on one page… tabs at the top"); ?tab= keeps it on refresh
  type Tab = "order" | "prod" | "goods" | "msg" | "pay" | "act";
  const [tab, setTabS] = useState<Tab>("order");
  const setTab = (t: Tab) => { setTabS(t); try { const u = new URL(window.location.href); if (t === "order") u.searchParams.delete("tab"); else u.searchParams.set("tab", t); window.history.replaceState(window.history.state, "", u.toString()); } catch { /* */ } };
  useEffect(() => { try { const t = new URL(window.location.href).searchParams.get("tab"); if (t && ["order", "prod", "goods", "msg", "pay", "act"].includes(t)) setTabS(t as Tab); else if (window.location.hash === "#messages") setTabS("msg"); } catch { /* */ } }, []);
  const [talkN, setTalkN] = useState(0);
  const [goodsSt, setGoodsSt] = useState<{ status: string; updated_by: string | null } | null>(null);

  const say = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 4000); };
  const arm = (k: string) => { setArmed(k); setTimeout(() => setArmed((a) => (a === k ? "" : a)), 3500); };

  const loadSide = useCallback(async () => {
    const [p, pr, m, e, a] = await Promise.all([
      sb.from("payments").select("*").eq("order_id", id).order("paid_on"),
      sb.from("proofs").select("*").eq("order_id", id).is("archived_at", null).order("created_at", { ascending: false }),
      sb.from("messages").select("*").eq("order_id", id).order("created_at"),
      sb.from("order_events").select("*").eq("order_id", id).order("created_at", { ascending: false }),
      sb.from("art_files").select("*").eq("order_id", id).order("created_at"),
    ]);
    setPayments((p.data || []) as Payment[]);
    setMessages((m.data || []) as Message[]);
    setEvents((e.data || []) as OrderEvent[]);
    const arts = (a.data || []) as ArtFile[];
    const list = (pr.data || []) as Proof[];
    // the art and proof links are signed together, not one after the other
    const [au, pu] = await Promise.all([
      arts.length ? sb.storage.from("proofs").createSignedUrls(arts.map((x) => x.file_path), 3600) : Promise.resolve({ data: [] }),
      list.length ? sb.storage.from("proofs").createSignedUrls(list.map((x) => x.file_path), 3600) : Promise.resolve({ data: [] }),
    ]);
    setArt(arts.map((x, i) => ({ ...x, url: au.data?.[i]?.signedUrl || undefined })));
    // what the unlabeled production files probably are, for staff to confirm (once a page; each file looked at once)
    if (!guessed.current && arts.some((x) => !x.category && x.guess == null)) {
      guessed.current = true;
      void fetch("/api/production/guess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: id }) }).then((r) => r.json()).then((j: { guesses?: Record<string, { kind: string }> }) => {
        const g = j.guesses || {};
        if (Object.keys(g).length) setArt((xs) => xs.map((x) => (g[x.id] ? { ...x, guess: g[x.id].kind } : x)));
      }).catch(() => null);
    }
    setProofs(list.map((x, i) => ({ ...x, url: pu.data?.[i]?.signedUrl || undefined })));
  }, [sb, id]);

  useEffect(() => {
    (async () => {
      // payments, proofs, messages, history and art load alongside the order instead of after it
      const side = loadSide();
      const [ord, cu, st, inn, cat] = await Promise.all([
        sb.from("orders").select("*").eq("id", id).maybeSingle(),
        sb.from("customers").select("*"),
        sb.from("settings").select("data").eq("id", 1).maybeSingle(),
        sb.from("order_internal").select("production_notes").eq("order_id", id).maybeSingle(),
        sb.from("garments").select("*").order("style"),
      ]);
      if (!ord.data) { setMissing(true); await side.catch(() => null); return; }
      const d = ord.data as Order;
      d.groups = orderGroups(d);
      if (!d.groups.length) d.groups = [newGroup()];
      d.delivery_method = d.delivery_method || "pickup";
      d.price_type = d.price_type || "retail";
      d.fees = d.fees || [];
      d.discount_pct = +d.discount_pct || 0;
      d.discount_amt = +(d.discount_amt || 0);
      d.discount_type = d.discount_type === "amt" ? "amt" : "pct";
      d.tax_rate = d.tax_rate === null ? null : +d.tax_rate;
      setO(d);
      latest.current = d;
      // test companies are offered too: the picker only shows what's typed, so they come up when typed for (lib/format testFound)
      setCustomers((await withPrivate(sb, (cu.data || []) as Customer[])).sort((a, b) => custLabel(a).localeCompare(custLabel(b))));
      setSettings(mergeSettings(st.data?.data));
      setCatalog((cat.data || []) as Garment[]);
      setProdNotes(inn.data?.production_notes || "");
      setSaveState("Saved");
      // the shop has now seen the customer's sent order: from here they can only ask us to cancel it (Oct 24, Nick)
      { const x = d as Order & { submitted_at?: string | null; staff_seen_at?: string | null }; if (x.submitted_at && !x.staff_seen_at) void sb.from("orders").update({ staff_seen_at: new Date().toISOString() }).eq("id", id).is("staff_seen_at", null); }
      // changes that never reached the server (the connection dropped, the tab closed mid-save): offer them back
      try {
        const raw = localStorage.getItem(`fbs:unsaved:${d.id}`);
        const keep = raw ? (JSON.parse(raw) as { at: number; o: Order }) : null;
        if (keep?.o && Date.now() - keep.at < 7 * 864e5 && JSON.stringify(keep.o.groups) + keep.o.nickname + JSON.stringify(keep.o.fees) !== JSON.stringify(d.groups) + d.nickname + JSON.stringify(d.fees)) setRecover(keep);
        else if (raw) localStorage.removeItem(`fbs:unsaved:${d.id}`);
      } catch { /* storage off */ }
      await side;
      // mark customer messages read
      await sb.from("messages").update({ read_at: new Date().toISOString() }).eq("order_id", id).eq("author_type", "customer").is("read_at", null);
    })();
  }, [sb, id, loadSide]);

  const calc = useMemo(() => (o ? calcOrder(o, settings, payments) : null), [o, settings, payments]);

  const custId = o?.customer_id || "";
  // what else this customer owes (other invoices), shown on the customer card
  useEffect(() => {
    if (!custId) { setCustOwed(null); return; }
    (async () => {
      const { data: os } = await sb.from("orders").select("id,total").eq("customer_id", custId).eq("type", "invoice").neq("id", id);
      const ids = (os || []).map((x) => x.id);
      if (!ids.length) return setCustOwed({ n: 0, owed: 0 });
      const { data: ps } = await sb.from("payments").select("order_id,amount").in("order_id", ids);
      const paid: Record<string, number> = {};
      (ps || []).forEach((p) => { paid[p.order_id] = (paid[p.order_id] || 0) + (+p.amount || 0); });
      const owing = (os || []).map((x) => (+x.total || 0) - (paid[x.id] || 0)).filter((b) => b > 0.004);
      setCustOwed({ n: owing.length, owed: Math.round(owing.reduce((a, b) => a + b, 0) * 100) / 100 });
    })();
  }, [sb, custId, id]);
  const loadDesigns = useCallback(async () => {
    if (!custId) { setDesigns([]); setDesignUrls({}); return; }
    const { data } = await sb.from("designs").select("*").eq("customer_id", custId).order("number", { ascending: false });
    const list = (data || []) as Design[];
    setDesigns(list);
    setDesignUrls(await previewUrls(sb, list));
  }, [sb, custId]);
  useEffect(() => { loadDesigns(); }, [loadDesigns]);
  // the order's sew-outs (each print's digitizing stamp: Waiting on customer, Sew-out approved with its photo)
  const [sewouts, setSewouts] = useState<(DgzSewout & { url?: string })[]>([]);
  const loadSewouts = useCallback(async () => {
    const { data } = await sb.from("sewouts").select("order_id, imprint_id, status, archived_at, photo_path, sent_at, decided_at, created_at, version").eq("order_id", id).is("archived_at", null);
    const list = (data || []) as (DgzSewout & { photo_path: string })[];
    const paths = list.map((x) => x.photo_path).filter(Boolean);
    const { data: su } = paths.length ? await sb.storage.from("proofs").createSignedUrls(paths, 3600) : { data: [] };
    setSewouts(list.map((x) => ({ ...x, url: su?.find((u) => u.path === x.photo_path)?.signedUrl || "" })));
  }, [sb, id]);
  useEffect(() => { void loadSewouts(); }, [loadSewouts, designs]);
  // the saved mockup pictures drawn again by themselves when what they show changed since (lib/mockupFresh.ts; Oct 28,
  // Nick: "the little boxes aren't updating… what's a permanent fix"): saved first, then each group out of sight, then
  // the order read again. Once a session per change, so a picture that can't be drawn doesn't loop
  const [redrawing, setRedrawing] = useState<string[]>([]);
  const redrawBusy = useRef(false);
  // checked each time the order is read (its logos are read with it), not on every edit here
  useEffect(() => {
    const o = latest.current;
    if (!o || !designs.length || redrawBusy.current || ["request", "completed"].includes(o.status)) return;
    const due = o.groups.filter((g) => {
      if (!mockupStale(g, designs)) return false;
      const k = `fbs:redrawn:${g.id}:${g.mockupAt}`;
      try { if (sessionStorage.getItem(k)) return false; sessionStorage.setItem(k, "1"); } catch { /* */ }
      return true;
    });
    if (!due.length) return;
    redrawBusy.current = true;
    void (async () => {
      setRedrawing(due.map((g) => g.id));
      try { await save(); } catch { /* */ }
      for (const g of due) await remakeMockup(o.id, g);
      setRedrawing([]); redrawBusy.current = false;
      window.dispatchEvent(new CustomEvent("fbs:order-changed", { detail: { orderId: o.id } }));
    })();
  }, [designs]); // eslint-disable-line react-hooks/exhaustive-deps
  async function starDesign(d: Design, starred: boolean) {
    setDesigns((ds) => ds.map((x) => (x.id === d.id ? { ...x, starred } : x)));
    const { error } = await sb.rpc("set_design_star", { p_design: d.id, p_starred: starred });
    if (error) setDesigns((ds) => ds.map((x) => (x.id === d.id ? { ...x, starred: !starred } : x)));
  }
  // signed links for the saved mockup thumbnails on each group
  const thumbKey = (o?.groups || []).flatMap((g) => [...(g.mockupThumbs || []), ...(g.customerMockups || []).map((m) => m.path), ...g.imprints.map((d) => d.shownArt || "").filter(Boolean), ...g.imprints.map((d) => d.supplied?.picture?.path || "").filter(Boolean), ...g.imprints.map((d) => d.placeRef?.path || "").filter(Boolean)]).join("|");
  useEffect(() => {
    const paths = thumbKey ? thumbKey.split("|").filter((p) => !thumbUrls[p]) : [];
    if (!paths.length) return;
    sb.storage.from("proofs").createSignedUrls(paths, 3600).then(({ data }) => {
      const m: Record<string, string> = {};
      paths.forEach((p, i) => { if (data?.[i]?.signedUrl) m[p] = data[i].signedUrl; });
      setThumbUrls((u) => ({ ...u, ...m }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbKey, sb]);
  async function uploadOrderDesign(file: File, name: string): Promise<Design | null> {
    if (!custId) { say("Pick a customer first. New art is saved to their account."); return null; }
    try {
      const { data: u } = await sb.auth.getUser();
      const d = await uploadDesign(sb, { draft: true, file, name, customer_id: custId, by: u.user?.email || "" }); // on this order; in their library once the order goes ahead
      await loadDesigns();
      say(`Added ${designLabel(d)} to this order. It goes in the customer's logos when the order goes ahead.`);
      return d;
    } catch (e) { say("Upload failed: " + (e instanceof Error ? e.message : String(e))); return null; }
  }

  const save = useCallback(async () => {
    const d = latest.current;
    if (!d) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setSaveState("Saving…");
    // production may have confirmed a reorder's print details while this was open: keep what they confirmed
    if (orderNeedsDetails(d.groups)) {
      const { data: cur } = await sb.from("orders").select("groups").eq("id", d.id).maybeSingle();
      const k = keepConfirmed(d.groups, (cur?.groups || null) as Group[] | null);
      if (k.changed) { d.groups = k.groups; latest.current = d; setO((x) => (x && x.id === d.id ? { ...x, groups: k.groups } : x)); }
    }
    const c = calcOrder(d, settings);
    const { error } = await sb.from("orders").update({
      customer_id: d.customer_id || null, nickname: d.nickname, due_date: d.due_date || null, groups: d.groups, lines: [], fees: d.fees,
      price_type: d.price_type || "retail", order_type: d.order_type || null, use_program: !!d.use_program, program_card: d.program_card || null, po_number: d.po_number || "", production_date: d.production_date || null, rush: !!d.rush, firm: !!d.firm, due_time: d.due_time ?? null, delivery_method: d.delivery_method || "pickup",
      ship_to: d.ship_to || "", ship_method: d.ship_method || "", tracking: d.tracking || "", third_party: d.third_party || null,
      discount_pct: +d.discount_pct || 0, discount_amt: +(d.discount_amt || 0), discount_type: d.discount_type === "amt" ? "amt" : "pct", tax_exempt: d.tax_exempt, tax_rate: d.tax_rate === null || (d.tax_rate as unknown) === "" ? null : +d.tax_rate,
      waive_setup: d.waive_setup, notes: d.notes, notes_on_invoice: !!d.notes_on_invoice, total: c.total, qty: c.qty,
    }).eq("id", d.id);
    setSaveState(error ? "Save failed: " + error.message : "Saved");
    if (!error) try { localStorage.removeItem(`fbs:unsaved:${d.id}`); } catch { /* storage off */ }
  }, [sb, settings]);

  useEffect(() => () => { if (timer.current) save(); }, [save]);
  // the order check on the right (components/tools/OrderReview.tsx, Oct 23): what's typed here is saved before it changes
  // the order, and the order shows its changes as soon as they're made (no reload, no lost typing)
  useEffect(() => {
    const onSave = (e: Event) => {
      const d = (e as CustomEvent<{ orderId: string; handled: boolean; done: () => void }>).detail;
      if (d?.orderId !== id) return;
      d.handled = true;
      void (async () => { if (timer.current) await save(); d.done(); })();
    };
    const onChanged = async (e: Event) => {
      if ((e as CustomEvent<{ orderId: string }>).detail?.orderId !== id) return;
      if (timer.current) return; // typing here right now: their next save keeps both
      const { data } = await sb.from("orders").select("*").eq("id", id).maybeSingle();
      if (!data) return;
      const d = data as Order;
      d.groups = orderGroups(d);
      d.fees = d.fees || [];
      d.discount_pct = +d.discount_pct || 0;
      d.discount_amt = +(d.discount_amt || 0);
      d.discount_type = d.discount_type === "amt" ? "amt" : "pct";
      d.tax_rate = d.tax_rate === null ? null : +d.tax_rate;
      d.delivery_method = d.delivery_method || "pickup";
      d.price_type = d.price_type || "retail";
      setO(d); latest.current = d;
      void loadDesigns(); void loadSide();
    };
    // coming back to this tab from another page (the production view, the Mockup Creator, Reorder Details): the order as
    // it is now, so an edit here can't save old copies of what was changed there (Oct 23: #40133's notes and drops came
    // back after they were changed elsewhere)
    const onFocus = () => { if (document.visibilityState === "visible") void onChanged(new CustomEvent("fbs:order-changed", { detail: { orderId: id } })); };
    window.addEventListener("fbs:order-save", onSave);
    window.addEventListener("fbs:order-changed", onChanged);
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("fbs:order-save", onSave); window.removeEventListener("fbs:order-changed", onChanged); window.removeEventListener("focus", onFocus); };
  }, [id, save, sb, loadDesigns, loadSide]);
  // closing the tab mid-edit: save now and ask the browser to wait
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (timer.current) { save(); e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [save]);

  // customer order requests come in without costs: suggest them from the garment catalog once
  const costsFilled = useRef(false);
  useEffect(() => {
    if (!o || o.status !== "request" || costsFilled.current || !catalog.length) return;
    costsFilled.current = true;
    const find = (l: GLine) => catalog.find((g) => g.style.toLowerCase() === (l.style || "").trim().toLowerCase() && (!l.brand || g.brand.toLowerCase() === l.brand.toLowerCase()));
    const missing = (o.groups || []).some((g) => g.lines.some((l) => (l.cost === "" || l.cost === null || l.cost === undefined) && find(l)));
    if (missing) patch((d) => { d.groups.forEach((g) => g.lines.forEach((l) => { const gm = find(l); if ((l.cost === "" || l.cost == null) && gm) {
      l.cost = colorCosts(gm, l.color).base || gm.cost;
      // 2XL+ material charge from the supplier's size prices (this color's), same as picking the style here
      Object.assign(l, supplierSizeUp(gm, settings, l.color));
    } })); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, catalog]);

  // contract jobs: specialty ink (poly / nylon / dyed garments) follows the garments on each group, unless staff set it
  // by hand. Only while the order is still being quoted or worked up, so a printed job's price doesn't move.
  useEffect(() => {
    if (!o || o.price_type !== "wholesale" || !catalog.length || ["production", "ready", "completed"].includes(o.status)) return;
    const want = o.groups.map((g) => {
      const hits = g.lines.filter((l) => (l.style || l.garment || "").trim()).map((l) => {
        const cat = catalog.find((c) => c.style.toLowerCase() === (l.style || "").trim().toLowerCase());
        return specialtyGarment({ style: l.style, brand: l.brand, garment: `${l.garment || ""} ${cat?.description || ""}`, color: l.color, fabric: cat?.fabric, supplier: cat?.supplier || undefined });
      });
      const yes = hits.filter((h) => h.yes);
      return { on: yes.length > 0, why: yes.map((h) => h.why).join("; ").slice(0, 200) };
    });
    if (o.groups.some((g, i) => !g.specialtyInkSet && (!!g.specialtyInk !== want[i].on || (g.fabricNote || "") !== want[i].why)))
      patch((d) => d.groups.forEach((g, i) => { if (g.specialtyInkSet || !want[i]) return; g.specialtyInk = want[i].on || undefined; g.fabricNote = want[i].why || undefined; }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, catalog]);

  // program pricing (Oct 14, Nick: Peticolas, Nine18, Furry Feline): the customer's rate card, for the Program chip
  useEffect(() => {
    if (!custId || !seesMoney) { setProgAll(null); return; }
    let live = true;
    programCard(custId).then((r) => { if (live) setProgAll(r.ok && (r.cards.length || r.items.length) ? { cards: r.cards, items: r.items, applyMode: r.applyMode } : null); }, () => live && setProgAll(null));
    return () => { live = false; };
  }, [custId, seesMoney]);
  // a new order for a program customer starts on Program (once per order: switching to Retail / Wholesale stays)
  const autoProg = useRef("");
  useEffect(() => {
    if (!o || !prog || autoProg.current === o.id) return;
    autoProg.current = o.id;
    const empty = !o.groups.some((g) => g.lines.some((l) => Object.values(l.sizes || {}).some((n) => +(n || 0) > 0)));
    // "Ask" customers get an Apply button instead (Oct 17)
    if (!o.use_program && empty && progAll?.applyMode !== "ask" && ["quote", "request"].includes(o.status)) patch((d) => { d.use_program = true; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o?.id, prog]);
  /** what a group's design is called, for the designs' own program prices: the order's name and its prints' designs */
  const designCtx = (d: Pick<Order, "nickname">, g: Group): DesignCtx => ({ items: prog?.items || [], text: [d.nickname || "", ...g.imprints.map((x) => designs.find((y) => y.id === x.design_id)?.name || "")].join(" "),
    art: g.imprints.map((x) => designs.find((y) => y.id === x.design_id)?.name || "").join(" "),
    garments: g.lines.map((l) => lineText(l)).join(" "), lineGarments: Object.fromEntries(g.lines.map((l) => [l.id, lineText(l)])) });
  const lineText = (l: Group["lines"][number]) => [l.style, l.brand, l.garment, catalog.find((c) => c.style.toLowerCase() === (l.style || "").trim().toLowerCase())?.description || ""].join(" ");
  // with Program on, each line gets the card's price (GLine.prog, saved as the line's price so every total agrees);
  // a price typed by hand wins and stays; off, or not covered (under the minimum, a print the card doesn't have), the
  // line goes back to normal pricing. Not once the job is in production.
  useEffect(() => {
    if (!o || ["production", "ready", "completed"].includes(o.status)) return;
    const on = !!o.use_program && !!prog;
    const findGm = (l: GLine) => catalog.find((c) => c.style.toLowerCase() === (l.style || "").trim().toLowerCase() && (!l.brand || c.brand.toLowerCase() === l.brand.toLowerCase()));
    // flat: a design's own price. Finishing on the job is added on top of it (Oct 21, Nick: Mewjira's tagging is $1 a
    // piece on top of $5.50) unless the card says designs are all-in (Nine18: then only extras the program prices itself,
    // like personalization $5)
    const finishingExtra = (d: Order, g: Group, flat: boolean) => {
      const pl = priceList(settings, d.price_type || "retail");
      const list = finishingList(settings, pl, g.customFin);
      const own = prog!.card?.extraPrices || {};
      const fs = (g.finishing || []).map((id) => list.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f && !finishingIncluded(prog!.card, f) && (!flat || !prog!.card?.designsAllIn || own[f.id] != null));
      // the tag print's price typed on the group wins, then the program's own price, then the list's
      const price = (f: { id: string; price: number }) => (f.id === "relabel" && g.tagPrice != null ? +g.tagPrice : own[f.id] != null ? +own[f.id] : +f.price || 0);
      return fs.length ? { each: fs.reduce((a, f) => a + price(f), 0), names: fs.map((f) => f.name).join(", ") } : null;
    };
    const apply = (d: Order) => {
      const plans = on ? d.groups.map((g) => programForGroup(g, prog!.card, prog!.baseCost, designCtx(d, g))) : [];
      d.groups.forEach((g, gi) => g.lines.forEach((l) => {
        // their extras print free: never priced by the program
        if (l.extras) return;
        if (l.progOff) { if (l.priceOverride == null) delete l.progOff; else return; }
        if (l.prog && l.priceOverride !== l.prog.each) { l.progOff = true; delete l.prog; return; }
        const want0 = on ? plans[gi]?.lines[l.id] || null : null;
        // finishing on this job that isn't part of their program price is added on top (Oct 17: the card says what's
        // included, e.g. Peticolas's roll & rubber band and neck labels); a design's flat price is everything in
        const extra0 = want0 ? finishingExtra(d, g, !!plans[gi]?.flat) : null;
        // a personalized piece (GLine.pers): the program's own personalization price (Nine18 $5), else the list's
        const own: Record<string, number> = (want0 && prog?.card?.extraPrices) || {}, pk = Object.keys(own).find((k) => /personal/i.test(k));
        const persP = want0 && l.pers ? (pk ? +own[pk] : persEach(settings, d.price_type || "retail")) : 0;
        const extra = persP ? { each: (extra0?.each || 0) + persP, names: [extra0?.names, "Personalization"].filter(Boolean).join(", ") } : extra0;
        const want = want0 && extra && extra.each ? { each: Math.round((want0.each + extra.each) * 100) / 100, note: `${want0.note} + ${extra.names} ${extra.each.toFixed(2)} (not in the program)`, base: want0.each, adds: `${extra.names.replace(/\s*\([^)]*\)/g, "")} ${extra.each.toFixed(2)}` } : want0;
        if (want) {
          const up: GLine["sizeUp"] = {};
          // a design's flat price is everything in: no 2XL+ charge; else the card's
          for (const z of BIG_SIZES) if (plans[gi]?.flat) up[z] = 0; else if (prog!.card?.sizeUp?.[z] != null) up[z] = +prog!.card.sizeUp[z]!;
          if (!l.prog || l.prog.each !== want.each || l.prog.note !== want.note || l.prog.base !== (want as { base?: number }).base) { l.prog = want; l.priceOverride = want.each; }
          if (JSON.stringify(l.sizeUp || {}) !== JSON.stringify(up)) l.sizeUp = up;
        } else if (l.prog) {
          delete l.prog; l.priceOverride = null;
          const gm = findGm(l);
          Object.assign(l, gm ? supplierSizeUp(gm, settings, l.color) : { sizeUp: undefined, sizeUpMarkup: undefined });
        }
      }));
      // program rules for every job: the price per screen (Tiger Blue $15) on each group with a screen print
      d.groups.forEach((g) => {
        const want = on && prog!.card?.screenFee != null && g.imprints.some((x) => x.method === "screen") ? +prog!.card.screenFee : undefined;
        if (want == null) { if (g.screenFee != null) delete g.screenFee; } else if (g.screenFee !== want) g.screenFee = want;
      });
      // the card's "no setup": while Program is on, setup is waived when every group is on program prices (never when
      // the card prices the screens)
      if (on && prog!.card?.noSetupEver) { if (!d.waive_setup) d.waive_setup = true; }
      else if (on && (prog!.card ? prog!.card.waiveSetup && prog!.card.screenFee == null : true)) {
        const all = d.groups.every((g, gi) => plans[gi]?.ok || !g.lines.some((l) => Object.values(l.sizes || {}).some((n) => +(n || 0) > 0)));
        if (d.waive_setup !== all) d.waive_setup = all;
      }
    };
    const trial: Order = JSON.parse(JSON.stringify(o));
    apply(trial);
    if (JSON.stringify(trial.groups) !== JSON.stringify(o.groups) || trial.waive_setup !== o.waive_setup) patch(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, prog, catalog, designs]);

  // a customer's own mockup goes in the job's Production files as a reference, stamped "CUSTOMER SUPPLIED MOCKUP"
  // across it (we remake the mockup ourselves for the separations). Made once per file: the stamped file is named
  // after the original's path.
  const [filesBump, setFilesBump] = useState(0);
  // the job's photos in Production files too (Oct 23, Nick: "I added some pictures to the production details. Those should
  // be on the production files now"): this run's, and last time's (the production view files photos of the old job on
  // that job, so the next reorder has them)
  const [jobPics, setJobPics] = useState<{ id: string; name: string; url: string; mime: string; note: string }[]>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      type JF = { id: string; kind: string; url: string; file_name: string; file_type: string; body: string };
      const get = (k: "o" | "a", jid: string) => fetch(`/api/jobs/files?kind=${k}&id=${jid}`).then((x) => x.json()).then((j) => ((j.items || []) as JF[]).filter((x) => x.kind === "photo" && x.url)).catch(() => [] as JF[]);
      const mine = await get("o", id);
      const { data: ev } = await sb.from("order_events").select("detail").eq("order_id", id).eq("kind", "reorder").order("created_at").limit(1).maybeSingle();
      const num = String(ev?.detail || "").match(/Printavo #(\d{3,7})/)?.[1];
      let prev: JF[] = [];
      if (num) { const { data: ao } = await sb.from("archived_orders").select("id").eq("visual_id", num).limit(1).maybeSingle(); if (ao?.id) prev = await get("a", ao.id as string); }
      if (!live) return;
      setJobPics([...mine.map((x) => ({ id: "jf-" + x.id, name: x.body || x.file_name || "Photo", url: x.url, mime: x.file_type || "image/jpeg", note: "Photo of this run" })),
        ...prev.map((x) => ({ id: "jf-" + x.id, name: x.body || x.file_name || "Photo", url: x.url, mime: x.file_type || "image/jpeg", note: `Photo from last time (#${num})` }))]);
    })();
    return () => { live = false; };
  }, [id, filesBump, sb]);
  // opened from an email (Inbox → Edit details): a way back to it once the order is checked
  const [fromEmail, setFromEmail] = useState("");
  const [backTo, setBackTo] = useState<TrailStep | null>(null);
  useEffect(() => { setBackTo(previousStep(/^\/shop\/artwork\/mockup/)); }, [id]);
  useEffect(() => { setFromEmail(new URLSearchParams(window.location.search).get("email") || ""); }, []);
  // an order made from an email (Create order / Edit details) keeps its way back to that email however it's opened
  const orderSource = o?.source || "", orderIdNow = o?.id || "";
  useEffect(() => {
    if (fromEmail || orderSource !== "email" || !orderIdNow) return;
    sb.from("activities").select("id").eq("order_id", orderIdNow).eq("kind", "email").order("occurred_at", { ascending: true }).limit(1).then(({ data }) => { const a = (data || [])[0] as { id: string } | undefined; if (a) setFromEmail(a.id); });
  }, [orderSource, orderIdNow, fromEmail, sb]);
  const stamping = useRef(new Set<string>());
  const custMockKey = o ? `${o.id}|${o.groups.flatMap((g) => (g.customerMockups || []).map((m) => m.path)).join("|")}` : "";
  useEffect(() => {
    if (!o || !custMockKey.includes("|") || custMockKey.endsWith("|")) return;
    const todo = o.groups.flatMap((g, gi) => (g.customerMockups || []).map((m) => ({ m, gi }))).filter(({ m }) => !stamping.current.has(m.path));
    if (!todo.length) return;
    todo.forEach(({ m }) => stamping.current.add(m.path));
    stampOrderMockups(sb, o.id, o.groups).then((n) => { if (n) { setFilesBump((k) => k + 1); loadSide(); } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custMockKey]);

  function patch(fn: (d: Order) => void) {
    setO((prev) => {
      if (!prev) return prev;
      const n: Order = JSON.parse(JSON.stringify(prev));
      fn(n);
      latest.current = n;
      // a copy in this browser until the server has it (Oct 24, Nick: "maybe somebody loses their internet connection"):
      // offered back on the next open if it never got saved
      try { localStorage.setItem(`fbs:unsaved:${n.id}`, JSON.stringify({ at: Date.now(), o: n })); } catch { /* storage full or off */ }
      return n;
    });
    setSaveState("Editing…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 700);
  }
  const setGroup = (i: number, fn: (g: Group) => void) => patch((d) => fn(d.groups[i]));
  // finishing: picked once for the whole order (the usual case) or per group. Embroidery extras stay on their group.
  const [finSplit, setFinSplit] = useState<boolean | null>(null);
  // finishing picked for the whole order: not embroidery extras, not the tag print (it's on each group's imprints)
  const isFin = (id: string) => !id.startsWith("emb_") && id !== "relabel";
  const finKey = (g: Group) => (g.finishing || []).filter(isFin).sort().join(",");
  const finPerGroup = finSplit ?? (!!o && new Set(o.groups.map(finKey)).size > 1);
  const orderFinList = o?.price_type === "wholesale" && settings.wholesale.finishing?.length ? settings.wholesale.finishing : settings.finishing;
  const setOrderFin = (id: string, on: boolean) => patch((d) => { for (const g of d.groups) { const set = new Set(g.finishing || []); if (on) set.add(id); else set.delete(id); g.finishing = [...set]; } });
  const finishingSame = () => { setFinSplit(false); patch((d) => { const base = (d.groups[0]?.finishing || []).filter(isFin), cf = d.groups[0]?.customFin || []; for (const g of d.groups) { g.finishing = [...(g.finishing || []).filter((x) => !isFin(x)), ...base]; g.customFin = [...cf]; g.neckLabel = d.groups[0]?.neckLabel; } }); };
  const cloneGroup = (g: Group): Group => ({ id: uid(), lines: g.lines.map((l) => ({ ...l, id: uid() })), imprints: g.imprints.map((d) => ({ ...d, id: uid() })), finishing: [...(g.finishing || [])], ...(g.customFin?.length ? { customFin: [...g.customFin] } : {}) });

  /** Groups the AI read from an email: fill blank costs and details from the catalog, then add or replace. */
  function applyProposal(groups: Group[], p: { nickname?: string; due_date?: string | null; notes?: string; po_number?: string }, mode: "replace" | "add") {
    const find = (l: GLine) => { const hits = catalog.filter((g) => g.style.toLowerCase() === (l.style || "").trim().toLowerCase()); return (l.brand ? hits.find((g) => g.brand.toLowerCase() === l.brand.toLowerCase()) : undefined) || (hits.length === 1 ? hits[0] : undefined); };
    groups.forEach((g) => g.lines.forEach((l) => {
      const gm = find(l);
      if (!gm) return;
      l.brand = gm.brand; l.garment = l.garment || gm.description;
      if (o?.price_type !== "wholesale") l.cost = +colorCosts(gm, l.color).base || +gm.cost || "";
      Object.assign(l, supplierSizeUp(gm, settings, l.color));
      const run = (gm.sizes || []).filter((z) => (SIZES as readonly string[]).includes(z));
      if (run.length) { l.sizeRun = run; if (run.length === 1 && run[0] === "OS") l.oneSize = true; }
    }));
    patch((d) => {
      const g0 = d.groups[0];
      const blank = d.groups.length === 1 && !g0.lines.some((l) => l.style || l.color || Object.keys(l.sizes || {}).length) && !g0.imprints.some((x) => x.design_id) && !(g0.customerMockups || []).length && !g0.mockupAt;
      d.groups = mode === "replace" || blank ? groups : [...d.groups, ...groups];
      if (!d.nickname && p.nickname) d.nickname = p.nickname.slice(0, 120);
      if (!d.due_date && p.due_date && /^\d{4}-\d{2}-\d{2}$/.test(p.due_date)) d.due_date = p.due_date;
      if (!d.po_number && p.po_number) d.po_number = p.po_number.slice(0, 60);
      if (p.notes && !d.notes.includes(p.notes)) d.notes = (d.notes ? d.notes + "\n" : "") + p.notes;
    });
    say(`Added ${groups.length} group${groups.length === 1 ? "" : "s"} from the email. Check styles, colors and sizes.`);
  }

  /* ---------- Ask AI (components/OrderHelper.tsx): the order as it is on screen, and the changes it sends back ---------- */
  const helperUndo = useRef<Order | null>(null);
  function helperSnapshot(): HelperOrder | null {
    if (!o || !calc) return null;
    const pl = priceList(settings, o.price_type || "retail");
    const c = customers.find((x) => x.id === o.customer_id);
    const big = ["2XL", "3XL", "4XL", "5XL", "6XL"];
    return {
      number: o.number, nickname: o.nickname || "", customer: c ? custLabel(c) : "", due_date: o.due_date, po_number: o.po_number || "", notes: o.notes || "",
      price_type: o.price_type || "retail", fees: o.fees.map((f) => ({ label: f.label, amount: +f.amount || 0 })),
      discount: o.discount_type === "amt" ? (o.discount_amt ? money(+o.discount_amt) : "") : o.discount_pct ? `${o.discount_pct}%` : "", total: calc.total,
      groups: o.groups.map((g, gi) => ({
        name: g.name || "",
        lines: g.lines.map((l, li) => {
          const gm = catalog.find((x) => x.style.toLowerCase() === (l.style || "").trim().toLowerCase() && (!l.brand || x.brand.toLowerCase() === l.brand.toLowerCase()));
          const lc = calc.groups[gi]?.lines[li];
          const sizeCharges: Record<string, number> = {};
          for (const z of big) if ((l.sizeRun || []).includes(z) || l.sizes?.[z as Size]) {
            const v = l.sizeUpSet?.[z as Size] != null ? +l.sizeUpSet[z as Size]! : o.price_type !== "wholesale" && l.sizeUp && l.sizeUp[z as Size] !== undefined ? sizeUpEach(l, z as Size) : +(pl.upcharges as Record<string, number | undefined>)[z]! || 0;
            if (v) sizeCharges[z] = Math.round(v * 100) / 100;
          }
          return { style: l.style, brand: l.brand, color: l.color, description: l.garment, sizes: Object.fromEntries(Object.entries(l.sizes || {}).filter(([, v]) => +(v as number) > 0)) as Record<string, number>,
            colors: gm?.colors, run: l.sizeRun || gm?.sizes?.filter((z) => (SIZES as readonly string[]).includes(z)), each: seesMoney && lc ? Math.round(lc.each * 100) / 100 : undefined, priceSetByHand: l.priceOverride != null, sizeCharges };
        }),
        imprints: g.imprints.map((d) => ({ location: d.location, method: d.method, colors: d.colors, inks: d.inks, size: d.size })),
      })),
    };
  }
  async function applyHelper(acts: HelperAction[]): Promise<string[]> {
    if (!o) return [];
    helperUndo.current = JSON.parse(JSON.stringify(o));
    const done: string[] = [];
    const cleanSizes = (sz: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(sz || {}).filter(([k, v]) => (SIZES as readonly string[]).includes(k) && Number.isFinite(+(v as number)) && +(v as number) > 0).map(([k, v]) => [k, Math.round(+(v as number))])) as GLine["sizes"];
    const sizesText = (sz: GLine["sizes"]) => Object.entries(sz).map(([k, v]) => `${k} ${v}`).join(", ") || "no sizes";
    // styles the order doesn't know yet: pulled from S&S / SanMar first
    const found = new Map<string, Garment>();
    for (const st of [...new Set(acts.flatMap((a) => ((a.kind === "add_line" || a.kind === "set_line") && a.style ? [String(a.style).trim().toUpperCase()] : [])))]) {
      const hit = catalog.find((g) => g.style.toUpperCase() === st) || (await lookupStyle(st).catch(() => null));
      if (hit) found.set(st, hit); else done.push(`${st}: couldn't find that style at S&S or SanMar (added without catalog details)`);
    }
    const fill = (l: GLine) => {
      const gm = found.get(l.style.trim().toUpperCase()) || catalog.find((g) => g.style.toUpperCase() === l.style.trim().toUpperCase());
      if (!gm) return;
      l.brand = gm.brand; l.garment = gm.description;
      if (o.price_type !== "wholesale") l.cost = +colorCosts(gm, l.color).base || +gm.cost || "";
      Object.assign(l, supplierSizeUp(gm, settings, l.color));
      const run = (gm.sizes || []).filter((z) => (SIZES as readonly string[]).includes(z));
      if (run.length) { l.sizeRun = run; l.oneSize = run.length === 1 && run[0] === "OS"; }
      // the catalog's spelling of the color ("purple" → Purple)
      const cc = (gm.colors || []).find((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "") === l.color.toLowerCase().replace(/[^a-z0-9]/g, ""));
      if (cc) l.color = cc;
    };
    patch((d) => {
      const named = new Map<string, number>();
      const groupOf = (ref: unknown): number => {
        if (typeof ref === "number" && d.groups[ref]) return ref;
        const name = String(ref ?? "").trim();
        if (/^\d+$/.test(name) && d.groups[+name]) return +name;
        const key = name.toLowerCase();
        if (named.has(key)) return named.get(key)!;
        let i = d.groups.findIndex((g) => (g.name || "").trim().toLowerCase() === key && key);
        const blank = (g: Group) => !g.lines.some((l) => l.style || l.color || Object.keys(l.sizes || {}).length);
        if (i < 0 && d.groups.length === 1 && blank(d.groups[0])) { i = 0; if (name) d.groups[0].name = name; }
        if (i < 0) { const ng = newGroup(); ng.name = name || undefined; d.groups.push(ng); i = d.groups.length - 1; }
        named.set(key, i);
        return i;
      };
      const linesOf = (a: { group?: number; line?: number }) => (a.group != null && d.groups[a.group]
        ? (a.line != null && d.groups[a.group].lines[a.line] ? [d.groups[a.group].lines[a.line]] : d.groups[a.group].lines)
        : d.groups.flatMap((g) => g.lines)).filter((l) => l.style || lineQty(l));
      const name = (l: GLine) => `${l.style || "line"}${l.color ? ` ${l.color}` : ""}`;
      const removals: [number, number][] = [];
      for (const a of acts) {
        try {
          if (a.kind === "set_sizes") {
            const l = d.groups[a.group]?.lines[a.line]; if (!l) continue;
            const sz = cleanSizes(a.sizes);
            l.sizes = a.mode === "add" ? Object.fromEntries([...new Set([...Object.keys(l.sizes || {}), ...Object.keys(sz)])].map((k) => [k, (+(l.sizes?.[k as Size] || 0)) + (+(sz[k as Size] || 0))])) as GLine["sizes"] : sz;
            done.push(`${name(l)}: ${sizesText(l.sizes)} (${lineQty(l)})`);
          } else if (a.kind === "add_line") {
            const g = d.groups[groupOf(a.group)];
            const l: GLine = { ...newGLine(), style: String(a.style || "").trim().toUpperCase(), brand: a.brand || "", color: String(a.color || "").trim(), sizes: cleanSizes(a.sizes) };
            fill(l);
            // the new group's empty first line is used rather than left blank
            const empty = g.lines.findIndex((x) => !x.style && !x.color && !lineQty(x));
            if (empty >= 0) g.lines[empty] = l; else g.lines.push(l);
            done.push(`Added ${name(l)}${l.garment ? ` (${l.garment})` : ""}: ${sizesText(l.sizes)} (${lineQty(l)})`);
          } else if (a.kind === "set_line") {
            const l = d.groups[a.group]?.lines[a.line]; if (!l) continue;
            const was = name(l);
            if (a.style) l.style = String(a.style).trim().toUpperCase();
            if (a.color != null) l.color = String(a.color).trim();
            if (a.style || a.color) fill(l);
            done.push(`${was} → ${name(l)}`);
          } else if (a.kind === "remove_line") {
            if (d.groups[a.group]?.lines[a.line]) { removals.push([a.group, a.line]); done.push(`Removed ${name(d.groups[a.group].lines[a.line])}`); }
          } else if (a.kind === "set_imprint") {
            const g = d.groups[groupOf(a.group)];
            const loc = String(a.location || "Full Front").trim();
            let im = g.imprints.find((x) => x.location.toLowerCase() === loc.toLowerCase());
            if (!im) { im = g.imprints.length === 1 && !g.imprints[0].design_id && !g.imprints[0].inks ? g.imprints[0] : undefined; if (im) im.location = loc; }
            if (!im) { im = newImprint(loc); g.imprints.push(im); }
            if (a.method && ["screen", "embroidery", "dtf"].includes(a.method)) im.method = a.method as Imprint["method"];
            if (a.colors != null && +a.colors >= 1) im.colors = Math.min(20, Math.round(+a.colors));
            if (a.inks != null) im.inks = String(a.inks);
            if (a.size != null) im.size = String(a.size);
            done.push(`${g.name || `Group ${d.groups.indexOf(g) + 1}`}: ${im.method} ${im.location}, ${im.colors} color${im.colors === 1 ? "" : "s"}${im.inks ? ` (${im.inks})` : ""}`);
          } else if (a.kind === "set_size_charge") {
            const ls = linesOf(a);
            for (const l of ls) {
              const m = { ...(l.sizeUpSet || {}) };
              for (const [z, v] of Object.entries(a.sizes || {})) { if (!(SIZES as readonly string[]).includes(z)) continue; if (v == null) delete m[z as Size]; else m[z as Size] = Math.max(0, Math.round(+v * 100) / 100); }
              l.sizeUpSet = Object.keys(m).length ? m : undefined;
            }
            done.push(`${Object.entries(a.sizes || {}).map(([z, v]) => (v == null ? `${z} back to automatic` : `${z} +${money(+v)} each`)).join(", ")} on ${ls.length === 1 ? name(ls[0]) : `${ls.length} lines`}`);
          } else if (a.kind === "set_price") {
            const ls = linesOf(a);
            for (const l of ls) { l.priceOverride = a.each == null ? null : Math.max(0, Math.round(+a.each * 100) / 100); if (l.prog) l.progOff = a.each != null; }
            done.push(`${a.each == null ? "Price list price" : `${money(+a.each)} each`} on ${ls.length === 1 ? name(ls[0]) : `${ls.length} lines`}`);
          } else if (a.kind === "add_fee") {
            d.fees.push({ label: String(a.label || "Fee").slice(0, 80), amount: Math.round(+a.amount * 100) / 100 || 0 });
            done.push(`Fee: ${a.label} ${money(+a.amount || 0)}`);
          } else if (a.kind === "set_discount") {
            if (a.type === "amt") { d.discount_type = "amt"; d.discount_amt = Math.max(0, +a.value || 0); } else { d.discount_type = "pct"; d.discount_pct = Math.max(0, Math.min(100, +a.value || 0)); }
            done.push(`Discount ${a.type === "amt" ? money(+a.value || 0) : `${+a.value || 0}%`}`);
          } else if (a.kind === "set_order") {
            if (a.nickname) { d.nickname = String(a.nickname).slice(0, 120); done.push(`Job name: ${d.nickname}`); }
            if (a.due_date && /^\d{4}-\d{2}-\d{2}$/.test(a.due_date)) { d.due_date = a.due_date; done.push(`In-hands date: ${a.due_date}`); }
            if (a.po_number) { d.po_number = String(a.po_number).slice(0, 60); done.push(`PO: ${d.po_number}`); }
            if (a.notes_append) { d.notes = [d.notes, String(a.notes_append)].filter(Boolean).join("\n"); done.push("Added to the notes"); }
            if (a.group_name && d.groups[a.group_name.group]) { d.groups[a.group_name.group].name = String(a.group_name.name).slice(0, 80); done.push(`Group renamed: ${a.group_name.name}`); }
          }
        } catch { /* one bad change doesn't stop the rest */ }
      }
      for (const [gi, li] of removals.sort((x, y) => y[0] - x[0] || y[1] - x[1])) { d.groups[gi].lines.splice(li, 1); if (!d.groups[gi].lines.length) d.groups[gi].lines.push(newGLine()); }
    });
    return done;
  }
  function undoHelper() {
    const b = helperUndo.current; if (!b) return false;
    helperUndo.current = null;
    patch((d) => { Object.assign(d, JSON.parse(JSON.stringify(b))); });
    return true;
  }

  /** take a group's mockup off the order so a new one can be made: the mockups are archived (never deleted) */
  async function removeMockup(gi: number) {
    if (!o) return;
    const g = o.groups[gi]; if (!g) return;
    let q = sb.from("mockups").update({ archived_at: new Date().toISOString() }).eq("order_id", o.id).is("archived_at", null);
    q = o.groups.length === 1 ? q.or(`group_id.eq.${g.id},group_id.is.null`) : q.eq("group_id", g.id);
    const { error } = await q;
    if (error) return say("Couldn't remove the mockup: " + error.message);
    patch((d) => { const x = d.groups[gi]; if (!x) return; delete x.mockupAt; delete x.mockupSkipped; x.mockupThumbs = []; });
    setArmed("");
    say("Mockup removed. Create mockup makes a new one.");
  }

  async function saveToCatalog(l: GLine) {
    const row = { style: l.style.trim(), brand: l.brand || "", description: l.garment, colors: l.color ? [l.color] : [], cost: +l.cost || 0 };
    const { data, error } = await sb.from("garments").insert(row).select("*").single();
    if (error) return say("Couldn't save to catalog: " + error.message);
    setCatalog((c) => [...c, data as Garment].sort((a, b) => a.style.localeCompare(b.style)));
    say(`${row.style} saved to your garment catalog.`);
  }

  async function addCustomer() {
    if (!newCust) return;
    if (!newCust.company.trim() && !newCust.name.trim()) return say("Enter a company or contact name.");
    const { account_owner: owner, ...pub } = newCust;
    const { data, error } = await sb.from("customers").insert({ ...pub, email: pub.email.trim().toLowerCase() }).select("*").single();
    if (error || !data) return say("Couldn't add customer: " + error?.message);
    // who owns the account, asked when the customer is made (Oct 26, Nick: "something in our customer intake")
    if (owner) await sb.from("customer_private").upsert({ customer_id: data.id, account_owner: owner });
    setCustomers((cs) => [...cs, data as Customer].sort((a, b) => custLabel(a).localeCompare(custLabel(b))));
    patch((d) => { d.customer_id = data.id; d.price_type = (data.price_type as PriceType) || "retail"; });
    setNewCust(null);
  }

  // art files (shop only)
  const [artUploading, setArtUploading] = useState(false);
  async function uploadArt(files: FileList | null) {
    if (!o || !files?.length) return;
    setArtUploading(true);
    for (const f of Array.from(files)) {
      const path = `art/${o.id}/${uid()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      const up = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (up.error) { say("Upload failed: " + up.error.message); continue; }
      await sb.from("art_files").insert({ order_id: o.id, name: f.name, file_path: path, file_type: f.type });
    }
    setArtUploading(false);
    loadSide();
  }
  async function delArt(a: ArtFile) {
    // only a file this order owns leaves storage (an old Printavo job's file or a logo stays for everyone else)
    const mine = ownedFiles(o?.id || "", [a.file_path]);
    if (mine.length) await sb.storage.from("proofs").remove(mine);
    await sb.from("art_files").delete().eq("id", a.id);
    loadSide();
  }
  const numOr = (v: string): number | "" => (v === "" ? "" : isNaN(+v) ? "" : +v);

  async function setStatus(k: StatusKey) {
    if (!o || o.status === k) return;
    await save();
    const { error } = await sb.from("orders").update({ status: k, type: ST[k].type }).eq("id", o.id);
    if (error) return say("Couldn't change status: " + error.message);
    await sb.from("order_events").insert({ order_id: o.id, kind: "status", detail: k, actor: "shop" });
    setO((p) => (p ? { ...p, status: k, type: ST[k].type } : p));
    if (latest.current) latest.current = { ...latest.current, status: k, type: ST[k].type };
    loadSide();
  }

  const [accepting, setAccepting] = useState<string | null>(null), [acceptBusy, setAcceptBusy] = useState(false);
  const [acceptMode, setAcceptMode] = useState<"as_is" | "changes">("as_is");
  async function accept() {
    if (!o || accepting == null) return;
    setAcceptBusy(true);
    await save();
    const r = await acceptRequest(o.id, accepting, acceptMode);
    setAcceptBusy(false);
    if (!r.ok) return say(r.error || "Couldn't accept it.");
    setAccepting(null);
    const st = ("status" in r && r.status ? r.status : "approved") as Order["status"];
    setO((p) => (p ? { ...p, status: st, type: "invoice" } : p));
    // with changes: straight to the mockup to change it, then send the proof from the order
    if (acceptMode === "changes") { const g = o.groups.find((x) => x.fromMockup || x.mockupAt) || o.groups[0]; if (g) { router.push(mockupHref(o.id, g)); return; } }
    say(r.warn ? `Accepted. The message didn't send: ${r.warn}` : st === "production" ? "Accepted: In production (their goods are here)." : st === "blanks" ? "Accepted: Waiting on goods." : "Accepted.");
    loadSide();
  }

  const [recover, setRecover] = useState<{ at: number; o: Order } | null>(null);
  // a simple order from the portal: Create order (the one tool) reads their answers and files and fills this order in
  const [simpleAct, setSimpleAct] = useState<{ id: string; text: string } | null>(null);
  const [simpleBusy, setSimpleBusy] = useState("");
  const buildSimple = async () => {
    setSimpleBusy("Bringing in what they sent…");
    if (!o) return;
    const r = await simpleOrderActivity(o.id);
    setSimpleBusy(r.ok ? "" : r.error);
    if (r.ok) setSimpleAct({ id: r.activityId, text: r.text });
  };
  // ---- drafts: Save gives it its number; Discard sets it aside (never deleted; it never had a number) ----
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  async function commitDraft() {
    if (!o) return false;
    if (timer.current) await save();
    const { data, error } = await sb.rpc("order_commit", { p_id: o.id });
    if (error) { say(error.message); return false; }
    setO((p) => (p ? { ...p, draft: false, number: Number(data) || p.number } : p));
    say(`Saved as #${data}.`);
    return true;
  }
  async function discardDraft(to = "/shop/orders") {
    if (!o) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const { error } = await sb.rpc("order_discard", { p_id: o.id });
    if (error) return say(error.message);
    router.push(to);
  }
  // leaving a draft asks first (links and menus; a refresh keeps it, it's saved as you go)
  useEffect(() => {
    if (!o?.draft) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const u = new URL(a.href, location.href);
      if (u.origin !== location.origin || u.pathname === location.pathname) return;
      e.preventDefault(); e.stopPropagation();
      setLeaveTo(u.pathname + u.search);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [o?.draft]);

  // before Send to customer opens: the draft saved and the order checked (the inks match each print's colors)
  async function beforeSend() {
    if (!o) return false;
    if (o.draft && !(await commitDraft())) return false;
    const bad = (o.groups || []).flatMap((g) => g.imprints).find((d) => (d.method === "embroidery" || (d.method === "screen" && d.colors < 11)) && d.inks.trim() && d.inks.split(/[,;/+]|\s&\s/).map((x) => x.trim()).filter(Boolean).length !== d.colors);
    if (bad) { say(`${bad.location || "An imprint"}: the inks listed don't match its number of colors. Fix that before sending.`); return false; }
    await save();
    return true;
  }
  async function afterSend(m: string) {
    say(m);
    if (!o) return;
    const { data } = await sb.from("orders").select("status, sent_at").eq("id", o.id).maybeSingle();
    if (data) setO((p) => (p ? { ...p, status: data.status, sent_at: data.sent_at } : p));
    loadSide();
  }

  async function send() {
    if (!o) return;
    if (o.draft && !(await commitDraft())) return;
    const bad = (o.groups || []).flatMap((g) => g.imprints).find((d) => (d.method === "embroidery" || (d.method === "screen" && d.colors < 11)) && d.inks.trim() && d.inks.split(/[,;/+]|\s&\s/).map((x) => x.trim()).filter(Boolean).length !== d.colors);
    if (bad) return say(`${bad.location || "An imprint"}: the inks listed don't match its number of colors. Fix that before sending.`);
    const note = (document.getElementById("send-note") as HTMLTextAreaElement | null)?.value || "";
    await save();
    const r = await sendToCustomer(o.id, note);
    if (!r.ok) return say(r.error || "Couldn't send");
    if (o.status === "quote" || o.status === "request") setO((p) => (p ? { ...p, status: "quote_sent", sent_at: new Date().toISOString() } : p));
    say(r.emailed ? "Emailed the customer a link to their portal." : "Published to their portal. Email is off, so copy the link below and send it.");
    loadSide();
  }

  // Duplicate = a reorder of this order (Oct 20, Nick: "make a duplicate… a complete copy… keeps all the details",
  // "it needs to keep that art… that's how we're going to… have it in our system as, oh look, Terrible Toddler, it's
  // been ordered these 5 times"): every group kept whole, with its designs, our mockups and their history, the same
  // job name; the sizes and price are updated on the copy. A wholesale copy offers the reprint screen fee.
  async function duplicate() {
    if (!o) return;
    await save();
    const copyGroup = (g: Group): Group => { const c = JSON.parse(JSON.stringify(g)) as Group; return { ...c, id: uid(), fromGroup: g.id, lines: c.lines.map((l) => ({ ...l, id: uid() })), imprints: c.imprints.map((d) => ({ ...d, id: uid() })) }; };
    const groups = o.groups.map(copyGroup);
    const { data, error } = await sb.from("orders").insert({
      customer_id: o.customer_id, nickname: o.nickname || "Job", groups, fees: o.fees, po_number: "",
      delivery_method: o.delivery_method, ship_to: o.ship_to, ship_method: o.ship_method, third_party: o.third_party || null, price_type: o.price_type,
      discount_pct: o.discount_pct, discount_amt: o.discount_amt || 0, discount_type: o.discount_type || "pct", tax_exempt: o.tax_exempt, tax_rate: o.tax_rate, waive_setup: false, notes: o.notes, total: o.total, qty: o.qty,
    }).select("id").single();
    if (error || !data) return say("Couldn't duplicate: " + error?.message);
    // our mockups come with it: the latest of each group, so the copy shows them and nothing is made again
    const { data: olds } = await sb.from("mockups").select("customer_id, group_id, title, file_path, design_ids, snapshot, created_at").eq("order_id", o.id).is("archived_at", null).order("created_at", { ascending: false });
    const { data: u } = await sb.auth.getUser();
    for (const g of groups) {
      const m = (olds || []).find((x) => x.group_id === g.fromGroup);
      if (m) await sb.from("mockups").insert({ customer_id: m.customer_id, order_id: data.id, group_id: g.id, proof_id: null, title: m.title, file_path: m.file_path, design_ids: m.design_ids || [], created_by: u.user?.email || "", snapshot: m.snapshot });
    }
    await sb.from("order_events").insert({ order_id: data.id, kind: "reorder", detail: `Duplicate of #${o.number}`, actor: u.user?.email || "" });
    const reprint = o.price_type === "wholesale" && groups.some((g) => g.imprints.some((im) => im.method === "screen" && !(im.remake ?? g.remake)));
    router.push(`/shop/orders/${data.id}${reprint ? "?reprint=1" : ""}`);
  }

  // Delete asks first, showing the art that goes with the order (Oct 17, Nick: "when we delete an order can we delete
  // the art that goes with it"): the drafts made for it and its mockups are ticked, library logos are offered unticked,
  // and a logo another order uses is never taken. Taken off = archived (kept, can be put back).
  // the ClickUp job it was made from: put back on the New list (ticked), so deleting the order doesn't lose the job
  // (Oct 22, Nick: Hudson Band was made into an order, deleted, and gone from New)
  // in QuickBooks: asked before deleting (Oct 24, Nick: "this order has already been synced… would you like me to void the
  // order in QuickBooks?"); qbVoid = the yes
  type QbState = { synced: boolean; voided: boolean; qboId?: string; docNumber?: string; source?: string; issue?: string; pending?: boolean };
  const [delAsk, setDelAsk] = useState<null | { loading?: boolean; error?: string; logos: ArtItem[]; mockups: ArtItem[]; pick: Set<string>; busy?: boolean; cu?: { id: string; name: string; team: string } | null; cuBack?: boolean; gone?: boolean; qb?: QbState | null; qbVoid?: boolean }>(null);
  // the small QB ✓ beside the status: is this order's invoice in QuickBooks
  const [qbSt, setQbSt] = useState<QbState | null>(null);
  // an invoice also asks QuickBooks itself, so one sent before orders kept their link (TEST-40135) is found and linked
  // asked again after each save (a change turns it yellow until it syncs), and every minute while the page is open
  const [qbMenu, setQbMenu] = useState(false), [qbBusy, setQbBusy] = useState(false), [qbNote, setQbNote] = useState("");
  async function qbSync() {
    if (!o) return;
    setQbBusy(true);
    const r = await qboSyncOrder(o.id).catch((e) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    setQbBusy(false); setQbMenu(false);
    // no message: the color says it (Oct 24, Nick: "I don't need that little pop-up… just go through the colors"); a
    // sync that couldn't run shows its reason on hover
    setQbNote(r.ok ? "" : r.message);
    qboOrderState(o.id).then((x) => setQbSt(x.ok ? x : null), () => null);
  }
  useEffect(() => { if (!qbMenu) return; const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.(".qb-wrap")) setQbMenu(false); }; document.addEventListener("click", h); return () => document.removeEventListener("click", h); }, [qbMenu]);
  const qbDeep = useRef("");
  useEffect(() => {
    if (!o?.id) return;
    const ask = () => { const deep = o.type === "invoice" && qbDeep.current !== o.id; if (deep) qbDeep.current = o.id; qboOrderState(o.id, deep).then((r) => setQbSt(r.ok ? r : null), () => null); };
    const t0 = setTimeout(ask, 1500); // after the save's queue row is written
    const t = setInterval(ask, 30000);
    // coming back to the tab (after Sync now on the QuickBooks page) asks again right away
    const back = () => { if (document.visibilityState === "visible") ask(); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { clearTimeout(t0); clearInterval(t); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [o?.id, o?.type, o?.status, saveState]); // eslint-disable-line react-hooks/exhaustive-deps
  async function del() {
    if (!o) return;
    setDelAsk({ loading: true, logos: [], mockups: [], pick: new Set() });
    const [r, cu, qs] = await Promise.all([orderArtForDelete(o.id), clickUpJobOfOrder(o.id, o.number).catch(() => null), qboOrderState(o.id, true).catch(() => null)]);
    const qb: QbState | null = qs && qs.ok ? qs : null;
    const qbVoid = !!qb?.synced && !qb.voided && (qb.source === "created" || qb.source === "test");
    if (!r.ok) return setDelAsk({ error: r.error, logos: [], mockups: [], pick: new Set(), cu, cuBack: true, qb, qbVoid });
    const pick = new Set<string>([...r.logos.filter((l) => l.draft && !l.elsewhere).map((l) => l.id), ...r.mockups.map((m) => m.id)]);
    setDelAsk({ logos: r.logos, mockups: r.mockups, pick, cu, cuBack: true, qb, qbVoid });
  }
  async function confirmDel() {
    if (!o || !delAsk) return;
    setDelAsk({ ...delAsk, busy: true });
    // void it in QuickBooks first; if that fails, nothing is deleted
    if (delAsk.qbVoid) {
      const v = await voidOrderInQbo(o.id);
      if (!v.ok) { setDelAsk({ ...delAsk, busy: false, error: `Couldn't void it in QuickBooks: ${v.message} The order wasn't deleted.` }); return; }
    }
    const lg = delAsk.logos.filter((l) => delAsk.pick.has(l.id) && !l.elsewhere).map((l) => l.id), mk = delAsk.mockups.filter((m) => delAsk.pick.has(m.id)).map((m) => m.id);
    if (lg.length || mk.length) { const r = await archiveOrderArt(o.id, lg, mk); if (!r.ok) { setDelAsk({ ...delAsk, busy: false, error: r.error }); return; } }
    // the order goes first; the ClickUp job goes back on New only once it's really gone (else it could be made twice)
    const gone = await reallyDel(false);
    if (!gone) { setDelAsk({ ...delAsk, busy: false, qbVoid: false, error: `Couldn't delete the order${delErr.current ? `: ${delErr.current}` : "."}${delAsk.qbVoid ? " (It was already voided in QuickBooks.)" : ""} Nothing else was changed in ClickUp.` }); return; }
    if (delAsk.cu && delAsk.cuBack) {
      const r = await reopenClickUpJob(delAsk.cu.id).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
      const say2 = !r.ok ? `Order deleted, but the ClickUp job couldn't be put back on New: ${r.error}` : "note" in r && r.note ? `Order deleted and the job is back on New. ${r.note}` : "";
      if (say2) { setDelAsk({ ...delAsk, busy: false, gone: true, error: say2 }); return; }
    }
    leave();
  }
  const leave = () => {
    if (!o) return;
    // made from a ClickUp job: back to ClickUp Jobs (Oct 23, Nick: deleting an order to remake it "goes back to a blank
    // mock-up screen. Should either go home or back to the ClickUp screen it was on before it started the order creator")
    if (delAsk?.cu) { location.assign("/shop/clickup"); return; }
    // back to wherever it was opened from (the customer's page, the orders list…), but never to the Mockup Creator or
    // this order's own pages; else the email it was made from, else the customer
    let ref: URL | null = null;
    try { ref = document.referrer ? new URL(document.referrer) : null; } catch { ref = null; }
    const okBack = !!ref && ref.origin === location.origin && !ref.pathname.startsWith("/shop/artwork/mockup") && !ref.pathname.startsWith(`/shop/orders/${o.id}`);
    if (okBack && window.history.length > 1) router.back();
    else if (new URLSearchParams(location.search).get("email") || o.source === "email") router.replace("/shop/inbox");
    else router.replace(o.customer_id ? `/shop/customers/${o.customer_id}` : "/shop/orders");
  };
  // this order's art that's still a draft (not in the customer's library until the order goes out)
  const [drafts, setDrafts] = useState({ logos: 0, mockups: 0 });
  useEffect(() => { if (o?.id) draftArtCount(o.id).then((r) => setDrafts({ logos: r.logos, mockups: r.mockups })); }, [o?.id, o?.status]);
  async function keepDrafts() {
    if (!o) return;
    const r = await keepOrderArt(o.id);
    if (!r.ok) return say(r.error || "Couldn't keep the art.");
    setDrafts({ logos: 0, mockups: 0 });
    say("The art is in the customer's library now.");
  }
  const delErr = useRef("");
  async function reallyDel(go = true): Promise<boolean> {
    if (!o) return false;
    if (timer.current) clearTimeout(timer.current);
    latest.current = null;
    const paths = ownedFiles(o.id, [...proofs.map((p) => p.file_path), ...art.map((a) => a.file_path)]);
    if (paths.length) await sb.storage.from("proofs").remove(paths);
    const { error } = await sb.from("orders").delete().eq("id", o.id);
    if (error) { delErr.current = error.message; say("Couldn't delete: " + error.message); return false; }
    if (go) leave();
    return true;
  }

  // payments
  const [payAmt, setPayAmt] = useState("");
  const [payMethod, setPayMethod] = useState("Card");
  const [payDate, setPayDate] = useState(todayISO());
  async function addPayment() {
    if (!o || !+payAmt) return say("Enter a payment amount.");
    const { error } = await sb.from("payments").insert({ order_id: o.id, amount: Math.round(+payAmt * 100) / 100, method: payMethod, paid_on: payDate || todayISO() });
    if (error) return say(error.message);
    await sb.from("order_events").insert({ order_id: o.id, kind: "payment", detail: `${money(+payAmt)} ${payMethod}`, actor: "shop" });
    setPayAmt("");
    loadSide();
  }
  async function delPayment(pid: string) {
    if (armed !== "pay" + pid) return arm("pay" + pid);
    await sb.from("payments").delete().eq("id", pid);
    loadSide();
  }

  // proofs
  const [uploading, setUploading] = useState(false);
  const [proofTitle, setProofTitle] = useState("");
  async function upload(files: FileList | null) {
    if (!o || !files?.length) return;
    setUploading(true);
    for (const f of Array.from(files)) {
      const path = `${o.id}/${uid()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      const up = await sb.storage.from("proofs").upload(path, f, { contentType: f.type, upsert: false });
      if (up.error) { say("Upload failed: " + up.error.message); continue; }
      await sb.from("proofs").insert({ order_id: o.id, title: proofTitle || f.name.replace(/\.[^.]+$/, ""), file_path: path, file_type: f.type });
    }
    setProofTitle("");
    setUploading(false);
    loadSide();
  }
  async function delProof(p: Proof) {
    if (armed !== "proof" + p.id) return arm("proof" + p.id);
    await sb.storage.from("proofs").remove([p.file_path]);
    await sb.from("proofs").delete().eq("id", p.id);
    loadSide();
  }
  async function askProofs() {
    if (!o) return;
    const r = await requestProofApproval(o.id);
    say(!r.ok ? r.error || "Couldn't send" : r.emailed ? "Emailed the customer to review the proofs." : "Proofs are in their portal. Email is off, so send them the portal link.");
    loadSide();
  }

  // messages
  const [draftMsg, setDraftMsg] = useState("");
  async function postMessage() {
    if (!o || !draftMsg.trim()) return;
    const r = await staffMessage(o.id, draftMsg);
    if (!r.ok) return say(r.error || "Couldn't send");
    setDraftMsg("");
    loadSide();
  }

  // saved as you type (Oct 23, Nick: "the production notes aren't saving… I've tried to delete this like 3 times"): the
  // save was built but never sent (a Supabase query only runs once it's awaited), so nothing typed here was kept
  const [noteState, setNoteState] = useState("");
  const notesPending = useRef<string | null>(null);
  const flushNotes = useCallback(async () => {
    const v = notesPending.current; if (v === null) return;
    notesPending.current = null;
    if (notesTimer.current) { clearTimeout(notesTimer.current); notesTimer.current = null; }
    setNoteState("Saving…");
    const { error } = await sb.from("order_internal").upsert({ order_id: id, production_notes: v });
    setNoteState(error ? "Couldn't save: " + error.message : "Saved");
  }, [sb, id]);
  function onProdNotes(v: string) {
    setProdNotes(v); notesPending.current = v; setNoteState("Not saved yet…");
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => { void flushNotes(); }, 700);
  }
  useEffect(() => () => { void flushNotes(); }, [flushNotes]);

  useEffect(() => {
    if (!o?.id || o.price_type !== "wholesale") { setGoodsSt(null); return; }
    sb.from("order_goods").select("status, updated_by").eq("order_id", o.id).maybeSingle().then(({ data }) => setGoodsSt((data as { status: string; updated_by: string | null } | null) || null), () => setGoodsSt(null));
  }, [o?.id, o?.price_type]); // eslint-disable-line react-hooks/exhaustive-deps

  if (missing) return <><BackLink href="/shop/orders" label="Orders" /><div className="empty">This order was deleted or doesn&apos;t exist.</div></>;
  if (!o || !calc) return <div className="empty">Loading…</div>;

  const st = ST[o.status] || ST.quote;
  const cust = customers.find((c) => c.id === o.customer_id);
  const portalLink = typeof window !== "undefined" ? `${SITE_URL || window.location.origin}/portal/orders/${o.id}` : "";
  const pendingProofs = proofs.filter((p) => p.status === "pending").length;
  const checks = checkOrder(o, calc, cust, proofs);
  // Printavo's setup adjustment shows as part of setup in Totals (Oct 21, Nick: order page cleanup); it stays its own fee
  const adjFee = o.fees.filter((f) => f.label === ADJUST).reduce((t, f) => t + (+f.amount || 0), 0);
  // where the job stands, for Order check (Oct 15, Nick: "we're on time, goods have been received, art looks good,
  // approved by customer… big bullet points")
  const status: StatusLine[] = (() => {
    const out: StatusLine[] = [];
    const day = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const done = o.status === "completed";
    const isQuote = o.type === "quote";
    // on time
    if (done) out.push({ tone: "ok", text: "Done", sub: o.completed_at ? `Completed ${fmtDate(o.completed_at.slice(0, 10))}` : undefined });
    else if (!o.due_date) out.push({ tone: "wait", text: "No in-hands date yet" });
    else {
      const n = Math.round((new Date(o.due_date + "T12:00:00").getTime() - new Date(new Date().toDateString()).getTime()) / 864e5);
      const ready = o.status === "ready";
      out.push(n < 0 && !ready ? { tone: "bad", text: `Late: due ${day(o.due_date)}`, sub: `${-n} day${n === -1 ? "" : "s"} past the in-hands date` }
        : { tone: "ok", text: ready ? "Ready on time" : "On time", sub: `In hands ${day(o.due_date)}${n === 0 ? " (today)" : n === 1 ? " (tomorrow)" : n > 1 ? ` (${n} days)` : ""}` });
    }
    // goods
    if (o.price_type === "wholesale") {
      const g = goodsSt?.status || "waiting", pv = goodsSt?.updated_by === "Printavo" ? " in Printavo" : "";
      out.push(g === "received" ? { tone: "ok", text: "Goods received" + pv } : g === "issue" ? { tone: "bad", text: "Problem with the goods" }
        : g === "partial" ? { tone: "wait", text: "Goods partly here" + pv } : g === "arrived" ? { tone: "wait", text: "Goods here, checking in" } : { tone: isQuote ? "info" : "wait", text: g === "on_way" ? "Goods on the way" : "Waiting on the customer's goods" });
    } else if (!isQuote) out.push(["blanks", "production", "ready", "completed"].includes(o.status) ? { tone: "ok", text: "Garments ordered" } : { tone: "wait", text: "Garments not ordered yet" });
    // art
    const ap = proofs.filter((p) => p.status === "approved").length, ch = proofs.filter((p) => p.status === "changes").length;
    const mock = o.groups.length > 0 && o.groups.every((g) => g.mockupAt || g.mockupSkipped || (g.customerMockups || []).length || g.imprints.some((d) => d.supplied?.picture));
    // approved by staff another way (a call, an email: Request separations' "approved another way"), or a Printavo job past art
    const staffArt = events.find((e) => e.kind === "art_approved");
    const pvPast = !!pvStatusOf(o as never) && ["blanks", "production", "ready", "completed"].includes(o.status);
    out.push(ch ? { tone: "bad", text: "Art changes asked for" } : ap ? { tone: "ok", text: "Art approved" } : staffArt ? { tone: "ok", text: "Art approved", sub: staffArt.detail || undefined } : pvPast ? { tone: "ok", text: "Art approved", sub: "In Printavo" } : pendingProofs ? { tone: "wait", text: "Proof waiting on the customer" }
      : mock ? { tone: isQuote ? "info" : "ok", text: "Mockup done", sub: isQuote ? undefined : "No proof sent" } : { tone: "wait", text: "No mockup yet" });
    // approval
    out.push(o.approved_at ? { tone: "ok", text: `Approved by ${o.approved_name || "the customer"}`, sub: fmtDate(o.approved_at.slice(0, 10)) }
      : !isQuote ? { tone: "ok", text: "Approved", sub: pvStatusOf(o as never) ? "In Printavo as an invoice" : "Invoice" }
      : o.status === "quote_sent" ? { tone: "wait", text: "Waiting on the customer's approval" } : { tone: "info", text: "Quote not sent yet" });
    // paid
    if (seesMoney && calc.total > 0) out.push(calc.balance <= 0.004 ? { tone: "ok", text: "Paid in full" } : calc.paid > 0 ? { tone: "wait", text: `${money(calc.balance)} still due`, sub: `${money(calc.paid)} paid` } : { tone: isQuote ? "info" : "wait", text: `${money(calc.balance)} due`, sub: "Nothing paid yet" });
    return out;
  })();
  const tv = { first: firstName(cust?.name), number: o.number, job: o.nickname ? `"${o.nickname}"` : "your order", total: money(calc.total), balance: money(calc.balance),
    due: o.due_date ? fmtDateLong(o.due_date) : "", tracking: o.tracking || "", days: "", dueLine: "", dueText: "", balanceLine: calc.balance > 0.004 ? ` The balance is ${money(calc.balance)}.` : "" };
  const QUICK: TemplateKey[] = ["proof_ready", "ready_pickup", "shipped", "payment_reminder", "deposit_request", "quote_followup", "request_received", "thanks"];

  return (
    <div className="ord">
      {/* back to where you came from (Oct 23, Nick: "it's just supposed to go from wherever you were last… I was in the
          order screen, so it should go back to the order screen"): the page before this one in the tab's trail, the email
          (in Email, not Conversations) only when that's where you were or the order was opened on its own */}
      {/* the back arrow beside the title (Oct 29, Nick: option A), saving first when it goes back to where you came from */}
      {backTo
        ? <BackLink href={backTo.url} label={/^\/shop\/(inbox|conversations)/.test(backTo.path) ? "the email" : backTo.label} saves go={async () => { if (timer.current) await save(); router.push(backTo.url); }} />
        : fromEmail
        ? <BackLink href={`/shop/inbox?open=${fromEmail}`} label="the email" saves go={async () => { if (timer.current) await save(); router.push(`/shop/inbox?open=${fromEmail}`); }} />
        : <BackLink href="/shop/orders" label="Orders" />}
      {/* a draft (Oct 24, Nick: "only assign a number… once it's either saved, sent… if they click not, then it exits,
          nothing happens to it"): every change is kept as you go, but it's not an order until it's saved or sent */}
      {o.draft && (
        <div className="draft-bar" role="status">
          <span><b>Draft.</b> Your changes are kept as you go, but this isn&apos;t an order yet: no number, not in any list.</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={() => void discardDraft()}>Discard</button>
          <button type="button" className="btn primary" onClick={() => void commitDraft()}>Save</button>
        </div>
      )}
      {(o as Order & { simple_order?: unknown }).simple_order != null && o.status === "request" && (() => {
        const so = (o as Order & { simple_order: { about?: string; qty?: number | null; garments?: string; method?: string; files?: { name: string }[] } }).simple_order;
        return (
          <div className="draft-bar" role="status">
            <span><b>Simple order{so.method ? ` (${({ screen: "screen printing", embroidery: "embroidery", transfer: "transfers", mixed: "mixed" } as Record<string, string>)[so.method] || so.method})` : ""}.</b> They sent the details instead of filling in the form{so.qty ? ` (about ${so.qty} pcs)` : ""}{so.files?.length ? `, with ${so.files.length} file${so.files.length === 1 ? "" : "s"}` : ""}.{so.about ? <> &ldquo;{so.about.slice(0, 220)}{so.about.length > 220 ? "…" : ""}&rdquo;</> : null}{so.garments ? <> Garments: {so.garments.slice(0, 120)}</> : null}{simpleBusy ? <> <i>{simpleBusy}</i></> : null}</span>
            <span className="spacer" />
            <button type="button" className="btn primary" disabled={!!simpleBusy && simpleBusy.endsWith("…")} onClick={() => void buildSimple()}>Build it with Create order</button>
          </div>
        );
      })()}
      {digitize != null && o && <DigitizerTool orderId={o.id} imprintId={digitize || undefined} onClose={() => setDigitize(null)} />}
      {simpleAct && <CreateOrderTool activityId={simpleAct.id} text={simpleAct.text} guess="new" onClose={() => setSimpleAct(null)} onCreated={() => { setSimpleAct(null); window.location.reload(); }} />}
      {(o as Order & { cancel_requested_at?: string | null }).cancel_requested_at && (
        <div className="draft-bar" role="alert">
          <span><b>The customer asked to cancel</b> ({(o as Order & { cancel_reason?: string }).cancel_reason || "no reason given"}) on {new Date(String((o as Order & { cancel_requested_at?: string | null }).cancel_requested_at)).toLocaleDateString()}. Their note is in Messages; reply there and change the status if you cancel it.</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={() => setTab("msg")}>Open Messages</button>
        </div>
      )}
      {recover && (
        <div className="draft-bar" role="alert">
          <span><b>Unsaved changes found.</b> Changes from {new Date(recover.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} didn&apos;t reach the server (the connection may have dropped). Bring them back?</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={() => { try { localStorage.removeItem(`fbs:unsaved:${o.id}`); } catch { /* off */ } setRecover(null); }}>Throw them away</button>
          <button type="button" className="btn primary" onClick={() => { const r = recover; setRecover(null); patch((d) => { Object.assign(d, { ...r.o, id: d.id, number: d.number, draft: d.draft, status: d.status, type: d.type }); }); }}>Bring them back</button>
        </div>
      )}
      {leaveTo && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Save this draft?" onClick={() => setLeaveTo(null)}>
          <div className="dla" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3>Save this draft?</h3>
            <p className="dla-sub">It isn&apos;t an order yet. Save it to give it a number and put it in your lists, or discard it and nothing is kept.</p>
            <div className="dla-acts">
              <button type="button" className="btn ghost" onClick={() => setLeaveTo(null)}>Keep editing</button>
              <button type="button" className="btn ghost danger" onClick={async () => { const to = leaveTo; setLeaveTo(null); await discardDraft(to); }}>Discard</button>
              <button type="button" className="btn primary" autoFocus onClick={async () => { const to = leaveTo; setLeaveTo(null); if (await commitDraft()) router.push(to); }}>Save</button>
            </div>
          </div>
        </div>
      )}
      <div className="ed-head" style={{ marginTop: 8 }}>
        <div className="ed-title">
          <h1>{o.nickname || "Untitled Job"}{o.draft ? <span className="ot-no ot-draft"> – Draft, not saved</span> : <span className="ot-no"> – #{o.number}</span>}{o.rush && <span className="rush">RUSH</span>}{o.firm && <span className="rush firm">FIRM{o.due_date ? ` ${new Date(o.due_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}` : ""}{o.due_time != null ? ` ${((Math.floor(o.due_time / 60) + 11) % 12) + 1}:${String(o.due_time % 60).padStart(2, "0")}${o.due_time >= 720 ? "p" : "a"}` : ""}</span>}</h1>
        </div>
        <div className={"ed-actions" + (actsOpen ? " open" : "")}>
          {/* the order's top buttons (Oct 21, Nick): status first, then Ask AI, then Documents and Production menus, More */}
          {/* a 40,000 job sent to Printavo: its status is Printavo's and is changed there (Oct 15, Nick: "just have it mirror back") */}
          {/* QuickBooks, beside the status (Oct 24, Nick: "grayed out… it's a quote… not available yet to sync. Once it goes
              to invoice and it's ready to be synced but not synced yet, yellow. Once it's synced, green. If it has an issue,
              red") */}
          {(() => {
            const inv = o.type === "invoice";
            const changed = !!qbSt?.synced && !qbSt.voided && !!qbSt.pending;
            const k = qbSt?.issue ? "bad" : qbSt?.voided ? "void" : changed ? "wait" : qbSt?.synced ? "ok" : inv ? "wait" : "off";
            const tip = k === "bad" ? `Didn't sync to QuickBooks: ${qbSt!.issue}` : k === "void" ? `Voided in QuickBooks${qbSt!.docNumber ? ` (invoice ${qbSt!.docNumber})` : ""}` : k === "ok" ? `Synced to QuickBooks${qbSt!.docNumber ? ` (invoice ${qbSt!.docNumber}${qbSt!.source === "test" ? ", a test" : ""})` : ""}` : k === "wait" ? (changed ? `Changed since it went to QuickBooks${qbSt!.docNumber ? ` (invoice ${qbSt!.docNumber})` : ""}: waiting to sync` : "Not synced to QuickBooks yet") : "A quote: quotes don't sync to QuickBooks";
            // just the QB mark, in its color (Oct 24, Nick: "remove the check mark… just use the QB logo and the color
            // coordination… when you hover over it, it should say the status")
            // right-click: Sync now, this order only (Oct 24, Nick: "right click the QB thing at the top… sync now… it'll force
            // it to sync that invoice")
            return <span className="qb-wrap">
              <span className={"qb-tick qb-" + k + (qbBusy ? " busy" : "")} title={`${tip}.${qbNote ? ` Last Sync now: ${qbNote}` : ""} Right-click to sync now.`} aria-label={tip} role="img" onContextMenu={(e) => { e.preventDefault(); setQbMenu(true); }}><QbMark /></span>
              {qbMenu && <span className="qb-menu" role="menu" onMouseLeave={() => setQbMenu(false)}>
                <button type="button" role="menuitem" disabled={qbBusy || !inv} onClick={() => void qbSync()}>{qbBusy ? "Syncing…" : inv ? "Sync now" : "Quotes don't sync"}</button>
                <a role="menuitem" href="/shop/settings/quickbooks">QuickBooks settings</a>
              </span>}
            </span>;
          })()}
          {pvStatusOf(o as never) ? <span className="status-select pv-st" style={{ ["--sc" as string]: st.c }} title="This job is run from Printavo: change its status there and it shows here within a few minutes">{pvStatusOf(o as never)}<small>Printavo</small></span>
          : <select className="status-select" style={{ ["--sc" as string]: st.c }} aria-label="Status" value={o.status} onChange={(e) => setStatus(e.target.value as StatusKey)}>
            <optgroup label="Quote">{STATUSES.filter((s) => s.type === "quote").map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</optgroup>
            <optgroup label="Invoice">{STATUSES.filter((s) => s.type === "invoice").map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</optgroup>
          </select>}
          {/* phone only: Ask AI, Documents, Production, QuickBooks, Send to Printavo and More behind one button */}
          <button type="button" className="btn ed-acts-tog" aria-expanded={actsOpen} onClick={() => setActsOpen((v) => !v)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
            {actsOpen ? "Close" : "Actions"}
          </button>
          <span className="ed-br" aria-hidden />
          <OrderHelper orderId={o.id} snapshot={helperSnapshot} apply={applyHelper} undo={undoHelper} onChat={async () => { await save(); openOrderCheck(o.id); }}
            onDigitize={orderGroups(o).some((g) => g.imprints.some((d) => d.method === "embroidery" && d.design_id)) ? async () => { await save(); setDigitize(""); } : undefined} />
          <details className="ot-more" onBlur={closeSoon}>
            <summary className="btn">Documents ▾</summary>
            <div className="ot-menu">
              <a href={`/print/${o.id}`} target="_blank" rel="noreferrer"><MenuItem icon="invoice" tone="blue" title={o.type === "quote" ? "Quote PDF" : "Invoice PDF"} sub="Prices, totals and balance" /></a>
              <a href={`/print/${o.id}?proof=1`} target="_blank" rel="noreferrer" title="The art proof for the customer to approve: every mockup big, each print up close with its size and inks"><MenuItem icon="proof" tone="salmon" title="Proof PDF" sub="Mockups for the customer to approve" /></a>
              <a href={`/print/${o.id}?work=1`} target="_blank" rel="noreferrer"><MenuItem icon="clipboard" tone="orange" title="Work order" sub="What the press crew runs from" /></a>
            </div>
          </details>
          <details className="ot-more" onBlur={closeSoon}>
            <summary className="btn">Production ▾</summary>
            <div className="ot-menu">
              {prodRole && <Link href={`/shop/orders/${o.id}/production`} title="The mockup as production prints it: confirm the real size, placement, inks and screens, and see what we did last time"><MenuItem icon="press" tone="violet" title="Production mockup" sub="Confirm size, placement and inks" /></Link>}
              <a href={`/print/${o.id}?work=1`} target="_blank" rel="noreferrer"><MenuItem icon="clipboard" tone="orange" title="Work order" sub="What the press crew runs from" /></a>
              <a href={`/print/${o.id}/labels`} target="_blank" rel="noreferrer"><MenuItem icon="label" tone="green" title="Box labels" sub="Print the labels for the boxes" /></a>
              <a href={`/j/${o.number}`} target="_blank" rel="noreferrer" title="The job's phone menu (what scanning the QR code opens)"><MenuItem icon="phone" tone="blue" title="Phone menu" sub="What scanning the QR code opens" /></a>
            </div>
          </details>
          {/* a draft too (Oct 27, Nick: "we lost the send to Printavo button"): sending saves it first, which gives it its
              40,000-series number */}
          {(o.draft || (o.number >= 40000 && o.number < 50000)) && !(o as Order & { printavo_id?: string | null }).printavo_id && !(cust && needsMove(cust as unknown as Record<string, unknown>)) &&
            <SendToPrintavo orderId={o.id} onSaved={o.draft ? commitDraft : save} onSent={(r) => setO((x) => (x ? ({ ...x, printavo_id: "sent", printavo_visual_id: r.visualId, printavo_state: { url: r.url, publicUrl: r.publicUrl, status: r.status } } as Order) : x))} />}
          {/* Send to customer: the proof, the quote, the sew-outs, one email (components/tools/SendProofTool.tsx) */}
          {o.status === "quote" && <SendProofTool target={{ kind: "order", orderId: o.id }} label="Send to customer" before={beforeSend} onDone={afterSend} />}
          {o.type === "quote" && !pvStatusOf(o as never) && <button className="btn" type="button" onClick={() => setStatus("approved")}>Convert to invoice</button>}
          <details className="ot-more" onBlur={closeSoon}>
            <summary className="btn">More ▾</summary>
            <div className="ot-menu">
              <button type="button" onClick={duplicate}><MenuItem icon="copy" tone="gray" title="Duplicate" sub="A new order just like this one" /></button>
              <button type="button" className="danger" onClick={del}><MenuItem icon="trash" tone="danger" title="Delete order" sub="Asks first, with what goes with it" /></button>
            </div>
          </details>
          {/* only while saving or when a save failed (Oct 21, Nick: "I really don't like that invoice saved created button") */}
          {(/…/.test(saveState) || /failed/i.test(saveState)) && <span className={"save-state" + (/failed/i.test(saveState) ? " bad" : "")} title={saveState}>{/failed/i.test(saveState) ? "Not saved" : saveState}</span>}
        </div>
      </div>
      {flash && <div className="banner" role="status" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{flash}</div>}
      {(drafts.logos > 0 || drafts.mockups > 0) && ["quote", "request"].includes(o.status) && (
        <div className="draft-note" role="note">
          <span><b>Draft art.</b> {[drafts.logos ? `${drafts.logos} logo${drafts.logos === 1 ? "" : "s"}` : "", drafts.mockups ? `${drafts.mockups} mockup${drafts.mockups === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")} made for this order {drafts.logos + drafts.mockups === 1 ? "isn't" : "aren't"} in the customer&apos;s library yet. {drafts.logos + drafts.mockups === 1 ? "It joins" : "They join"} when the order is sent or approved, and go away if it&apos;s deleted.</span>
          <button type="button" className="btn sm" onClick={keepDrafts}>Keep in their library</button>
        </div>
      )}
      {delAsk && (
        <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Delete order" onClick={() => !delAsk.busy && setDelAsk(null)} onKeyDown={(e) => { if (e.key === "Escape" && !delAsk.busy) setDelAsk(null); }}>
          <div className="dla" onClick={(e) => e.stopPropagation()}>
            <h3>Delete order #{o.number}?</h3>
            {delAsk.loading ? <p className="faint">Looking at the order&apos;s art…</p> : delAsk.error && !delAsk.logos.length && !delAsk.mockups.length ? <p className="err">{delAsk.error}</p> : (
              <>
                {delAsk.logos.length + delAsk.mockups.length > 0 ? <p className="dla-sub">Also take off the art that goes with it? Ticked items are archived (they can be put back).</p> : <p className="dla-sub">This order has no art to take off.</p>}
                {[{ t: "Logos", list: delAsk.logos }, { t: "Mockups", list: delAsk.mockups }].filter((x) => x.list.length).map((x) => (
                  <div key={x.t} className="dla-sec">
                    <div className="dla-h">{x.t}</div>
                    <div className="dla-grid">
                      {x.list.map((a) => {
                        const on = delAsk.pick.has(a.id) && !a.elsewhere;
                        return (
                          <label key={a.id} className={"dla-it" + (on ? " on" : "") + (a.elsewhere ? " off" : "")} title={a.elsewhere ? "Used on another order: it stays" : a.label}>
                            <input type="checkbox" checked={on} disabled={!!a.elsewhere || delAsk.busy} onChange={() => setDelAsk((d) => { if (!d) return d; const p = new Set(d.pick); if (p.has(a.id)) p.delete(a.id); else p.add(a.id); return { ...d, pick: p }; })} />
                            <span className="dla-pic">{a.url ? <img src={a.url} alt="" /> : null}</span>
                            <span className="dla-t">{a.label}</span>
                            <small>{a.elsewhere ? "On another order: stays" : a.draft ? "Made for this order" : "In their library"}</small>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {delAsk.qb?.synced && (
                  <div className="dla-qb">
                    <b><QbMark /> This order is already in QuickBooks{delAsk.qb.docNumber ? ` (invoice ${delAsk.qb.docNumber})` : ""}.</b>
                    {delAsk.qb.voided ? <span className="faint">It&apos;s already voided there.</span>
                      : delAsk.qb.source === "created" || delAsk.qb.source === "test" ? (
                        <label><input type="checkbox" checked={!!delAsk.qbVoid} disabled={delAsk.busy} onChange={(e) => setDelAsk((d) => (d ? { ...d, qbVoid: e.target.checked } : d))} /> Void it in QuickBooks</label>
                      ) : <span className="faint">Printavo made that invoice, so void it in QuickBooks yourself.</span>}
                    <small className="faint">Voided invoices stay in QuickBooks at $0. Number #{o.number} is never used again.</small>
                  </div>
                )}
                {delAsk.cu && (
                  <label className="dla-cu">
                    <input type="checkbox" checked={!!delAsk.cuBack} disabled={delAsk.busy} onChange={(e) => setDelAsk((d) => (d ? { ...d, cuBack: e.target.checked } : d))} />
                    <span>Put the ClickUp job <b data-notranslate>{delAsk.cu.name}</b> back on the New list <small className="faint">({delAsk.cu.team}; In Printavo is unticked in ClickUp)</small></span>
                  </label>
                )}
                {delAsk.error && <p className="err">{delAsk.error}</p>}
              </>
            )}
            <div className="dla-acts">
              {delAsk.gone ? <button type="button" className="btn primary" onClick={() => { setDelAsk(null); leave(); }}>OK</button> : <>
              <button type="button" className="btn ghost" disabled={delAsk.busy} onClick={() => setDelAsk(null)}>Cancel</button>
              <button type="button" className="btn danger" disabled={delAsk.loading || delAsk.busy} onClick={confirmDel}>{delAsk.busy ? "Deleting…" : (() => { const n = delAsk.logos.filter((l) => delAsk.pick.has(l.id) && !l.elsewhere).length + delAsk.mockups.filter((m) => delAsk.pick.has(m.id)).length; return n ? `Delete order and ${n} item${n === 1 ? "" : "s"}` : "Delete order"; })()}</button></>}
            </div>
          </div>
        </div>
      )}
      {o.status === "request" && (
        <div className="callout req-callout">
          <h2>Order request from the customer{o.submitted_at ? ` · sent ${new Date(o.submitted_at).toLocaleDateString()}` : " · still being built by the customer"}</h2>
          <div className="muted">They built this in their portal without prices. Prices below are <b>suggested from your pricing matrix</b>, with blank costs filled in from the garment catalog. Adjust anything, answer their questions in Messages, then finalize. They&apos;ll get it back as a quote for their final approval.</div>
          {/* a wholesale customer's order sent in at their prices: accept it, with a note to their Messages (Oct 24, Nick) */}
          {accepting != null ? (
            <div className="req-accept">
              <label className="mk-f"><span>Message to them (goes to their Messages)</span><textarea rows={2} value={accepting} onChange={(e) => setAccepting(e.target.value)} /></label>
              <div className="faint" style={{ fontSize: 12.5 }}>{acceptMode === "as_is" ? "Their mockup is the approved art: no proof. It goes to Waiting on goods, or In production if their goods are already checked in." : "You'll go to their mockup to change it. Then send the proof from the order with a note on what you changed; it waits on their OK."}</div>
              <div className="row"><button type="button" className="btn primary" disabled={acceptBusy} onClick={accept}>{acceptBusy ? "Accepting…" : acceptMode === "as_is" ? "Accept as is & send message" : "Accept & change the art"}</button><button type="button" className="btn ghost" onClick={() => setAccepting(null)}>Cancel</button></div>
            </div>
          ) : (
            <div className="row">
              {o.submitted_at && o.price_type === "wholesale" && <>
                <button type="button" className="btn primary" onClick={() => { setAcceptMode("as_is"); setAccepting("Thanks for the order! We've got it and we're good to go. We'll keep you posted here as it moves along."); }}>Accept as is</button>
                <button type="button" className="btn" onClick={() => { setAcceptMode("changes"); setAccepting("Thanks for the order! We're making a small change to the art and will send you a proof to approve."); }}>Accept with changes</button>
              </>}
              <button type="button" className={"btn" + (o.submitted_at && o.price_type === "wholesale" ? "" : " primary")} onClick={send} disabled={!o.submitted_at}>Finalize &amp; send for approval</button>
              <button type="button" className="btn ghost" onClick={() => setTab("msg")}>Their questions</button>
            </div>
          )}
        </div>
      )}

      {(reprintAsk || isReorder(o) || o.groups.some((g) => g.fromGroup)) && o.price_type === "wholesale" && ["request", "quote", "quote_sent"].includes(o.status) && (() => {
        // a duplicate / reorder of a wholesale order still at new screens: offer the reprint fee (kept on its reorders);
        // asked until it's answered (Oct 20, Nick: "you didn't ask me to change the screen price to $15")
        const ims = o.groups.filter((g) => !g.reprintAsked).flatMap((g) => g.imprints.filter((im) => im.method === "screen" && !(im.remake ?? g.remake)));
        const wl = settings.wholesale;
        if (!ims.length || wl.remakeFee == null || wl.remakeFee >= wl.screenFee) return null;
        const n = [...new Map(ims.map((im) => [`${im.design_id || ""}|${im.location}|${im.colors}`, im])).values()].reduce((a, im) => a + Math.max(1, +im.colors || 1), 0);
        return (
          <div className="eo-fee">
            <span>This copy is priced as <b>new screens</b> ({n} screen{n === 1 ? "" : "s"} at {money(wl.screenFee)}). It&apos;s a reorder: charge the <b>reprint fee, {money(wl.remakeFee)} a screen</b>? It stays that way on this design&apos;s reorders.</span>
            <button type="button" className="btn sm primary" onClick={() => { patch((d) => { for (const g of d.groups) for (const im of g.imprints) if (im.method === "screen") im.remake = true; }); setReprintAsk(false); }}>Yes, reprint fee {money(wl.remakeFee)}</button>
            <button type="button" className="btn sm ghost" onClick={() => { patch((d) => { for (const g of d.groups) g.reprintAsked = true; }); setReprintAsk(false); }}>No, keep {money(wl.screenFee)}</button>
          </div>
        );
      })()}
      {/* moving off Printavo: a 40,000-series order waits until its customer has been moved (checklist done) */}
      {cust && o.number >= 40000 && needsMove(cust as unknown as Record<string, unknown>) && <NotMovedBanner customerId={cust.id} name={custLabel(cust)} what="this order"
        onMoved={async () => { const { data } = await sb.from("customers").select("*").eq("id", cust.id).maybeSingle(); if (data) setCustomers((cs) => cs.map((x) => (x.id === cust.id ? (data as Customer) : x))); }} />}
      {/* the summary bar across the top was taken off (Oct 29, Nick: "just unneeded information") */}
      {/* the customer, a short strip under the job name (Oct 29, Nick: "the customer panel should be right underneath the job
          name… short and squatty… c") */}
      <section className={"panel cu-strip" + (cuOpen ? " open" : "")}>
              {/* the customer, quiet (Oct 29, Nick: "I don't need all of this info all the time… the customer name twice…
                  we don't need what they owe on other orders… terms… tax… we're never going to change… little symbols… address,
                  email, notes as a dropdown… pricing at the bottom… it's going to drop down to do program pricing") */}
              <div className="panel-b cu-b">
                {newCust ? (
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="grid g2">
                      <div className="field"><label htmlFor="nc-co">Company</label><input id="nc-co" type="text" autoFocus value={newCust.company} onChange={(e) => setNewCust({ ...newCust, company: e.target.value })} /></div>
                      <div className="field"><label htmlFor="nc-nm">Contact name</label><input id="nc-nm" type="text" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} /></div>
                      <div className="field"><label htmlFor="nc-em">Email</label><input id="nc-em" type="email" value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} /></div>
                      <div className="field"><label htmlFor="nc-ph">Phone</label><input id="nc-ph" type="tel" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} /></div>
                      <div className="field"><label htmlFor="nc-pt">Customer type</label><select id="nc-pt" value={newCust.price_type} onChange={(e) => setNewCust({ ...newCust, price_type: e.target.value as PriceType })}><option value="retail">Retail (we supply garments)</option><option value="wholesale">Wholesale (they supply garments)</option></select></div>
                      {(settings.accountOwners || []).length > 0 && <div className="field"><label htmlFor="nc-own">Account owner</label><select id="nc-own" value={newCust.account_owner || ""} onChange={(e) => setNewCust({ ...newCust, account_owner: e.target.value })}><option value="">No one yet</option>{(settings.accountOwners || []).map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}</select></div>}
                    </div>
                    <div className="row"><button className="btn primary sm" type="button" onClick={addCustomer}>Add and use</button><button className="btn ghost sm" type="button" onClick={() => setNewCust(null)}>Cancel</button></div>
                  </div>
                ) : (
                  <>
                    {/* type to find (Oct 22, Nick: "type PET and then select Peticolas"): shown until one's picked, or to change it */}
                    {(!cust || pickCust) && <div className="cu-pick"><CustomerPick field value={o.customer_id || null} options={custOpts} placeholder="Type a customer: company, name or email" onPick={(v) => {
                      const c = customers.find((x) => x.id === v);
                      patch((d) => { d.customer_id = v || null; if (c?.tax_exempt) d.tax_exempt = true; if (c) d.price_type = c.price_type || "retail"; });
                      if (v) setPickCust(false);
                    }} /><button className="linkbtn" type="button" onClick={() => setNewCust({ company: "", name: "", email: "", phone: "", price_type: "retail" })}>+ New customer</button>{cust && <button className="linkbtn" type="button" onClick={() => setPickCust(false)}>Cancel</button>}</div>}
                    {cust && !pickCust ? (
                      <div className="cu">
                        <span className="cu-av" aria-hidden>{custLabel(cust).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span>
                        <div className="cu-who">
                          <div className="cu-co">{custLabel(cust)}<Link className="cu-pen" href={`/shop/customers/${cust.id}`} title="Edit customer" aria-label="Edit customer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></Link>
                            {/* tax and terms as two small symbols: set once for a customer, rarely looked at */}
                            <span className="cu-sym money-only">
                              {o.tax_exempt && <span className="cu-ic" title="Tax exempt on this order"><span>Exempt</span></span>}
                              <span className="cu-ic" title={`Payment terms: ${PAY_TERMS[cust.payment_terms || "receipt"]} (set on the customer)`}><span>{({ receipt: "On receipt", net30: "Net 30", deposit: "50/50", prepay: "Pre-pay" } as Record<string, string>)[cust.payment_terms || "receipt"]}</span></span>
                            </span>
                          </div>
                          <div className="cu-line">
                            {[cust.company && cust.name && cust.name !== cust.company ? cust.name : "", fmtPhone(cust.phone)].filter(Boolean).map((x, i) => <span key={i}>{x}</span>)}
                            {(cust.address || cust.email || cust.notes || (cust.tags || []).length > 0) && <button type="button" className="cu-addr" aria-expanded={addrOpen} onClick={() => setAddrOpen((v) => !v)}>{addrOpen ? "▾" : "▸"} Address, email, notes</button>}
                          </div>
                          {addrOpen && <div className="cu-more">
                            {cust.address && <div style={{ whiteSpace: "pre-line" }}>{cust.address}</div>}
                            {cust.email && <div>{cust.email}</div>}
                            {(cust.tags || []).length > 0 && <div className="row" style={{ gap: 4 }}>{(cust.tags || []).map((t) => <span key={t} className="tag">{t}</span>)}</div>}
                            {cust.notes && <div className="cc-note" title="Customer notes (shop only)">{cust.notes}</div>}
                          </div>}
                        </div>
                    <div className="cu-price money-only">
                      <label className="cu-k" htmlFor="o-pt">Pricing</label>
                      <div className="cu-pv">
                        <select id="o-pt" className="jl-in" value={o.use_program ? (progAll && progAll.cards.length > 1 && progCard ? `card:${progCard.id}` : "program") : o.price_type === "wholesale" ? "wholesale" : "retail"} onChange={(e) => {
                          const v = e.target.value;
                          if (v.startsWith("card:")) { setConfirmRetail(false); patch((d) => { d.use_program = true; d.program_card = v.slice(5); }); setProgOpen(true); }
                          else if (v === "program") { setConfirmRetail(false); patch((d) => { d.use_program = true; }); setProgOpen(true); }
                          else if (v === "wholesale") { setConfirmRetail(false); patch((d) => { d.price_type = "wholesale"; d.use_program = false; }); }
                          else if (o.price_type === "wholesale" && cust?.price_type === "wholesale") setConfirmRetail(true);
                          else patch((d) => { d.price_type = "retail"; d.use_program = false; });
                        }}>
                          <option value="retail">Retail</option><option value="wholesale">Wholesale</option>
                          {progAll && progAll.cards.length > 1
                            ? <optgroup label="Their program">{progAll.cards.map((c) => <option key={c.id} value={`card:${c.id}`}>{c.name}</option>)}</optgroup>
                            : (prog || o.use_program) && <option value="program">Program{progCard ? `: ${progCard.name}` : ""}</option>}
                        </select>
                        {cust && !o.use_program && o.price_type !== (cust.price_type || "retail") && <span className="faint pt-ch">Changed for this order</span>}
                      </div>
                    </div>
                        {o.use_program && prog && <button type="button" className="pt-applied" onClick={() => setProgOpen(!progOpen)} aria-expanded={progOpen} title={progOpen ? "Hide the program pricing details" : "Show how the program prices this order"}><span className="pt-dot" aria-hidden />Applied<span className="pt-car" aria-hidden>{progOpen ? "▴" : "▾"}</span></button>}
                        <button type="button" className="linkbtn cu-chg" onClick={() => setPickCust(true)}>Change</button>
                        {/* phone only: the name alone; this opens the contact, address, pricing and Change */}
                        <button type="button" className="cu-tog" aria-expanded={cuOpen} aria-label={cuOpen ? "Hide customer details" : "Show customer details"} onClick={() => setCuOpen((v) => !v)}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6l6-6" /></svg>
                        </button>
                      </div>
                    ) : null}
                    {o.use_program && !prog && <div className="pt-row money-only"><span className="faint pt-ch">No rate card on their Program tab</span></div>}
                    {!o.use_program && progAll && progAll.applyMode === "ask" && progAll.cards.length > 0 && ["quote", "request"].includes(o.status) && (
                      <div className="prg-ask"><span><b>{cust ? custLabel(cust) : "This customer"}</b> has program pricing.</span><button type="button" className="btn sm primary" onClick={() => { setConfirmRetail(false); patch((d) => { d.use_program = true; }); }}>Apply program pricing</button></div>
                    )}
                    {o.use_program && prog && progOpen && <ProgramNotes groups={o.groups} card={prog.card} baseCost={prog.baseCost} ctx={(g) => designCtx(o, g)} />}
                    {o.use_program && prog && progOpen && !["production", "ready", "completed"].includes(o.status) && <PriceSuggestions groups={o.groups} ctx={(g) => designCtx(o, g)} settings={settings}
                      onUse={(gid, price) => { patch((d) => { const g = d.groups.find((x) => x.id === gid); g?.lines.forEach((l) => { if (!l.extras && Object.values(l.sizes || {}).some((n) => +(n || 0) > 0)) { l.priceOverride = price; delete l.prog; l.progOff = true; } }); }); say(`Price set to ${money(price)}.`); }}
                      onSaved={() => { if (custId) programCard(custId).then((r) => { if (r.ok && (r.cards.length || r.items.length)) setProgAll({ cards: r.cards, items: r.items, applyMode: r.applyMode }); }); }} />}
                    {/* the "Last time…" past-price line is gone (Oct 15, Nick: it matched a job they had never printed) */}
                    {confirmRetail && cust && (
                      <div className="confirm-bar">
                        <span><b>{custLabel(cust)}</b> is a wholesale customer. Are you sure you want to price this order as retail?</span>
                        <button type="button" className="btn sm primary" onClick={() => { setConfirmRetail(false); patch((d) => { d.price_type = "retail"; }); }}>Yes, switch to retail</button>
                        <button type="button" className="btn sm ghost" onClick={() => setConfirmRetail(false)}>Cancel</button>
                      </div>
                    )}
                  </>
                )}
              </div>
      </section>

      <nav className="aa-nav ot-nav" aria-label="Order sections">
        {([["order", "Order", 0], ["prod", "Art & production", art.length], ["goods", "Goods", 0], ["msg", "Messages", talkN + messages.length], ...(seesMoney ? [["pay", "Payments", payments.length]] : []), ["act", "Activity", 0]] as [Tab, string, number][]).map(([k, l, n]) =>
          <button key={k} type="button" className={"aa-tab" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)} aria-label={l} title={l}><svg className="ot-ic" viewBox="0 0 24 24" aria-hidden>{TAB_ICONS[k]}</svg><span className="ot-l">{l}</span>{n > 0 && <span className="aa-n">{n}</span>}</button>)}
      </nav>
      <div className="ot-panes" inert={(cust && o.number >= 40000 && needsMove(cust as unknown as Record<string, unknown>)) || undefined} style={cust && o.number >= 40000 && needsMove(cust as unknown as Record<string, unknown>) ? { opacity: 0.45 } : undefined}>

        {/* Order: what's being made and what it costs (Oct 15, Nick: "too much information on one page… tabs at the top") */}
        <div className="ed-grid" hidden={tab !== "order"}>
          <div className="stack">
            {/* the Reorder section (mockup, pricing check, print specs, AI spec history) is gone from the order page (Oct 20,
                Nick: "get rid of this whole section… it's overbearing… we handled it in the resolution center"): the
                Resolution Center asks, Reorder Details confirms, the print row's stamp says what's waiting */}
          <datalist id="locs">{ALL_LOCATIONS.map((x) => <option key={x} value={x} />)}</datalist>
          {custArt !== null && o.customer_id && o.groups[custArt] && (
            <CustomerArtwork customerId={o.customer_id} orderId={o.id} group={o.groups[custArt]} onClose={() => setCustArt(null)}
              onPick={async (p) => {
                const gi = custArt, gid = o.groups[gi].id;
                // a logo from their brand: the print goes on, the group's mockup (if any) stays as it is
                if (p.keepMockup) {
                  setGroup(gi, (x) => { x.imprints = p.imprints; delete x.mockupSkipped; });
                  setCustArt(null);
                  await new Promise((r) => setTimeout(r, 80));
                  await save();
                  void sb.from("order_events").insert({ order_id: o.id, kind: "note", detail: `Added ${p.label} to ${o.groups[gi].name || "the group"} (Customer artwork, brand rules).` });
                  return;
                }
                if (!p.helperFile || p.open) setGroup(gi, (x) => {
                  x.imprints = p.imprints; x.mockupOffsets = p.offsets; delete x.mockupSkipped;
                  if (p.thumbs) { x.mockupThumbs = p.thumbs; x.mockupAt = new Date().toISOString(); } else { delete x.mockupThumbs; delete x.mockupAt; } delete x.mockupArt; // the picture brought in is kept as it is (lib/mockupFresh.ts)
                });
                setCustArt(null);
                await new Promise((r) => setTimeout(r, 80)); // the change lands in latest.current before saving
                await save();
                void sb.from("order_events").insert({ order_id: o.id, kind: "note", detail: p.helperFile ? `Opened ${p.label}'s old mockup in the Mockup Creator's Helper (Customer artwork).` : `Brought in the mockup${p.imprints.length ? " and prints" : ""} from ${p.label} (Customer artwork)${p.remake ? ", made again on this order's garments" : ", the same picture"}.` });
                // made again on this group's garments: the Mockup Creator builds it and saves, then comes back here
                if (p.remake) router.push(`/shop/artwork/mockup?order=${o.id}&group=${gid}&auto=1`);
                // an old job's mockup PDF: the Mockup Creator opens with the Helper reading it
                else if (p.open) router.push(mockupHref(o.id, { id: gid, mockupKind: o.groups.find((x) => x.id === gid)?.mockupKind }, p.helperFile ? `&helper=1&helperFile=${encodeURIComponent(p.helperFile)}` : ""));
                else if (p.helperFile) router.push(`/shop/artwork/mockup?order=${o.id}&group=${gid}&helper=1&helperFile=${encodeURIComponent(p.helperFile)}`);
              }} />
          )}
          {o.groups.map((g, gi) => (
            <GroupEditor finishingAt={finPerGroup || o.groups.length === 1 ? "group" : "order"} neckSets={((cust as unknown as { neck_labels?: NeckLabelSet[] } | undefined)?.neck_labels) || []} customerId={o.customer_id || undefined} hidePrices={!seesMoney || undefined} key={g.id} gi={gi} g={g} gc={calc.groups[gi]} settings={settings} prices={priceList(settings, o.price_type)} catalog={catalog} canRemove={o.groups.length > 1}
              onCustomerArt={o.customer_id ? () => setCustArt(gi) : undefined}
              armed={armed} arm={arm} update={(fn) => setGroup(gi, fn)} onSaveToCatalog={saveToCatalog} onLookup={lookupStyle} lookingUp={lookingUp} designs={designs} designUrls={designUrls} onUploadDesign={uploadOrderDesign} thumbUrls={thumbUrls} onStarDesign={starDesign} noLock={o.status === "request"} detailsHref={`/shop/details?order=${o.id}`} orderId={o.id} sewouts={sewouts} mockupExtra={redrawing.includes(g.id) ? <span className="faint mk-when">Redrawing with the new art…</span> : undefined} onMockup={async () => { await save(); router.push(mockupHref(o.id, g)); }} onLogo={async () => { await save(); router.push(`/shop/artwork/mockup?order=${o.id}&group=${g.id}&logo=1`); }} onRemoveMockup={() => void removeMockup(gi)}
              mockupBlock={!o.customer_id ? "Pick a customer first. Mockups and art are saved to their account." : !g.lines.some((l) => (l.style || "").trim()) ? "Add at least one garment first." : ""}
              onDuplicate={() => patch((d) => { d.groups.splice(gi + 1, 0, cloneGroup(d.groups[gi])); })}
              onRemove={() => patch((d) => { d.groups.splice(gi, 1); })} />
          ))}
          <div className="row grp-add">
            <button className="btn" type="button" onClick={() => patch((d) => { const ng = newGroup(); if (!finPerGroup) { ng.finishing = (d.groups[0]?.finishing || []).filter(isFin); if (d.groups[0]?.customFin?.length) ng.customFin = [...d.groups[0].customFin]; } d.groups.push(ng); })}>+ Add line item group</button>
            <span className="faint grp-hint" style={{ fontSize: 12 }}>Garments in the same group share imprints, and their quantities add up for the price break.</span>
            <FillFromText orderId={o.id} hasContent={o.groups.some((g) => g.lines.some((l) => l.style || Object.keys(l.sizes || {}).length))} onApply={applyProposal} />
          </div>
          {/* one group: its finishing is inside the group (Oct 21, Nick: order page cleanup) */}
          {orderFinList.length > 0 && o.groups.length > 1 && (
            <section className="panel fin-panel">
              <div className="panel-h"><h2>Finishing</h2>
                <div className="chips" role="group" aria-label="Apply finishing to">
                  <button type="button" className={"chip" + (!finPerGroup ? " on" : "")} onClick={finishingSame}>Apply to all groups</button>
                  <button type="button" className={"chip" + (finPerGroup ? " on" : "")} onClick={() => setFinSplit(true)}>Apply to individual groups</button>
                </div>
              </div>
              <div className="panel-b">
                {finPerGroup ? <div className="faint" style={{ fontSize: 13 }}>Pick finishing in each group above.</div> : (<>
                  <FinishingPicker list={orderFinList.filter((f) => !isRelabel(f))} hidePrices={!seesMoney}
                    custom={(o.groups[0]?.customFin || [])}
                    isOn={(id) => o.groups.length > 0 && o.groups.every((g) => (g.finishing || []).includes(id))} onToggle={setOrderFin}
                    onAddCustom={(f) => patch((d) => { for (const g of d.groups) { g.customFin = [...(g.customFin || []).filter((x) => x.id !== f.id), f]; g.finishing = [...new Set([...(g.finishing || []), f.id])]; } })}
                    onRemoveCustom={(id) => patch((d) => { for (const g of d.groups) { g.customFin = (g.customFin || []).filter((x) => x.id !== id); g.finishing = (g.finishing || []).filter((y) => y !== id); } })}
                    onSave={saveFinishing(o.price_type === "wholesale")} />
                </>)}
              </div>
            </section>
          )}
            <div className="grid g2 fees-notes">
            <section className="panel money-only">
              <div className="panel-h"><h2>Fees & adjustments</h2></div>
              <div className="panel-b stack">
                <div className="fee-row fee-head"><span>Description</span><span>Amount</span><span /></div>
                {(o.fees.some((f) => !isShipFee(f)) ? o.fees : [...o.fees, { label: "", amount: "" as number | "" }]).map((f, i) => {
                  if (isShipFee(f)) return null; // shipping: the Shipping quote card and Totals
                  // an order with no fees still shows one blank row to type into
                  const edit = (fn: (x: { label: string; amount: number | "" }) => void) => patch((d) => { if (!d.fees[i]) d.fees[i] = { label: "", amount: "" }; fn(d.fees[i]); });
                  return (
                    <div key={i} className="fee-row">
                      <input type="text" aria-label="Fee description" placeholder="Rush fee, art time, shipping…" value={f.label} onChange={(e) => edit((x) => { x.label = e.target.value; })} />
                      <input type="number" step="0.01" aria-label="Fee amount" placeholder="0.00" value={f.amount} onChange={(e) => edit((x) => { x.amount = numOr(e.target.value); })} />
                      {o.fees[i] ? <button className="btn icon ghost" type="button" tabIndex={-1} aria-label="Remove fee" onClick={() => patch((d) => { d.fees.splice(i, 1); })}>✕</button> : <span />}
                    </div>
                  );
                })}
                <button className="btn sm add-wide" type="button" onClick={() => patch((d) => { if (!d.fees.some((f) => !isShipFee(f))) d.fees.push({ label: "", amount: "" }); d.fees.push({ label: "", amount: "" }); })}>+ Add fee</button>
              </div>
            </section>
            <section className="panel">
              <div className="panel-h"><h2>Customer notes</h2></div>
              <div className="panel-b stack">
                <div className="field"><label htmlFor="o-notes">Customer notes</label><textarea id="o-notes" rows={4} value={o.notes} onChange={(e) => patch((d) => { d.notes = e.target.value; })} /></div>
                {/* off unless it matters (Oct 30, Nick: "check a box… if it is important we will add it to the invoice. If not, it doesn't show") */}
                <label className="check"><input type="checkbox" checked={!!o.notes_on_invoice} onChange={(e) => patch((d) => { d.notes_on_invoice = e.target.checked; })} /> Add customer notes to the invoice</label>
              </div>
            </section>
            </div>
          </div>
          <aside className="ed-aside">
          <section className="panel jd-panel">
              {/* the job and its type (Oct 29, Nick: "job details and type… production date above the in-hands date… a clock
                  symbol to set a time… firm and rush… little check boxes… in the header… job type at the bottom… stand out") */}
              <div className="panel-h"><h2>Job details &amp; type</h2>
                <span className="jd-flags">
                  <label className={"jd-ck k-firm" + (o.firm ? " on" : "")} title="Firm in-hands date: it can't move (⛰️ on the production calendar)"><input type="checkbox" checked={!!o.firm} onChange={(e) => patch((d) => { d.firm = e.target.checked; })} />Firm</label>
                  <label className={"jd-ck k-rush" + (o.rush ? " on" : "")} title="Rush job (🔥 on the production calendar)"><input type="checkbox" checked={!!o.rush} onChange={(e) => patch((d) => { d.rush = e.target.checked; })} />Rush</label>
                </span>
              </div>
              <div className="panel-b stack">
                <div className="jl">
                  <label className="jl-k" htmlFor="o-nick">Job name</label>
                  <div className="jl-v"><input id="o-nick" className="jl-in" type="text" value={o.nickname} placeholder="Fall league shirts" onChange={(e) => patch((d) => { d.nickname = e.target.value; })} /></div>
                  <label className="jl-k" htmlFor="o-po">PO #</label>
                  <div className="jl-v"><input id="o-po" className="jl-in" type="text" value={o.po_number || ""} placeholder="None" onChange={(e) => patch((d) => { d.po_number = e.target.value; })} /></div>
                  <label className="jl-k" htmlFor="o-prod">Production</label>
                  <div className="jl-v"><input id="o-prod" className="jl-in jl-date" type="date" value={o.production_date || ""} onChange={(e) => patch((d) => { d.production_date = e.target.value || null; })} /></div>
                  <label className="jl-k" htmlFor="o-due">In hands</label>
                  <div className="jl-v">
                    <input id="o-due" className="jl-in jl-date" type="date" value={o.due_date || ""} onChange={(e) => patch((d) => { d.due_date = e.target.value || null; })} />
                    {o.due_time != null && <input className="jl-in jl-time" type="time" step={900} aria-label="Due by" value={`${String(Math.floor(o.due_time / 60)).padStart(2, "0")}:${String(o.due_time % 60).padStart(2, "0")}`} onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); if (!isNaN(h)) patch((d) => { d.due_time = h * 60 + (m || 0); d.firm = true; }); }} />}
                    <button type="button" className={"jl-clock" + (o.due_time != null ? " on" : "")} aria-pressed={o.due_time != null} title={o.due_time != null ? "Clear the time" : "Set a time: needed by a set time that day (makes the date firm)"} onClick={() => patch((d) => { d.due_time = d.due_time != null ? null : 600; if (d.due_time != null) d.firm = true; })}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></button>
                  </div>
                </div>
                <div className="grid jd-grid">
                  <ProjectPicker orderId={o.id} customerId={o.customer_id} value={(o as { project_id?: string | null }).project_id || null} />
                </div>
                {/* the job's type, standing out at the bottom: the dropdown, and what it means for this order under it */}
                <div className="jd-typebox">
                  <OrderTypeRow o={o} patch={patch} bare />
                </div>
                <div className="faint jd-made">{o.type === "quote" ? "Quote" : "Invoice"} · created {fmtDateLong(o.created_at.slice(0, 10))}{o.approved_at ? ` · approved by ${o.approved_name} ${fmtDate(o.approved_at.slice(0, 10))}` : ""}</div>
              </div>
          </section>
          {!seesMoney && (
            <section className="panel">
              <div className="panel-h"><h2>Quantity</h2></div>
              <div className="panel-b"><div className="totals"><div className="tr big"><span>Total pieces</span><span className="num">{calc.qty}</span></div></div></div>
            </section>
          )}
          <section className="panel money-only">
            <div className="panel-h"><h2>Totals</h2><span className="faint num">{calc.qty} pcs</span></div>
            <div className="panel-b">
              <div className="totals">
                <div className="tr"><span>Line items</span><span>{money(calc.items)}</span></div>
                <div className="tr"><span title={adjFee ? `Includes ${money(adjFee)} setup adjustment from Printavo` : undefined}>Setup (screens, digitizing)</span><span>{money(calc.setup + adjFee)}</span></div>
                {calc.materials ? <div className="tr"><span>2XL+ Materials Charge</span><span>{money(calc.materials)}</span></div> : null}
                {calc.fees - calc.shipping - adjFee ? <div className="tr"><span>Fees</span><span>{money(calc.fees - calc.shipping - adjFee)}</span></div> : null}
                {(calc.hasShipping || o.delivery_method === "ship") && (
                  <div className="tr"><span className="row" style={{ gap: 8 }}>Shipping
                    {calc.hasShipping && !calc.shippingTbd && <label className="check" style={{ fontSize: 12, color: "var(--ink-2)" }}><input type="checkbox" checked={calc.freeShipping} onChange={(e) => patch((d) => { const f = d.fees.find(isShipFee); if (f) f.free = e.target.checked || undefined; })} /> Free shipping</label>}</span>
                    <span>{!calc.hasShipping ? <span className="faint">not added</span> : calc.shippingTbd ? <b title="Shipping to be decided: not in the total yet">TBD</b> : calc.freeShipping ? "Free" : money(calc.shipping)}</span></div>
                )}
                {/* discount and tax in line, no boxes until you use them (Oct 29, Nick: "tax is never not 8.25%… you either click
                    exempt or not… discount… a toggle… percent or a dollar sign… the entry right in line… only when you click it") */}
                <div className="tr"><span className="row tt-row">Discount
                  <span className="tt-seg" role="group" aria-label="Discount in">
                    {(["pct", "amt"] as const).map((k) => <button key={k} type="button" className={(o.discount_type === "amt" ? "amt" : "pct") === k ? "on" : ""} aria-pressed={(o.discount_type === "amt" ? "amt" : "pct") === k}
                      onClick={() => patch((d) => { const v = d.discount_type === "amt" ? d.discount_amt || 0 : d.discount_pct || 0; d.discount_type = k; if (k === "amt") { d.discount_amt = v; d.discount_pct = 0; } else { d.discount_pct = Math.min(100, v); d.discount_amt = 0; } })}>{k === "pct" ? "%" : "$"}</button>)}
                  </span>
                </span>
                {/* the amount is the place to click: it turns into the box while you type (Oct 29, Nick: "click to the right… it
                    shouldn't be highlighted by default… when you click on it, you should just be able to fill it in") */}
                {discEdit ? <input type="number" step="0.01" min="0" className="tt-in" autoFocus aria-label={o.discount_type === "amt" ? "Discount in dollars" : "Discount percent"} placeholder={o.discount_type === "amt" ? "0.00" : "0"}
                    value={(o.discount_type === "amt" ? o.discount_amt : o.discount_pct) || ""} onBlur={() => setDiscEdit(false)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setDiscEdit(false); }}
                    onChange={(e) => patch((d) => { const v = Math.max(0, +e.target.value || 0); if (d.discount_type === "amt") d.discount_amt = v; else d.discount_pct = Math.min(100, v); })} />
                  : <button type="button" className="tt-val" title="Click to add a discount" onClick={() => setDiscEdit(true)}>{calc.discount ? <>{o.discount_type !== "amt" && o.discount_pct ? <small className="faint">{o.discount_pct}% · </small> : null}−{money(calc.discount)}</> : money(0)}</button>}</div>
                <div className="tr"><span className="row tt-row">Tax <span className="faint">{o.tax_rate ?? settings.taxRate}%</span>
                  <button type="button" className={"tt-ex" + (o.tax_exempt ? " on" : "")} aria-pressed={o.tax_exempt} title={o.tax_exempt ? "Tax exempt: click to charge tax" : "Click if this order is tax exempt"} onClick={() => patch((d) => { d.tax_exempt = !d.tax_exempt; })}>Exempt</button>
                </span><span>{o.tax_exempt ? "Exempt" : money(calc.tax)}</span></div>
                <div className="tr big"><span>Total{calc.shippingTbd ? <small className="faint" style={{ fontSize: 12, fontWeight: 400, marginLeft: 6 }}>+ shipping TBD</small> : null}</span><span>{money(calc.total)}</span></div>
                <div className="tr"><span>Paid</span><span>{money(calc.paid)}</span></div>
                <div className="tr bal"><span>Balance due</span><span style={{ color: calc.balance > 0.004 ? "var(--ink)" : "var(--ok)" }}>{money(calc.balance)}</span></div>
              </div>
            </div>
          </section>
          {/* Delivery: its own panel under Totals (Oct 29, Nick: "it should be delivery and should be its own panel so that you
              can get the quote in there") */}
          {cust?.ship_on && ownAcct?.id !== cust.ship_on && <OwnAcctLoad id={cust.ship_on} onLoad={setOwnAcct} />}
          <section className="panel dl-panel">
            <div className="panel-h"><h2>Delivery</h2>{o.due_date && <span className="faint">In hands {new Date(o.due_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>}</div>
            <div className="panel-b stack">
              <div className="dl-seg" role="group" aria-label="Pickup, ship or delivery">
                {([["pickup", "Pickup"], ["ship", "Ship"], ["deliver", "Deliver"], ["tbd", "TBD"]] as [Delivery, string][]).map(([k, l]) => <button key={k} type="button" className={(o.delivery_method || "pickup") === k ? "on" : ""} aria-pressed={(o.delivery_method || "pickup") === k}
                  onClick={() => patch((d) => { d.delivery_method = k; if (k !== "pickup" && k !== "tbd" && !d.ship_to && cust) d.ship_to = cust.ship_address || cust.address || ""; if (k === "ship" && !d.ship_method) d.ship_method = ownAcct && cust?.ship_on === ownAcct.id ? onAccountMethod(`${ownAcct.carrier} Ground`, ownAcct.name) : "UPS Ground"; if (k === "ship" && accountOfMethod(d.ship_method)) d.fees = d.fees.filter((f) => !isShipFee(f)); })}>{l}</button>)}
              </div>
              <div className="grid jd-grid">
                  {o.delivery_method === "ship" && (
                    <div className="field"><label htmlFor="o-sm">Ship method</label>
                      <select id="o-sm" value={accountOfMethod(o.ship_method) ? o.ship_method : matchShipMethod(o.ship_method) || (o.ship_method ? "__other" : "")} onChange={(e) => patch((d) => { d.ship_method = e.target.value === "__other" ? " " : e.target.value; if (accountOfMethod(d.ship_method)) d.fees = d.fees.filter((f) => !isShipFee(f)); })}>
                        <option value="">Choose…</option>
                        {/* their own account first (Oct 30, Nick: "FedEx 918 ground account… just add it from the dropdown… $0") */}
                        {ownAcct && cust?.ship_on === ownAcct.id && <optgroup label={`${ownAcct.name} (their account: $0)`}>{SHIP_METHODS.filter((m) => m.startsWith(ownAcct.carrier)).map((m) => <option key={m} value={onAccountMethod(m, ownAcct.name)}>{onAccountMethod(m, ownAcct.name)}</option>)}</optgroup>}
                        {accountOfMethod(o.ship_method) && !(ownAcct && accountOfMethod(o.ship_method) === ownAcct.name) && <option value={o.ship_method}>{o.ship_method}</option>}
                        <optgroup label="UPS">{SHIP_METHODS.filter((m) => m.startsWith("UPS")).map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                        <optgroup label="FedEx">{SHIP_METHODS.filter((m) => m.startsWith("FedEx")).map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                        <optgroup label="USPS">{SHIP_METHODS.filter((m) => m.startsWith("USPS")).map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>
                        <option value="__other">Other…</option>
                      </select>
                      {accountOfMethod(o.ship_method) && <p className="faint" style={{ margin: "4px 0 0" }}>Ships on {accountOfMethod(o.ship_method)}: they pay FedEx, no shipping charge.</p>}
                      {o.ship_method && !matchShipMethod(o.ship_method) && !accountOfMethod(o.ship_method) && <input type="text" aria-label="Other ship method" placeholder="Freight, customer's account #…" value={o.ship_method.trim()} onChange={(e) => patch((d) => { d.ship_method = e.target.value || " "; })} style={{ marginTop: 4 }} />}
                    </div>
                  )}
                  </div>
                {/* Bill third party (Oct 30, Nick): their carrier account pays the shipping; remembered on the customer */}
                {o.delivery_method === "ship" && (() => {
                  const tp = o.third_party || null;
                  const setTp = (fn: (t: ThirdParty) => void) => patch((d) => { const t: ThirdParty = { ...(d.third_party || { carrier: carrierOf(d.ship_method), account: "" }) }; fn(t); d.third_party = t; });
                  // the customer's shipping account (the same one the Shipping center bills: customers.ship_bill + its account)
                  const remember = () => {
                    const t = latest.current?.third_party;
                    if (!cust || !t || !(t.account || "").trim() || !t.carrier) return;
                    const up = { ship_bill: (t.carrier === "UPS" ? "ups" : "fedex") as "ups" | "fedex", [t.carrier === "UPS" ? "ship_ups_account" : "ship_fedex_account"]: t.account.trim(), ship_bill_zip: (t.zip || "").trim() };
                    sb.from("customers").update(up).eq("id", cust.id).then(() => setCustomers((cs) => cs.map((x) => (x.id === cust.id ? { ...x, ...up } : x))));
                  };
                  return (
                    <div className="tp-wrap">
                      <label className="check"><input type="checkbox" checked={!!tp} onChange={(e) => patch((d) => {
                        if (!e.target.checked) { d.third_party = null; return; }
                        const car = carrierOf(d.ship_method) || (cust?.ship_bill === "ups" ? "UPS" : cust?.ship_bill === "fedex" ? "FedEx" : "");
                        const acct = car === "UPS" ? cust?.ship_ups_account || "" : car === "FedEx" ? cust?.ship_fedex_account || "" : "";
                        d.third_party = { carrier: car, account: acct, zip: acct ? cust?.ship_bill_zip || "" : "", name: cust?.company || "" };
                        // they pay the carrier: no shipping charge on our invoice
                        d.fees = d.fees.filter((f) => !isShipFee(f));
                      })} /><b>Bill third party</b></label>
                      {tp && (
                        <div className="tp-box">
                          <div className="tp-row">
                            <div className="field"><label htmlFor="o-tpc">Carrier</label><select id="o-tpc" value={tp.carrier} onChange={(e) => setTp((t) => { t.carrier = e.target.value as ThirdParty["carrier"]; })} onBlur={remember}><option value="">Choose…</option><option value="FedEx">FedEx</option><option value="UPS">UPS</option></select></div>
                            <div className="field"><label htmlFor="o-tpa">Account #</label><input id="o-tpa" type="text" inputMode="numeric" autoComplete="off" data-notranslate value={tp.account} onChange={(e) => setTp((t) => { t.account = e.target.value; })} onBlur={remember} /></div>
                            <div className="field"><label htmlFor="o-tpz">Billing ZIP</label><input id="o-tpz" type="text" inputMode="numeric" value={tp.zip || ""} onChange={(e) => setTp((t) => { t.zip = e.target.value; })} onBlur={remember} /></div>
                          </div>
                          <div className="field"><label htmlFor="o-tpn">Account name</label><input id="o-tpn" type="text" value={tp.name || ""} onChange={(e) => setTp((t) => { t.name = e.target.value; })} onBlur={remember} /></div>
                          {tp.carrier && carrierOf(o.ship_method) && tp.carrier !== carrierOf(o.ship_method) && <p className="emb-warn-1">The ship method is {carrierOf(o.ship_method)}, but this account is {tp.carrier}.</p>}
                          {tp.carrier === "UPS" && !(tp.zip || "").trim() && <p className="faint">UPS needs the account&apos;s billing ZIP to bill it.</p>}
                          {cust && <p className="faint">Saved on {cust.company || cust.name}&apos;s customer page too: next time it fills in by itself.</p>}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {o.delivery_method !== "pickup" && o.delivery_method !== "tbd" && (
                  <div className="grid g2">
                    <div className="field"><label htmlFor="o-st">{o.delivery_method === "ship" ? "Ship to" : "Deliver to"}</label><textarea id="o-st" rows={3} value={o.ship_to || ""} onChange={(e) => patch((d) => { d.ship_to = e.target.value; })} /></div>
                    {o.delivery_method === "ship" && <div className="field"><label htmlFor="o-tr">Tracking #</label><input id="o-tr" type="text" value={o.tracking || ""} onChange={(e) => patch((d) => { d.tracking = e.target.value; })} /></div>}
                  </div>
                )}
              {/* Shipping quote: live UPS / FedEx rates under Totals when the order ships; a click puts one on the invoice (Oct 16, Nick) */}
          {o.delivery_method === "ship" && !notOurShipping(o) && seesMoney && calc && (
            <ShipQuote pieces={calc.qty} shipTo={o.ship_to || ""} settings={settings.ship} shipMethod={o.ship_method || ""} due={o.due_date} shipOn={o.production_date}
              garments={o.groups.flatMap((g) => g.lines.map((l) => {
                // the supplier's weight for each size ordered (S&S unitWeight), when the catalog has it
                const gm = catalog.find((x) => x.style.toLowerCase() === (l.style || "").trim().toLowerCase() && (!l.brand || x.brand.toLowerCase() === l.brand.toLowerCase()));
                const w = gm?.specs?.weights;
                const vals = w ? Object.values(w).filter((v) => v > 0) : [];
                const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                const lbs = w && avg ? Object.entries(l.sizes || {}).reduce((a, [z, q]) => a + (+q || 0) * (w[z] || avg), 0) || lineQty(l) * avg : undefined;
                return { desc: `${l.garment || ""} ${l.style || ""}`, qty: lineQty(l), lbs };
              }))}
              current={(() => { const f = o.fees.find(isShipFee); return f ? { label: f.label, amount: +f.amount || 0 } : null; })()}
              onAdd={(label, amount, method) => patch((d) => {
                const i = d.fees.findIndex(isShipFee);
                const fee = { label, amount: Math.round(amount * 100) / 100, ship: true, ...(i >= 0 && d.fees[i].free ? { free: true } : {}) };
                if (i >= 0) d.fees[i] = fee; else { d.fees = d.fees.filter((x) => (x.label || "").trim() || x.amount !== ""); d.fees.push(fee); }
                d.ship_method = method;
              })}
              onSet={(amount) => patch((d) => { const f = d.fees.find(isShipFee); if (f) f.amount = amount; })}
              // to be decided later, or taken off (Oct 27, Nick: "once you select a shipping thing, you can't unselect it")
              tbd={!!o.fees.find(isShipFee)?.tbd}
              onTbd={(on) => patch((d) => { const i = d.fees.findIndex(isShipFee); if (i >= 0) { if (on) d.fees[i].tbd = true; else delete d.fees[i].tbd; } else if (on) d.fees.push({ label: "Shipping · to be decided", amount: 0, ship: true, tbd: true }); })}
              onClear={() => patch((d) => { d.fees = d.fees.filter((f) => !isShipFee(f)); d.ship_method = ""; })} />
          )}
            </div>
          </section>
          {/* where the job is in the shop, its holds, and what the customer sees (Oct 21, the order statuses doc): on the
              right under Totals; then Customer supplied goods, then Printavo (Nick, Oct 21) */}
          {/* Goods, right under Totals (Oct 29, Nick): who ordered them, from where, the PO, arrival, tracking */}
          {/* Customer supplied goods: now inside the Goods panel above (Oct 29, Nick: "merge those together") */}
          {/* Printavo: at the very bottom (Oct 21, Nick: "the Printavo sync will go away shortly… move it to the very bottom") */}
          {(o as Order & { printavo_id?: string | null }).printavo_id && <section className="panel pv-panel">
            <div className="panel-h"><h2>Printavo</h2></div>
            <div className="panel-b">
      {(() => { const x = o as Order & { printavo_id?: string | null; printavo_visual_id?: string | null; printavo_state?: { url?: string; publicUrl?: string; status?: string } | null }; return x.printavo_id ? <PrintavoLink visualId={x.printavo_visual_id || ""} url={x.printavo_state?.url} publicUrl={x.printavo_state?.publicUrl} status={x.printavo_state?.status} number={o.number} orderId={o.id} onRenumbered={(v) => setO((y) => (y ? ({ ...y, printavo_visual_id: v } as Order) : y))} /> : null; })()}
      {(o as Order & { printavo_id?: string | null }).printavo_id && o.number >= 40000 && o.number < 50000 && calc && <PrintavoChanges o={o} calc={calc} patch={patch} prodNote={prodNotes} onProdNote={onProdNotes} />}
            </div>
          </section>}
          {/* Order check (ChecksPanel in OrderAssist): off for now; it joins Shop steps later (Oct 21, Nick). checks/status are still worked out for it */}
          </aside>
        </div>

        {/* Art & production */}
        <div className="ed-grid" hidden={tab !== "prod"}>
          <div className="stack">
            <ProofHistory orderId={o.id} bump={proofs.length * 1000 + events.length} />
            <OrderSeparations o={o} />
          <ProductionPanel note={prodNotes} onNote={onProdNotes} noteState={noteState} uploading={artUploading}
            files={[...art.map((a) => ({ id: a.id, name: a.name, url: a.url, mime: a.file_type, fileName: labelFileName(a.name), category: a.category, guess: a.guess, note: a.note, ...(plain[a.id] ? { plain: plain[a.id] } : {}) })), ...jobPics.map((x) => ({ id: x.id, name: x.name, url: x.url, mime: x.mime, fileName: x.name, category: "photo", note: x.note, readOnly: true }))]}
            onFileNote={(f, t) => { if (f.id.startsWith("jf-")) return; setArt((xs) => xs.map((x) => (x.id === f.id ? { ...x, note: t || null } : x))); void sb.from("art_files").update({ note: t || null }).eq("id", f.id).then(({ error }) => { if (error) say("Couldn't save the note: " + error.message); }); }}
            onCategory={(f, c) => { if (f.id.startsWith("jf-")) return; setArt((xs) => xs.map((x) => (x.id === f.id ? { ...x, category: c } : x))); void sb.from("art_files").update({ category: c }).eq("id", f.id).then(({ error }) => { if (error) say("Couldn't save the label: " + error.message); }); }}
            onUpload={(fl) => uploadArt(fl)} onRemove={(f) => { const a = art.find((x) => x.id === f.id); if (a) delArt(a); }}>
            {/* the job's notes & photos (one panel, Oct 15: there were two "Production files & notes") */}
            <JobFiles job={{ kind: "o", id: o.id }} bump={filesBump} inside />
          </ProductionPanel>
          </div>
          <aside className="ed-aside">
            {/* every mockup save, and the customer's approval: opened?, remind, approved another way (Oct 16, Nick) */}
            {prodRole && (
              <div className="panel pm-side">
                <div className="panel-b">
                  <b>Production mockup</b>
                  <span className="faint">The real size, placement, inks and screens, confirmed by production, and what we did last time.</span>
                  <Link className="btn primary sm" href={`/shop/orders/${o.id}/production`}>Open production mockup</Link>
                </div>
              </div>
            )}
            <ProofSide orderId={o.id} bump={proofs.length * 1000 + events.length} onChanged={loadSide} customer={cust?.name || cust?.company || ""} email={cust?.email || ""} />
            <JobLabor orderId={o.id} qty={o.qty} total={+o.total || 0} />
          </aside>
        </div>

        {/* Messages: the job's emails and texts, the customer's portal, calls & notes */}
        {/* Goods: its own tab (Oct 29, Nick: "move the goods panel up into its own part of the toolbar… orders, art production,
            then goods, messages") */}
        <div className="ot-one" hidden={tab !== "goods"}>
          {o.status !== "request" ? <OrderGoodsPanel orderId={o.id} wholesale={o.price_type === "wholesale" && o.type === "invoice"} customerId={o.customer_id} />
            : <div className="faint" style={{ padding: 20 }}>Goods are tracked once the request is accepted.</div>}
        </div>
        <div className="ed-grid" hidden={tab !== "msg"}>
          <div className="stack">
            <JobTalk jobRef={`o:${o.id}`} onCount={setTalkN} />
            <OriginalJobTalk notes={o.notes} orderId={o.id} />
          </div>
          <aside className="ed-aside">
          <section className="panel" id="messages">
            <div className="panel-h"><h2>Customer portal</h2><Pill status={o.status} portal /></div>
            <div className="panel-b stack">
              {o.status !== "quote" && <div className="comm-sum">
                <div><span>Quote</span><b>{o.approved_at ? `Approved by ${o.approved_name || "customer"}` : o.sent_at ? `Sent ${fmtStamp(o.sent_at)}` : "In portal"}</b></div>
                {o.approved_at && <div><span>Approved</span><b>{fmtStamp(o.approved_at)}</b></div>}
                {proofs.length > 0 && <div><span>Proofs</span><b>{[proofs.filter((p) => p.status === "approved").length && `${proofs.filter((p) => p.status === "approved").length} approved`, pendingProofs && `${pendingProofs} waiting`, proofs.filter((p) => p.status === "changes").length && `${proofs.filter((p) => p.status === "changes").length} changes requested`].filter(Boolean).join(" · ")}</b></div>}
                <div><span>Messages</span><b>{messages.length ? `${messages.length} · last ${messages[messages.length - 1].author_type === "staff" ? "from you" : "from customer"} ${fmtStamp(messages[messages.length - 1].created_at)}` : "None yet"}</b></div>
              </div>}
              {o.status === "quote" ? (
                <>
                  <SendProofTool target={{ kind: "order", orderId: o.id }} label="Send to customer" before={beforeSend} onDone={afterSend} />
                </>
              ) : (
                <>
                  <div className="muted" style={{ fontSize: 13 }}>{o.sent_at ? `Sent ${fmtStamp(o.sent_at)}.` : "Visible in the customer's portal."} {o.approved_at ? `Approved by ${o.approved_name}.` : o.type === "quote" ? "Waiting for approval." : ""}</div>
                  <SendProofTool target={{ kind: "order", orderId: o.id }} label="Send to customer" primary={false} before={beforeSend} onDone={afterSend} />
                  <SendProofTool target={{ kind: "order", orderId: o.id }} mode="copy" onDone={say} />
                </>
              )}
              {o.status !== "quote" && (
                <div className="row">
                  <input type="text" readOnly value={portalLink} aria-label="Portal link" onFocus={(e) => e.target.select()} />
                  <button className="btn sm" type="button" onClick={() => navigator.clipboard?.writeText(portalLink).then(() => say("Link copied"))}>Copy</button>
                </div>
              )}
              {o.status !== "quote" && (
                <>
              <div className="lbl" style={{ marginTop: 4 }}>MESSAGES</div>
              {messages.length ? (
                <div className="thread">
                  {messages.map((m) => (
                    <div key={m.id} className={"msg " + (m.author_type === "staff" ? "me" : "them")}>
                      <div className="who">{m.author_type === "staff" ? "You" : m.author_name || m.author_email} · {fmtStamp(m.created_at)}</div>{m.body}
                    </div>
                  ))}
                </div>
              ) : <div className="faint" style={{ fontSize: 13 }}>No messages yet. Customers can write to you from their portal.</div>}
              <div className="qr-row">
                <select aria-label="Quick reply" value="" onChange={(e) => { const k = e.target.value as TemplateKey; if (k) setDraftMsg(renderTemplate(k, tv).body); }}>
                  <option value="">Quick reply…</option>
                  {QUICK.map((k) => <option key={k} value={k}>{TEMPLATES[k].label}</option>)}
                </select>
                <span className="faint" style={{ fontSize: 11.5 }}>Fills the box below. Edit before sending.</span>
              </div>
              <div className="composer">
                <textarea aria-label="Message to customer" placeholder="Write to the customer…" value={draftMsg} onChange={(e) => setDraftMsg(e.target.value)} />
                <button className="btn primary" type="button" onClick={postMessage} disabled={!draftMsg.trim()}>Send</button>
              </div>
                </>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Calls &amp; notes</h2><span className="faint" style={{ fontSize: 12 }}>Shop only</span></div>
            <div className="panel-b"><Timeline customerId={o.customer_id} orderId={o.id} compact /></div>
          </section>
          </aside>
        </div>

        {/* Payments */}
        {seesMoney && <div className="ed-grid" hidden={tab !== "pay"}>
          <div className="stack">
          <section className="panel money-only">
            <div className="panel-h"><h2>Payments</h2></div>
            <div className="panel-b stack">
              {payments.length ? <div>{payments.map((p) => (
                <div key={p.id} className="pay-row"><span>{fmtDate(p.paid_on)} · {p.method}{p.stripe_session_id ? " (online)" : ""}</span>
                  <span className="row"><b className="num">{money(p.amount)}</b>{canPay && <button className={"btn icon ghost sm" + (armed === "pay" + p.id ? " danger armed" : "")} type="button" aria-label="Remove payment" onClick={() => delPayment(p.id)}>✕</button>}</span></div>
              ))}</div> : <div className="faint" style={{ fontSize: 13 }}>No payments recorded.</div>}
              {canPay && <div className="pay-add">
                <input type="number" step="0.01" placeholder="Amount" aria-label="Payment amount" value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                <select aria-label="Payment method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select>
                <input type="date" aria-label="Payment date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                <button className="btn" type="button" onClick={addPayment}>Record</button>
              </div>}
              {canPay && calc.balance > 0.004 && calc.total > 0 && (
                <div className="row">
                  <button className="btn sm" type="button" onClick={() => setPayAmt(((calc.total * settings.depositPct) / 100).toFixed(2))}>{settings.depositPct}% deposit</button>
                  <button className="btn sm" type="button" onClick={() => setPayAmt(calc.balance.toFixed(2))}>Full balance</button>
                </div>
              )}
              {canPay && String(o.status) !== "void" && <PayReadiness order={o as Order & { pay_mode?: string | null; pay_not_final?: boolean | null; pay_note?: string | null }} paid={calc.paid} depositPct={settings.depositPct} terms={cust?.payment_terms || "receipt"} deposit={Math.min(calc.balance, Math.round(calc.total * settings.depositPct) / 100)} />}
              {canPay && calc.balance > 0.004 && <ChargeOnFile orderId={o.id} customerId={o.customer_id} balance={calc.balance} feePct={settings.pay.cardFeePct} onDone={() => window.location.reload()} />}
            </div>
          </section>
          </div>
          <aside className="ed-aside">
          <section className="panel money-only">
            <div className="panel-h"><h2>Totals</h2><span className="faint num">{calc.qty} pcs</span></div>
            <div className="panel-b">
              <div className="totals">
                <div className="tr"><span>Line items</span><span>{money(calc.items)}</span></div>
                <div className="tr"><span title={adjFee ? `Includes ${money(adjFee)} setup adjustment from Printavo` : undefined}>Setup (screens, digitizing)</span><span>{money(calc.setup + adjFee)}</span></div>
                {calc.materials ? <div className="tr"><span>2XL+ Materials Charge</span><span>{money(calc.materials)}</span></div> : null}
                {calc.fees - calc.shipping - adjFee ? <div className="tr"><span>Fees</span><span>{money(calc.fees - calc.shipping - adjFee)}</span></div> : null}
                {calc.hasShipping ? <div className="tr"><span>Shipping</span><span>{calc.freeShipping ? "Free" : money(calc.shipping)}</span></div> : null}
                <div className="tr"><span className="row" style={{ gap: 6 }}>Discount
                  <input type="number" step="0.01" min="0" aria-label="Discount" style={{ width: 66, padding: "3px 6px" }} placeholder="0"
                    value={(o.discount_type === "amt" ? o.discount_amt : o.discount_pct) || ""}
                    onChange={(e) => patch((d) => { const v = Math.max(0, +e.target.value || 0); if (d.discount_type === "amt") d.discount_amt = v; else d.discount_pct = Math.min(100, v); })} />
                  <select aria-label="Discount type" style={{ width: 52, padding: "3px 4px" }} value={o.discount_type === "amt" ? "amt" : "pct"}
                    onChange={(e) => patch((d) => { const v = d.discount_type === "amt" ? d.discount_amt || 0 : d.discount_pct || 0; d.discount_type = e.target.value === "amt" ? "amt" : "pct"; if (d.discount_type === "amt") { d.discount_amt = v; d.discount_pct = 0; } else { d.discount_pct = Math.min(100, v); d.discount_amt = 0; } })}>
                    <option value="pct">%</option><option value="amt">$</option>
                  </select></span><span>{calc.discount ? `−${money(calc.discount)}` : money(0)}</span></div>
                <div className="tr"><span className="row" style={{ gap: 6 }}>Tax <input type="number" step="0.01" aria-label="Tax rate percent" style={{ width: 66, padding: "3px 6px" }} placeholder={String(settings.taxRate)} value={o.tax_rate ?? ""} onChange={(e) => patch((d) => { d.tax_rate = e.target.value === "" ? null : +e.target.value; })} />%</span><span>{o.tax_exempt ? "Exempt" : money(calc.tax)}</span></div>
                <label className="check" style={{ fontSize: 12, color: "var(--ink-2)" }}><input type="checkbox" checked={o.tax_exempt} onChange={(e) => patch((d) => { d.tax_exempt = e.target.checked; })} /> Tax exempt</label>
                <div className="tr big"><span>Total{calc.shippingTbd ? <small className="faint" style={{ fontSize: 12, fontWeight: 400, marginLeft: 6 }}>+ shipping TBD</small> : null}</span><span>{money(calc.total)}</span></div>
                <div className="tr"><span>Paid</span><span>{money(calc.paid)}</span></div>
                <div className="tr bal"><span>Balance due</span><span style={{ color: calc.balance > 0.004 ? "var(--ink)" : "var(--ok)" }}>{money(calc.balance)}</span></div>
              </div>
            </div>
          </section>
          </aside>
        </div>}

        {/* Activity */}
        <div className="ot-one" hidden={tab !== "act"}>
          <section className="panel">
            <div className="panel-h"><h2>History</h2></div>
            <div className="panel-b hist">
              {events.length ? events.filter((e) => seesMoney || e.kind !== "payment").map((e) => (
                <div key={e.id}>{e.kind === "status" ? <Pill status={e.detail} /> : <b>{EVENT_LABEL[e.kind] || e.kind}</b>}<span>{e.kind !== "status" && e.detail ? e.detail + " · " : ""}{fmtStamp(e.created_at)}</span></div>
              )) : <div>No activity yet.</div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** QuickBooks' mark, small, in QuickBooks green (the order's "in QuickBooks" check and the delete question) */
function QbMark() {
  return <QbLogo className="qb-mark" />;
}

/** loads the name and carrier of a customer's own EasyPost carrier account (customers.ship_on) once */
function OwnAcctLoad({ id, onLoad }: { id: string; onLoad: (a: { id: string; name: string; carrier: string }) => void }) {
  useEffect(() => {
    let live = true;
    fetch("/api/shipping/accounts").then((r) => r.json()).then((j) => {
      const a = (j.accounts || []).find((x: { id: string }) => x.id === id) as { id: string; description: string; readable: string } | undefined;
      if (live) onLoad({ id, name: a ? a.description || `${a.readable} account` : "their account", carrier: a && /ups/i.test(a.readable) ? "UPS" : "FedEx" });
    }).catch(() => { if (live) onLoad({ id, name: "their account", carrier: "FedEx" }); });
    return () => { live = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
