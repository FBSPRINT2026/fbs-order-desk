"use client";
import PrintavoMark from "@/components/PrintavoMark";
import type { BrandColor } from "@/lib/pricing";
import { colorHex } from "@/lib/inkColors";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import RequestAsk, { isSentRequest } from "@/components/RequestAsk";
import { ArtSearchContext, PageSearchContext } from "@/components/ArtSearchContext";
import Link from "next/link";
import { LogoFace, ShirtView, onShirtsOf } from "@/components/LogoOnShirts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import MockupOrderButton from "@/components/MockupOrderButton";
import { ST, isClosedQuote, statusKey, type Design } from "@/lib/pricing";
import { fmtDateLong, money } from "@/lib/format";
import { designMatches } from "@/components/DesignSearch";
import PayPanel, { type PayItem } from "@/components/PayPanel";
import { matches } from "@/lib/search";
import QuickPay from "@/components/QuickPay";
import RecordPayment from "@/components/RecordPayment";
import type { PayFilter } from "@/lib/paySelect";
import SearchInput from "@/components/SearchInput";
import { useSticky } from "@/lib/useSticky";
import MockupViewer from "@/components/MockupViewer";
import type { MockupDetail } from "@/lib/mockupDetail";
import { PaidMark, Pill } from "@/components/bits";
import { StarOrder } from "@/components/PortalDashBits";
import PortalSwitch from "@/components/PortalSwitch";
import { heldFiles } from "@/lib/heldFiles";
import RowLink from "@/components/RowLink";
import { useUrlSearch } from "@/lib/useUrlSearch";
import PortalSimpleMenu, { SimpleBack, SimpleMenuContext } from "@/components/PortalSimpleMenu";

export type AOrder = { /** a logo on it is in digitizing (lib/portalView.ts digitizeNote): the status the customer sees */ digitizing?: string; /** the credit card fee already in its balance (lib/cardFeeIn.ts) */ cardFeeIn?: number; /** which of the customer's order types it is (Cedar: Bulk / Cart), or empty */ order_lane?: string; id: string; number: number; nickname: string; status: string; type: string; total: number; paid: number; balance: number; due_date: string | null; created_at: string; qty: number; price_type?: string; /** payment due date under the customer's terms */ pay_due?: string | null;
  /** an old order from before (read-only): opens at `href` and shows its own status name and color */ archived?: boolean; href?: string; statusLabel?: string; statusColor?: string;
  /** an old (Printavo) invoice with a balance: its online invoice, where it can be paid until the cutover */ payUrl?: string;
  /** an old invoice of an account that has moved to the new system: paid here, not on Printavo (Nov 2, Nick) */ payHere?: boolean;
  /** what else the order can be found by: garments, colors, imprint details, notes… */ search?: string;
  /** shop: Printavo's own status for a 40,000 job sent there (pvStatusOf), shown like the Orders page */ pv?: string;
  /** an order request the customer has sent us, waiting on our confirmation (Oct 24) */ sent?: boolean;
  /** on hold: "On hold · Payment needed" (lib/holds.ts), shown instead of the status */ hold?: string;
  /** portal: the customer starred it to track it (up to 9) */ starred?: boolean;
  /** a quote the customer archived (not going ahead) */ archivedQ?: boolean; /** they asked us to cancel */ cancelAsked?: boolean;
  /** portal: what can be paid now (lib/payReady.ts), why not, and whether charges may still change */ payCan?: "none" | "deposit" | "full"; payWhy?: string; notFinal?: boolean; payNote?: string };
export type APayment = { id: string; order_id: string; number: number; amount: number; method: string; paid_on: string | null; created_at: string; href?: string;
  /** the invoice's name, and whether it's an old-system (Printavo) one: shown in the payment history (Nov 2) */ nickname?: string; archived?: boolean; /** one online payment can cover many orders: same processor id / "paid together" note */ processor_id?: string | null; note?: string | null; fee?: number | null };
export type AMockup = { id: string; title: string; url: string; thumb: string; number: number | null; order_id: string | null; created_at: string; starred?: boolean;
  /** made by the shop (staff), not the customer: each side edits only its own (Nov 3) */ byFbs?: boolean;
  /** the mockup's own number, M-1001 (one per set: every shirt color saved together shares it) */ mno?: number | null;
  /** saved with its setup (garments, prints, inks), so it can be opened to edit or ordered */ setup?: boolean;
  /** archived by the customer or the shop: shown under Archive */ shelved?: boolean;
  /** the garment and its prints, for the mockup viewer (lib/mockupDetail.ts) */ detail?: MockupDetail };
export type AMessage = { id: string; order_id: string | null; number: number | null; author_type: string; author_name: string; body: string; created_at: string };
/** Things waiting on someone: shown in the "Requires your attention" panel. */
export type AAttn = { kind: "draft" | "request" | "quote" | "art" | "pay" | "receive"; order_id: string; number: number; date: string; hash?: string; /** overrides the default wording */ label?: string; href?: string };
export type Area = "home" | "quotes" | "orders" | "invoices" | "payments" | "artwork" | "designs" | "messages" | "texts" | "receive" | "details" | "projects" | "program" | "pricing";

const IN_WORK = ["approved", "art", "blanks", "production", "ready"];
const WAITING = ["approved", "art", "blanks"];
const has = matches;
const when = (d?: string | null) => (d ? fmtDateLong(d.slice(0, 10)) : "");
const today = () => new Date().toISOString().slice(0, 10);

/* small line icons for the top menu and stat cards */
const I = {
  home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
  quotes: "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7",
  orders: "M4 7h16v13H4zM8 7V4h8v3M4 12h16",
  invoices: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4",
  payments: "M3 6h18v12H3zM3 10h18M7 15h3",
  artwork: "M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 9a1.5 1.5 0 1 0 0-.01",
  messages: "M4 5h16v11H9l-5 4z",
  texts: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2",
  receive: "M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8",
  details: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",
  due: "M12 7v5l3 3M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z",
  dollar: "M12 3v18M16 7c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 2.6 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3",
  arrow: "M5 12h14M13 6l6 6-6 6",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  archive: "M3 4h18v4H3zM5 8v12h14V8M10 12h4",
  projects: "M3 7h6l2 2h10v10H3zM3 7V5h6l2 2",
  program: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.8 1l-.3 2h-4l-.3-2a7 7 0 0 1-1.8-1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3L3 9.3l2-3.4 1.9.7a7 7 0 0 1 1.8-1l.3-2h4l.3 2a7 7 0 0 1 1.8 1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z",
};
export const Ico = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

/**
 * A customer's account split into areas (quotes, orders, payments, artwork, messages…), each searchable. Orders and invoices are the same thing here.
 * Used on the shop's customer page (mode "shop") and in the customer's portal (mode "portal").
 */
export default function AccountAreas({ simple = false, titleAsk, newMockup, programMockups = {}, gangPanel, brandPortal = true, onBrandPortal, brandColors = [], brandEditor, customerName = "", orderTypes = [], dash, mode, textsPanel, textsCount, productionPanel, brandsPanel, projectsPanel, projectsCount, programPanel, hasProgram, designsPanel, assistant, onPaySelect, statementHref, onEmailStatement, onRecordPayment, messagesPanel, greeting, goodsPanel, goodsHome, goodsCount, orders: orders0, payments: payments0, moreOrders, designs, designUrls, mockups, messages, attention, homeTop, details, creditBox, hrefBase, hrefQuery = "", onSend, onStar, usedIds = [], onDelete, onArchive, onStarMockup, onArchiveMockup, settingsHref, pricingPanel, drafts = [], onDiscardDraft, onUploadLogos, onDeleteForever, logoShirts = {}, logoLooks = {}, payCfg, terms, canAct = true }: {
  mode: "shop" | "portal";
  /** the customer's DTF gang sheets, under Artwork (shop only; Oct 26) */
  gangPanel?: ReactNode;
  /** the customer's brand colors ("Red" = PMS 199 C), shown under Artwork → Brand standards (Oct 16) */
  brandColors?: BrandColor[];
  /** staff: the brand standards editor (components/CustomerBrandColors.tsx), shown in place of the read-only list */
  brandEditor?: ReactNode; customerName?: string; /** the customer's order types (customers.order_types): a switch on the orders list */ orderTypes?: string[];
  /** the printable statement (open invoices + aging + pay it all) */
  statementHref?: string;
  /** staff: email the customer their statement link */
  onEmailStatement?: () => Promise<{ ok: boolean; error?: string; emailed?: boolean }>;
  /** staff: one check / ACH across many invoices, oldest first */
  onRecordPayment?: (p: { amount: number; method: string; paid_on: string; note: string; preview?: boolean }) => Promise<{ ok: boolean; error?: string; applied?: { number: number; amount: number; full: boolean }[]; total?: number }>;
  /** portal: reads "pay all of August"-style requests (AI); without it the built-in phrase reader is used */
  onPaySelect?: (text: string) => Promise<{ ok: boolean; error?: string; filter?: PayFilter; explain?: string; off?: boolean }>;
  /** portal: the whole dashboard (components/PortalDash.tsx), built on the server */
  dash?: ReactNode;
  /** the simple portal (customers.portal_view): its home is one page, without the tab bar or the page's title row */ simple?: boolean;
  /** the Messages hub (the dashboard's centerpiece in the portal, and the Messages area) */
  messagesPanel?: ReactNode;
  /** the customer's texts from the Mac (owners only; Oct 15) */ textsPanel?: ReactNode; textsCount?: number;
  /** staff only: the customer's production files (separations, digitized files…), under Artwork; never in the portal */
  productionPanel?: ReactNode;
  /** the customer's brands (Cedar Promos: MEI, ShipStation…), above their logos (Oct 27) */ brandsPanel?: ReactNode;
  /** projects (a conference, a season: several orders, dates, tasks, one conversation) */
  projectsPanel?: ReactNode; projectsCount?: number;
  /** program pricing: the customer's flat-price items and order form; grayed out when they don't have one */
  programPanel?: ReactNode; hasProgram?: boolean;
  /** shop: the Mockup Creator for this customer, no order (its Logo mockup adds &logo=1) */ newMockup?: string;
  /** mockups their program uses (number → the price's name): kept, so no Archive on them (migration 249) */ programMockups?: Record<number, string>;
  /** staff: the customer's designs, every way each was printed (Oct 20, Nick: Dear Heart) */
  designsPanel?: ReactNode;
  /** shop: brand standards shown in their portal, switched on the card's header line (Oct 24, Nick) */ brandPortal?: boolean; onBrandPortal?: (v: boolean) => void;
  /** portal: the helper at the top of the dashboard ("What can I help you with today?") */
  assistant?: ReactNode;
  /** portal: "Hi Jordan" line over the dashboard */
  greeting?: string;
  /** wholesale: the customer supplied goods area (full), a compact version for the dashboard, and how many need attention */
  goodsPanel?: ReactNode; goodsHome?: ReactNode; goodsCount?: number;
  orders: AOrder[]; payments: APayment[];
  /** portal: the rest of a long old-order history, fetched just after the page is up (lib/portalArchive.ts) */
  moreOrders?: () => Promise<{ orders: AOrder[]; payments: APayment[] }>;
  designs: Design[]; designUrls: Record<string, string>; mockups: AMockup[]; messages: AMessage[];
  attention: AAttn[];
  /** shown at the top of the dashboard (portal: Start an order / Make a mockup) */
  homeTop?: ReactNode;
  /** staff only: the customer details form */
  details?: ReactNode;
  /** the customer's credit, at the top of Payments (components/CreditBox.tsx) */ creditBox?: ReactNode;
  /** order links: hrefBase + id + hrefQuery (e.g. "/portal/orders/" + id + "?as=…") */
  hrefBase: string; hrefQuery?: string;
  onSend?: (body: string) => Promise<{ ok: boolean; error?: string; emailed?: boolean }>;
  onStar?: (designId: string, starred: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** the shirt color each logo was printed on (its latest order), for the card's background */
  logoShirts?: Record<string, string>;
  /** how each logo last printed (lib/logoShirts.ts logoPrintFrom / logoShownFrom): the mockup's picture of it, signed, or
   *  its ink map on that shirt, so the cards look the way it ran, as on the shop's Artwork page (Nov 1, Nick: "didn't we
   *  make it so these artworks looked more like they do on the shirts") */
  logoLooks?: Record<string, { printed?: { shirt: string; map?: Record<string, { hex: string; name: string }>; ink?: string }; shown?: { url: string; shirt: string } }>;
  /** shop: bring logos in for future use (Oct 16, Nick: "a good thing to knock out when we're transitioning them") */
  onUploadLogos?: (files: File[], star: boolean, progress: (done: number) => void) => Promise<string | void>;
  /** logos on a mockup or order: archive only, no delete */
  usedIds?: string[];
  onDelete?: (designId: string) => Promise<{ ok: boolean; error?: string }>;
  onStarMockup?: (mockupId: string, starred: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** portal: the customer's Settings page, on the right of the tab bar (Oct 24) */ settingsHref?: string;
  /** portal dashboard: the AI ask box on the title line, in place of its search (Nov 2, Nick) */ titleAsk?: ReactNode;
  /** portal, wholesale accounts: their price list, a tab just before Settings (Oct 24, Nick) */ pricingPanel?: ReactNode;
  /** portal: their unsent drafts (no number yet), to pick up again or throw away (Oct 24) */ drafts?: { id: string; name: string; updated: string; pcs: number }[];
  onDiscardDraft?: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** archive / bring back a mockup set (Oct 24) */ onArchiveMockup?: (mockupId: string, on: boolean) => Promise<{ ok: boolean; error?: string }>;
  onArchive?: (designId: string, archived: boolean) => Promise<{ ok: boolean; error?: string }>;
  /** shop: an archived logo deleted for good (its orders keep their mockups) */
  onDeleteForever?: (designId: string) => Promise<{ ok: boolean; error?: string }>;
  /** the customer's payment terms, e.g. "Net 30 days" */
  terms?: string;
  /** portal: online payments (card fee %, Zelle/Venmo details, Stax web payments token, deposit %) */
  payCfg?: { cardFeePct: number; zelle: string; venmo: string; staxToken: string; depositPct: number; /** receipts go here by default */ receiptEmail?: string };
  /** false in the staff preview of a portal: sending is turned off */
  canAct?: boolean;
}) {
  // a long history's older orders arrive after the first paint and join the lists (Nov 5: Cedar Promos was slow)
  const [older, setOlder] = useState<{ orders: AOrder[]; payments: APayment[] } | null>(null);
  useEffect(() => {
    if (!moreOrders) return;
    let live = true;
    const t = setTimeout(() => { moreOrders().then((r) => { if (live) setOlder(r); }).catch(() => {}); }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [moreOrders]);
  const orders: AOrder[] = useMemo(() => (older ? [...orders0, ...older.orders.filter((o) => !orders0.some((x) => x.id === o.id))] : orders0), [orders0, older]);
  const payments: APayment[] = useMemo(() => (older ? [...payments0, ...older.payments].sort((a, b) => (b.paid_on || b.created_at).localeCompare(a.paid_on || a.created_at)) : payments0), [payments0, older]);
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  const hrefs = useMemo(() => Object.fromEntries(orders.filter((o) => o.href).map((o) => [o.id, o.href as string])), [orders]);
  const orderHref = (id: string, hash?: string) => hrefs[id] || `${hrefBase}${id}${hrefQuery}${hash ? "#" + hash : ""}`;
  const pill = (o: AOrder) => o.archived
    ? <span className="aa-pill" style={{ ["--sc" as string]: o.statusColor || "var(--ink-3)" }}>{o.statusLabel || "Archived"}</span>
    : o.cancelAsked ? <span className="aa-pill" style={{ ["--sc" as string]: "var(--danger)" }}>Cancellation requested</span>
    : o.archivedQ ? <span className="aa-pill" style={{ ["--sc" as string]: "var(--ink-3)" }}>Archived</span>
    : o.hold ? <span className="aa-pill" style={{ ["--sc" as string]: "var(--warn)" }} title={ST[statusKey(o)]?.portal || ST[statusKey(o)]?.label}>{o.hold}</span>
    : o.digitizing ? <span className="aa-pill" style={{ ["--sc" as string]: ST.art?.c || "var(--accent)" }}>{o.digitizing}</span>
    : o.status === "request"
      // the customer's own order requests: not sent yet, or sent to us and waiting on our OK (Oct 24, Nick)
      ? <span className="aa-pill" style={{ ["--sc" as string]: o.sent ? "var(--fbs-orange, #F7941D)" : "var(--ink-3)" }}>{o.sent ? "Waiting on FBS" : "Not sent yet"}</span>
      : <span className="aa-pill" style={{ ["--sc" as string]: ST[statusKey(o)]?.c }} title={ST[statusKey(o)]?.portal || ST[statusKey(o)]?.label}>{ST[statusKey(o)]?.portal || ST[statusKey(o)]?.label}</span>;
  const rawArea = (sp.get("area") as Area) || "home";
  // portal: quotes and orders are one "Orders" tab with a Quotes / Orders switch inside
  // shop (Oct 21, Nick: "the dashboard can be dashboard and orders… it just needs to be simpler"): Quotes and Orders are
  // the Orders tab's Active / Quotes / Done; Texts are in Conversations; Details is a panel the page opens
  const shopArea: Record<string, Area> = { quotes: "home", orders: "home", invoices: "home", texts: "messages", details: "home" };
  // the portal's other names for its areas (a link or a bookmark saying "goods" or "art"); an area this page doesn't have
  // opens the dashboard instead of a blank page (Oct 31: ?area=goods showed nothing but the header)
  const portalArea: Record<string, Area> = { quotes: "orders", goods: "receive", art: "artwork", artwork: "artwork", payment: "payments", pricing: "pricing" };
  const KNOWN = ["home", "orders", "payments", "artwork", "messages", "receive", "projects", "program", "pricing", "settings", "designs"];
  const area0: Area = mode === "portal" ? (portalArea[rawArea] || rawArea) : shopArea[rawArea] || rawArea;
  const area: Area = mode === "portal" && !KNOWN.includes(area0) ? "home" : area0;
  // All (quotes and orders, newest first, like Printavo), Quotes, Completed (Oct 21, Nick)
  const [ordF, setOrdF] = useSticky<"all" | "requests" | "quotes" | "orders" | "completed">("customer.orderList", "all");
  const oFilter: "all" | "requests" | "quotes" | "orders" | "completed" = mode === "shop" && rawArea === "quotes" ? "quotes" : ["all", "requests", "quotes", "orders", "completed"].includes(ordF) ? ordF : "all";
  const [conv, setConv] = useSticky<"portal" | "texts">("customer.conversations", "portal");
  const [bsOpen, setBsOpen] = useSticky<boolean>("customer.brandOpen", false);
  const [shopArtTab, setShopArtTab] = useSticky<string>("customer.artTab", "art");
  const convNow = rawArea === "texts" ? "texts" : conv;
  // where the More menu opens: fixed under its button (the tab bar clips anything that drops out of it)
  const [moreOpen, setMoreOpen] = useState<{ top: number; right: number } | null>(null);
  const [recOpen, setRecOpen] = useState(false);
  const [sub, setSub] = useState<"quotes" | "orders">(rawArea === "quotes" || sp.get("sub") === "quotes" ? "quotes" : "orders");
  const go = (a0: Area) => { let a = a0; if (mode === "portal" && (a === "quotes" || a === "orders")) { setSub(a === "quotes" ? "quotes" : "orders"); a = "orders"; } const p = new URLSearchParams(window.location.search); p.delete("q"); /* a new tab starts with no search */ if (a === "home") p.delete("area"); else p.set("area", a); const url = `${path}${p.size ? "?" + p : ""}`;
    // portal: every tab's data is already on the page, so switching is instant (Oct 24, Nick: "the customer portal is
    // slow… it just kind of spins"); the address changes without asking the server for the whole page again
    if (mode === "portal") window.history.replaceState(null, "", url); else router.replace(url, { scroll: false }); };
  const [q, setQ] = useUrlSearch("q");
  const [homeTab, setHomeTab] = useState<"quotes" | "orders" | "current" | "past">("orders");
  const [stars, setStars] = useState<Record<string, boolean>>({});
  const [starErr, setStarErr] = useState("");
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const [mStars, setMStars] = useState<Record<string, boolean>>({});
  // mockups archived / brought back here (Oct 24): set id → archived
  const [mShelf, setMShelf] = useState<Record<string, boolean>>({});
  const [goneDrafts, setGoneDrafts] = useState<Record<string, boolean>>({});
  const [arch, setArch] = useState<Record<string, string | null>>({});
  const [armedDel, setArmedDel] = useState("");
  // a one-time look, not remembered: leaving Artwork or refreshing goes back to the live list (Oct 24, Nick)
  const [showArch, setShowArch] = useState(false);
  useEffect(() => { if (area !== "artwork") setShowArch(false); }, [area]); // eslint-disable-line react-hooks/exhaustive-deps
  const [shirtSel, setShirtSel] = useState<Record<string, number>>({});
  /** portal Orders: quotes older than 60 days are hidden unless this is ticked (Oct 15, Nick) */
  const [oldQuotes, setOldQuotes] = useSticky("portal.oldQuotes", false);
  // the Orders tab's own tabs (Oct 24, Nick: "if they've got a bunch of quotes sitting there, they don't even get to the
  // orders… all quotes and orders just like we have on our order screen")
  // our side: a customer's order request asks to open in the Job Center, right here (components/RequestAsk.tsx)
  const [rqAsk, setRqAsk] = useState<AOrder | null>(null);
  // which order type to show (Nov 2, Nick: "he'll be able to toggle between… all, bulk, or cart")
  const [lane, setLane] = useSticky<string>("customer.orderLane", "all");
  const [oTab, setOTab] = useSticky<"all" | "drafts" | "quotes" | "sent" | "orders" | "done">("portal.ordersTab", "all");
  // a link can open a tab (the dashboard's "3 more" under Orders sent to FBS opens Sent to FBS, Nov 2, Nick)
  useEffect(() => { const t = sp.get("show") || (mode === "shop" && sp.get("area") === "quotes" ? "quotes" : ""); if (t && ["all", "drafts", "quotes", "sent", "orders", "done"].includes(t)) setOTab(t as typeof oTab); }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showOldOwed, setShowOldOwed] = useState(false);
  const [viewSet, setViewSet] = useState<AMockup[] | null>(null);
  const [payF, setPayF] = useSticky<"open" | "late" | "later">("portal.payFilter", "open");
  // the due date's order (Nov 2, Nick: "an up and down so that you can toggle… oldest to newest… newest to oldest")
  const [dueSort, setDueSort] = useSticky<"asc" | "desc">("payments.dueSort", "asc");
  // artwork shows 6 at a time (two rows of three), with pages underneath
  const [pg, setPg] = useState<Record<string, number>>({});
  // "Pay this statement" arrives with ?pay=all: everything open is checked
  const [paySel, setPaySel] = useState<string[]>(() => (sp.get("pay") === "all" ? orders.filter((o) => o.type === "invoice" && !o.archived && o.balance > 0.004).map((o) => o.id) : []));
  const [stNote, setStNote] = useState("");
  // payment history: its own search, 10 per page, one line per payment (open it to see the invoices it paid)
  const [hq, setHq] = useState("");
  const [hp, setHp] = useState(0);
  const [openPay, setOpenPay] = useState<string | null>(null);
  const [payNow, setPayNow] = useState<PayItem[] | null>(null);
  const [payAmt, setPayAmt] = useState<number | undefined>(undefined);
  const PER = 6;
  const pageOf = <T,>(key: string, list: T[], per = PER) => { const n = Math.max(1, Math.ceil(list.length / per)), p = Math.min(pg[key] || 0, n - 1); const items = list.slice(p * per, p * per + per); return { items, p, n, pad: n > 1 ? per - items.length : 0 }; };
  // empty places keep a short last page the same height, so the page buttons don't move
  const slots = (k: number) => Array.from({ length: k }, (_, i) => <div key={"slot" + i} className="design-card aa-slot" aria-hidden="true" />);
  const pager = (key: string, total: number, p: number, n: number, per = PER) => n <= 1 ? null : (
    <div className="aa-pager">
      <span className="faint">Showing {p * per + 1}–{Math.min(total, p * per + per)} of {total}</span>
      <span className="spacer" />
      <button type="button" className="aa-pg" disabled={p === 0} aria-label="Previous page" onClick={() => setPg((x) => ({ ...x, [key]: p - 1 }))}>‹</button>
      {Array.from({ length: n }, (_, i) => i).filter((i) => n <= 7 || i === 0 || i === n - 1 || Math.abs(i - p) <= 1).map((i, k, arr) => (
        <span key={i} className="row" style={{ gap: 4 }}>{k > 0 && i - arr[k - 1] > 1 && <span className="faint">…</span>}
          <button type="button" className={"aa-pg" + (i === p ? " on" : "")} aria-current={i === p ? "page" : undefined} onClick={() => setPg((x) => ({ ...x, [key]: i }))}>{i + 1}</button></span>
      ))}
      <button type="button" className="aa-pg" disabled={p >= n - 1} aria-label="Next page" onClick={() => setPg((x) => ({ ...x, [key]: p + 1 }))}>›</button>
    </div>
  );
  const ds = useMemo(() => designs.map((d) => (d.id in stars ? { ...d, starred: stars[d.id] } : d)), [designs, stars]);

  const quotes = orders.filter((o) => o.type === "quote" && (mode === "shop" || o.status !== "quote"));
  const inWork = orders.filter((o) => o.type === "invoice" && IN_WORK.includes(o.status));
  const invoices = orders.filter((o) => o.type === "invoice");
  // old archived orders are listed with the rest but aren't paid or tracked here
  const liveInvoices = invoices.filter((o) => !o.archived);
  const receive = orders.filter((o) => o.price_type === "wholesale" && o.type === "invoice" && WAITING.includes(o.status));
  // what they owe: portal orders and invoices from before the portal (Printavo balances are real: Nick, Oct 15)
  const owed = invoices.filter((o) => o.balance > 0.004);
  const oldOwed = owed.filter((o) => o.archived);
  const due = owed.reduce((a, o) => a + Math.max(0, o.balance), 0);
  // payment due date under the customer's terms (null = not due yet, e.g. still being made)
  const payDue = (o: AOrder) => o.pay_due || (o.archived && o.status !== "quote" ? o.due_date || o.created_at?.slice(0, 10) || null : null);
  const overdue = owed.filter((o) => { const d = payDue(o); return d && d < today(); }).reduce((a, o) => a + Math.max(0, o.balance), 0);
  const openQuotes = quotes.filter((o) => !o.archived && o.status === "quote_sent").reduce((a, o) => a + o.total, 0);

  const AREAS: { id: Area; label: string; icon: string; n?: number; show?: boolean }[] = mode === "shop" ? [
    { id: "home", label: "Orders", icon: I.orders, n: inWork.length },
    { id: "artwork", label: "Artwork", icon: I.artwork },
    // the design catalog is a tab inside Artwork, not on the main bar (Nov 3, Nick: "that should be on that page anyway")
    { id: "designs", label: "Design Catalog", icon: I.artwork, show: false },
    { id: "messages", label: "Conversations", icon: I.messages, n: messages.length + (textsCount || 0) },
    { id: "payments", label: "Payments", icon: I.payments },
    // only once it's turned on or added (Oct 21, Nick: "I wouldn't show program pricing on every client unless I added
    // or enabled it"); "More" adds them
    { id: "program", label: mode === "shop" ? "Programs" : "Program", icon: I.program, show: !!programPanel && (!!hasProgram || area === "program") },
    { id: "projects", label: "Projects", icon: I.projects, show: !!projectsPanel && ((projectsCount || 0) > 0 || area === "projects") },
    { id: "receive", label: "Customer goods", icon: I.receive, show: area === "receive" },
  ] : [
    { id: "home", label: "Dashboard", icon: I.home },
    { id: "quotes", label: "Quotes", icon: I.quotes, n: quotes.length, show: (mode as string) === "shop" },
    { id: "orders", label: "Orders", icon: I.orders, n: mode === "portal" ? inWork.length + quotes.filter((o) => !o.archived && o.status === "quote_sent").length : inWork.length },
    // program pricing and the design catalog are tabs inside Pricing and Artwork (Oct 24, Nick: the main bar stays the same)
    { id: "payments", label: "Payments", icon: I.payments },
    { id: "artwork", label: "Artwork", icon: I.artwork },
    // after Artwork, before Messages (Nov 2, Nick)
    { id: "projects", label: "Projects", icon: I.projects, n: projectsCount, show: !!projectsPanel },
    { id: "messages", label: "Messages", icon: I.messages, n: messages.length },
    { id: "texts", label: "Texts", icon: I.texts, n: textsCount, show: (mode as string) === "shop" && !!textsPanel },
    { id: "receive", label: goodsPanel ? ((mode as string) === "shop" ? "Customer goods" : "Goods") : (mode as string) === "shop" ? "To receive" : "Garments to send", icon: I.receive, n: goodsPanel ? goodsCount : receive.length, show: !!goodsPanel || receive.length > 0 },
    { id: "pricing", label: "Pricing", icon: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01", show: mode === "portal" && (!!pricingPanel || (!!programPanel && !!hasProgram)) },
    // staff reach Details from the "Customer details" button in the page header
  ];

  const search = (ph: string) => (
    <label className="aa-search"><Ico d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3" size={16} /><SearchInput placeholder={ph} value={q} onChange={(e) => { setQ(e.target.value); setPg({}); }} /></label>
  );
  // what a row is, in the Orders tab's All list (Oct 24, Nick: "a bubble… that says sent to FBS, quote, or invoice")
  const kindOf = (o: AOrder) => (o.type === "invoice" ? "Order" : o.status === "request" ? (o.sent ? "Sent to FBS" : "Draft") : "Quote");
  const orderTable = (list: AOrder[], cols: "quote" | "work" | "invoice", all = false) => {
    const rows = list.filter((o) => has(q, o.number, o.nickname, ST[o.status]?.label, ST[o.status]?.portal, o.statusLabel, o.archived ? "archived" : "", o.search));
    return (
      <div className="aa-card aa-tblcard">
        {/* the same column widths in every list, so Quotes and Orders line up one above the other (Oct 24, Nick) */}
        <table className="aa-tbl aa-tbl-cols">
          <colgroup><col className="c-no" />{all && <col className="c-ty" />}<col /><col className="c-st" />{cols === "quote" ? <col className="c-dt wide" /> : <><col className="c-dt" /><col className="c-m" /></>}<col className="c-m" />{mode === "portal" && <col className="c-star" />}</colgroup>
          <thead><tr><th>#</th>{all && <th>Type</th>}<th>{cols === "quote" ? "Quote" : "Order"}</th><th>Status</th><th>{cols === "quote" ? "Created" : "In-hands date"}</th>{cols !== "quote" && <th className="r aa-thbal">Balance</th>}<th className="r">Total</th>{mode === "portal" && <th aria-label="Track" />}</tr></thead>
          <tbody>
            {rows.map((o) => { return (
              <tr key={o.id} onClick={() => (mode === "shop" && isSentRequest(o) ? setRqAsk(o) : router.push(orderHref(o.id)))}>
                <td className="num"><Link href={orderHref(o.id)} onClick={(e) => { e.stopPropagation(); if (mode === "shop" && isSentRequest(o)) { e.preventDefault(); setRqAsk(o); } }}>{o.number}</Link>{o.archived && <PrintavoMark />}</td>
                {/* All: what it is, in its own column (Oct 24, Nick: "don't have it impact the job name") */}
                {all && <td data-l="Type"><span className={"aa-kind k-" + kindOf(o).split(" ")[0].toLowerCase()}>{kindOf(o)}</span></td>}
                <td className="m"><div className="aa-t aa-t1"><span className="aa-tn" title={o.nickname || undefined}>{o.nickname || (cols === "quote" ? "Quote" : "Order")}</span></div></td>
                {/* one simple line per order, its own status (Nov 2, Nick: no pink row, and no "Past due" here either) */}
                <td>{pill(o)}</td>
                <td className="dt" data-l={cols === "quote" ? "Created" : "In hands"}>{cols === "quote" ? when(o.created_at) : when(o.due_date) || "—"}</td>
                {/* customers see only the balance and total (Nov 2, Nick: "you don't need paid… more room for the order description") */}
                {/* customers: what's left, and what's been paid under it, or "Paid" once it's all paid (Nov 2, Nick: "I can't tell
                    what's been paid, what's not been paid") */}
                {cols !== "quote" && <td data-l="Balance" className={"r num" + (mode === "shop" && !o.archived && o.balance > 0.004 ? " aa-due" : "")}>{all && o.type !== "invoice" ? "" : mode === "portal" && o.total > 0 && o.balance <= 0.004 ? <span className="aa-paidall">Paid</span> : <span className={mode === "portal" && o.paid > 0.004 ? "aa-balpart" : ""} title={mode === "portal" && o.paid > 0.004 ? `${money(o.paid)} paid so far` : undefined}>{money(Math.max(0, o.balance))}</span>}</td>}
                {/* on a narrower screen the Balance column goes and its words sit under the total (globals.css aa-tbal) */}
                <td className="r num b" data-l="Total">{money(o.total)}{cols !== "quote" && !(all && o.type !== "invoice") && <span className="aa-tbal">{o.total > 0 && o.balance <= 0.004 ? "Paid" : o.balance > 0.004 ? `${money(o.balance)} due` : ""}</span>}</td>
                {/* the star on the right (Oct 24, Nick) */}
                {mode === "portal" && <td className="aa-starc" onClick={(e) => e.stopPropagation()}>{!o.archived && <StarOrder id={o.id} on={!!o.starred} canAct={canAct} />}</td>}
              </tr>
            ); })}
            {!rows.length && <tr><td colSpan={9}><div className="aa-empty">{list.length ? `No matches for “${q}”.` : "Nothing here yet."}</div></td></tr>}
          </tbody>
        </table>
        {/* on a phone the table becomes these cards (Oct 24, Nick: "Orders screen is still cumbersome"): the job's name
            and star, one line of number · pieces · in-hands, then its status and the one amount that matters */}
        {/* the same cards on the shop's customer page (Nov 3, Nick: "I don't like how the order list looks on the shop site on
            the phone"): one list, both sides */}
        <ul className="aa-ocards">
          {rows.map((o) => {
            const owes = !o.archived && o.balance > 0.004 && !(all && o.type !== "invoice") && cols !== "quote";
            const dt = cols === "quote" ? when(o.created_at) : when(o.due_date);
            return (
              <li key={o.id} className="rl aa-oc" onClick={mode === "shop" && isSentRequest(o) ? () => setRqAsk(o) : undefined}>
                <RowLink href={orderHref(o.id)} off={mode === "shop" && isSentRequest(o)} label={`Open ${o.nickname || `#${o.number}`}`} />
                <div className="aa-oc-top">
                  <Link href={orderHref(o.id)} className="aa-oc-n" onClick={(e) => { e.stopPropagation(); if (mode === "shop" && isSentRequest(o)) { e.preventDefault(); setRqAsk(o); } }}>{o.nickname || (o.type === "invoice" ? "Order" : "Quote")}</Link>
                  {o.archived ? <PrintavoMark /> : mode === "portal" && <span onClick={(e) => e.stopPropagation()}><StarOrder id={o.id} on={!!o.starred} canAct={canAct} /></span>}
                </div>
                <div className="aa-oc-sub">#{o.number}{o.qty ? ` · ${o.qty.toLocaleString("en-US")} pcs` : ""}{dt ? ` · ${cols === "quote" ? "Created" : "In hands"} ${dt}` : ""}</div>
                <div className="aa-oc-bot">
                  {pill(o)}
                  {all && kindOf(o) !== "Order" && <span className={"aa-kind k-" + kindOf(o).split(" ")[0].toLowerCase()}>{kindOf(o)}</span>}
                  <span className="aa-oc-amt">{owes ? <><b className={mode === "shop" ? "aa-due" : undefined}>{money(o.balance)}</b><small>due</small></> : <><b>{money(o.total)}</b><small>{cols === "quote" || o.type !== "invoice" ? "total" : o.balance <= 0.004 ? "paid" : "total"}</small></>}</span>
                </div>
              </li>
            );
          })}
          {!rows.length && <li className="aa-empty">{list.length ? `No matches for “${q}”.` : "Nothing here yet."}</li>}
        </ul>
      </div>
    );
  };
  const tableHead = (title: ReactNode, ph: string) => <div className="aa-bar"><div className="aa-bar-l">{title}</div>{search(ph)}</div>;

  // brand standards (Oct 16): in the shop on the Artwork tab; in the portal on its own tab under Artwork (Oct 24, Nick)
  const brandCardEl = (brandColors.length > 0 || brandEditor) ? (
        <div className={"aa-card aa-bsc" + (bsOpen ? " open" : "")}>
          {/* on a phone it folds up under its title (Nov 3, Nick: "Brand standards can be like a drop-down… in phone view") */}
          <div className="aa-sec-h"><button type="button" className="aa-bstog" aria-expanded={bsOpen} onClick={() => setBsOpen(!bsOpen)}><h3>Brand standards</h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg></button>{mode === "shop" ? null : <span className="faint">{"Your colors, matched to the exact ink every time we print for you. To change one, send us a message."}</span>}
            {mode === "shop" && onBrandPortal && <><span className="spacer" style={{ flex: 1 }} /><PortalSwitch on={brandPortal} onChange={onBrandPortal} what="their brand standards" /></>}</div>
          <div className="aa-bsb">{brandEditor || [...new Set(brandColors.map((x) => x.group || ""))].sort((x, y) => (x ? 1 : 0) - (y ? 1 : 0) || x.localeCompare(y)).map((g) => (
            <div key={g || "_"} className="bs-group">
              {(g || [...new Set(brandColors.map((x) => x.group || ""))].length > 1) && <div className="bs-gh">{g || (mode === "portal" ? "Your colors" : `${customerName || "Their"} colors`)}</div>}
              <div className="bs-list">
                {brandColors.filter((x) => (x.group || "") === g).map((b, i) => { const hex = colorHex(b.ink); return (
                  <div key={i} className="bs-item">
                    <span className="bs-sw" style={{ background: hex || "transparent" }} />
                    <span className="bs-t"><b>{b.name || b.ink}</b><small>{b.ink}{hex ? <span className="faint">{hex.toUpperCase()}</span> : null}</small></span>
                  </div>
                ); })}
              </div>
            </div>
          ))}</div>
        </div>
  ) : null;
  // the portal's main tabs never change (Oct 24, Nick: "the toolbar shouldn't change"): extras are tabs inside Artwork and Pricing
  const [artTab, setArtTab] = useSticky<string>("portal.artTab", "art");
  // their design catalog turned on: Design catalog first, then Artwork, as the tab row in place of the Artwork title
  // (Oct 24, Nick: "design catalog should be the first thing they see… then it should say artwork")
  const dcOn = mode === "portal" && !!designsPanel;
  const [dcTab, setDcTab] = useSticky<string>("portal.artTabDc", "catalog");
  const [priceTab, setPriceTab] = useSticky<string>("portal.priceTab", "list");
  const subBar = (subs: [string, string][], cur: string, set: (k: string) => void) => subs.length > 1 ? (
    <div className="toolbar aa-otabs aa-subtabs" data-toolbar><div className="chips">{subs.map(([k, t]) => <button key={k} type="button" className={"chip" + (cur === k ? " on" : "")} onClick={() => set(k)}>{t}</button>)}</div></div>
  ) : null;
  // the orders list, one card for the customer's portal and our customer page, so both say the same thing (Nov 2, Nick: "it
  // should say exactly the same thing on ours… all, sent to FBS, quotes… same statuses")
  const ordersCard = () => {
    // one order type at a time, when the customer has them (Cedar: All · Bulk · Cart)
    const ln = !orderTypes.length || lane === "all" || !orderTypes.includes(lane) ? "all" : lane;
    const inLane = (l: AOrder[]) => (ln === "all" ? l : l.filter((o) => (o.order_lane || "") === ln));
    const qL = inLane(quotes), iL = inLane(invoices);
    // quotes first, then the orders below them, one search on the top line for both (Oct 15, Nick)
    const cutoff = new Date(Date.now() - 60 * 86400000).toISOString();
    const sentQ = qL.filter((o) => o.status === "request" && o.sent);
    // a closed quote (declined) is finished: under Completed, not Quotes (Nov 3, Nick)
    const closedQ = qL.filter((o) => isClosedQuote(o));
    const quotes2 = qL.filter((o) => !(o.status === "request" && o.sent) && !isClosedQuote(o));
    // archived quotes (not going ahead) and quotes over 60 days old show with "Show older quotes and archived" (Oct 24, Nick)
    const recentQ = quotes2.filter((o) => (o.created_at || "") >= cutoff && !o.archivedQ), olderN = quotes2.length - recentQ.length;
    const shownQ = oldQuotes ? quotes2 : recentQ;
    const openQ = quotes2.filter((o) => !o.archived && o.status === "quote_sent").length;
    const draftsLive = drafts.filter((d) => !goneDrafts[d.id]);
    const tab = oTab === "drafts" && !draftsLive.length ? "all" : oTab;
    const done = [...iL.filter((o) => o.status === "completed"), ...closedQ].sort((x, y) => y.number - x.number);
    // All: one list by order number, each with what it is; then each kind on its own (Oct 24, Nick: "when you click all,
    // it just shows all in a row by number… all, then sent to FBS, then quotes, then orders… and completed")
    const allRows = [...sentQ, ...quotes2.filter((o) => !o.archivedQ || oldQuotes), ...iL, ...closedQ].sort((x, y) => y.number - x.number);
    const tabs: [typeof oTab, string, number][] = [["all", "All", 0], ...(draftsLive.length ? [["drafts", "Drafts", draftsLive.length] as [typeof oTab, string, number]] : []), ["sent", "Sent to FBS", sentQ.length] as [typeof oTab, string, number], ["quotes", "Quotes", quotes2.length], ["orders", "Orders", iL.length], ["done", "Completed", done.length]];
    // the orders they follow live on the dashboard only (Nov 2, Nick: "take that off the orders page… the orders I'm
    // following will just be on the main page")
    // one card like the dashboard's Your jobs (Nov 2, Nick: "the floating orders total… should be in the box… like the your
    // jobs on the first page… there and then underneath it, what it is"): its header says which list and what it adds up to
    const secT: Record<string, [string, string]> = {
      all: ["All orders", `${allRows.length} order${allRows.length === 1 ? "" : "s"} and quotes`],
      drafts: ["Drafts", "Not sent to us yet. Pick one up or discard it."],
      sent: ["Sent to FBS", "We're checking these. You'll get a message when we confirm."],
      quotes: ["Quotes", openQ ? `${openQ} waiting on you` : "Prices we've sent you"],
      orders: ["Orders", `Total ${money(iL.reduce((a, o) => a + o.total, 0))}`],
      done: ["Completed", `${done.length} finished order${done.length === 1 ? "" : "s"}`],
    };
    return <section className="aa-ocard">
      <div className="aa-ocard-h"><h2>{secT[tab]?.[0] || "Orders"}</h2><span className="faint">{secT[tab]?.[1] || ""}</span></div>
      <div className="toolbar aa-otabs" data-toolbar>
        <div className="chips">
          {tabs.map(([k, t, n]) => <button key={k} type="button" className={"chip" + (tab === k ? " on" : "")} onClick={() => setOTab(k)}>{t}{n ? <span className="chip-n">{n}</span> : null}</button>)}
        </div>
        {/* on a phone the five buttons don't fit one row: a dropdown beside the search instead (Oct 24, Nick: "secondary
            toolbar is bad") */}
        <select className="aa-osel" aria-label="Show" value={tab} onChange={(e) => setOTab(e.target.value as typeof oTab)}>
          {tabs.map(([k, t, n]) => <option key={k} value={k}>{t}{n ? ` (${n})` : ""}</option>)}
        </select>
        <span className="spacer" />
        {orderTypes.length > 0 && <div className="aa-lane" role="radiogroup" aria-label="Order type"><span>Show</span><div className="aa-lane-seg" style={{ gridTemplateColumns: `repeat(${orderTypes.length + 1},minmax(0,1fr))` }}>
          {["all", ...orderTypes].map((k) => { const n = k === "all" ? 0 : [...quotes, ...invoices].filter((o) => o.order_lane === k && !o.archived && o.status !== "completed").length; return <button key={k} type="button" role="radio" aria-checked={ln === k} className={ln === k ? "on" : ""} onClick={() => setLane(k)}>{k === "all" ? "All" : k}{n ? <em>{n}</em> : null}</button>; })}
        </div></div>}
        <label className="aa-search aa-search-plain"><Ico d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3" size={16} /><input type="search" placeholder={tab === "quotes" ? "Search quotes" : tab === "all" ? "Search quotes and orders" : "Search orders"} value={q} onChange={(e) => { setQ(e.target.value); setPg({}); }} /></label>
      </div>
      {tab === "all" && orderTable(allRows, "invoice", true)}
      {/* drafts: started, never sent, no number yet (Oct 24, Nick: "something before sent to FBS that says drafts") */}
      {tab === "drafts" && <>
        <div className="aa-sec-h aa-sec-pad"><h3>Drafts</h3><span className="faint">Not sent to us yet. Pick one up or discard it.</span></div>
        <div className="aa-card aa-tblcard"><table className="aa-tbl">
          <thead><tr><th>Draft</th><th>Pieces</th><th>Last changed</th><th /></tr></thead>
          <tbody>{draftsLive.map((d) => (
            <tr className="rl" key={d.id}>
              <td className="m"><RowLink href={`/portal/request/${d.id}${hrefQuery}`} /><div className="aa-t">{d.name || "Untitled order"}</div></td>
              <td>{d.pcs || "—"}</td>
              <td className="dt">{when(d.updated)}</td>
              <td className="r" onClick={(e) => e.stopPropagation()}>
                <Link className="btn sm" href={`/portal/request/${d.id}${hrefQuery}`}>Continue</Link>{" "}
                {onDiscardDraft && <button type="button" className={"btn sm ghost" + (armedDel === "d" + d.id ? " danger armed" : "")} disabled={!canAct} onClick={async () => {
                  if (armedDel !== "d" + d.id) { setArmedDel("d" + d.id); setTimeout(() => setArmedDel((x) => (x === "d" + d.id ? "" : x)), 3500); return; }
                  setArmedDel(""); setGoneDrafts((g) => ({ ...g, [d.id]: true }));
                  const r = await onDiscardDraft(d.id); if (!r.ok) setGoneDrafts((g) => ({ ...g, [d.id]: false }));
                }}>{armedDel === "d" + d.id ? "Discard it?" : "Discard"}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      </>}
      {tab === "sent" && <>
        <div className="aa-sec-h aa-sec-pad"><h3>Sent to FBS</h3><span className="faint">We&apos;re checking these. You&apos;ll get a message when we confirm.</span></div>
        {sentQ.length ? orderTable(sentQ, "quote") : <div className="aa-none-q faint">Nothing waiting on us. Orders you send show here until we confirm them.</div>}
      </>}
      {tab === "quotes" && <>
        <div className="aa-sec-h aa-sec-pad"><h3>Quotes</h3>{openQ ? <span className="faint">{openQ} waiting on you</span> : null}
</div>
        {shownQ.length ? orderTable(shownQ, "quote") : <div className="aa-none-q faint">{quotes2.length ? "No quotes in the last 60 days." : "No quotes right now."}</div>}
        {/* under the list, never on a toolbar (Nov 3, Nick: "that show older quotes needs to go somewhere else… it's gonna
            create issues"): one line to bring in the older and archived ones, and to put them away again */}
        {(olderN > 0 || oldQuotes) && <button type="button" className="aa-oldq-more" aria-pressed={oldQuotes} onClick={() => setOldQuotes(!oldQuotes)}>{oldQuotes ? "Hide older quotes and archived" : `Show older quotes and archived (${olderN})`}</button>}
      </>}
      {tab === "orders" && <>
        <div className="aa-sec-h aa-sec-pad"><h3>Orders</h3><span className="faint">Total {money(iL.reduce((a, o) => a + o.total, 0))}</span></div>
        {orderTable(iL, "invoice")}
      </>}
      {tab === "done" && <>
        <div className="aa-sec-h aa-sec-pad"><h3>Completed</h3></div>
        {orderTable(done, "invoice")}
      </>}
    </section>;
  };
  let body: ReactNode = null;
  if (area === "home" && mode === "portal" && dash) {
    body = dash;
  } else if (area === "home" && mode === "portal" && messagesPanel) {
    const current = orders.filter((o) => !o.archived && (o.type === "invoice" ? (IN_WORK.includes(o.status) || o.balance > 0.004) : o.status === "request"));
    const past = orders.filter((o) => o.type === "invoice" && !current.includes(o));
    const openQ = quotes.filter((o) => !o.archived && o.status === "quote_sent");
    const lists: Record<string, AOrder[]> = { current, quotes: openQ, past };
    const tab = (homeTab as string) in lists ? (homeTab as string) : current.length ? "current" : openQ.length ? "quotes" : "past";
    const rows = lists[tab].slice(0, 6);
    const favs = [...ds.filter((d) => d.starred && !d.archived_at), ...ds.filter((d) => !d.starred && !d.archived_at)].filter((d) => designUrls[d.id]).slice(0, 6);
    const artCount = ds.filter((d) => !d.archived_at).length + mockups.length;
    body = (
      <div className="pd">
        <div className={"pd-top" + (assistant ? " with-pa" : "")}>
          {assistant || <div className="pd-hello">{greeting && <h2>{greeting}</h2>}<span>Everything about your account in one place. Message us any time.</span></div>}
          <div className="pd-actions">
            {homeTop}
            {due > 0.004 && (
              <button type="button" className="pd-act pay" onClick={() => go("payments")}>
                <span className="ic"><Ico d={I.dollar} size={20} /></span><span><b>Pay {money(due)}</b><small>Balance on your orders</small></span>
              </button>
            )}
          </div>
        </div>
        <div className="pd-grid">
          <div className="pd-main">
            {messagesPanel}
            {goodsHome && (
              <section className="pd-goods">
                <div className="pd-card-h"><h3><span aria-hidden="true">📦</span> Customer supplied goods{goodsCount ? <span className="aa-n">{goodsCount}</span> : null}</h3><button type="button" className="pd-link" onClick={() => go("receive")}>See all</button></div>
                {goodsHome}
              </section>
            )}
          </div>
          <aside className="pd-side">
            {attention.length > 0 && (
              <div className="pd-card pd-attn">
                <div className="pd-card-h"><h3>Needs your attention</h3><span className="aa-n">{attention.length}</span></div>
                {attention.slice(0, 6).map((a, i) => (
                  <Link key={a.kind + a.order_id + i} href={a.href || orderHref(a.order_id, a.hash)} className="pd-attn-i">
                    <span className="k">{a.label || (a.kind === "quote" ? "Approve quote" : a.kind === "art" ? "Approve artwork" : a.kind === "pay" ? "Payment due" : a.kind === "draft" ? "Finish your order" : a.kind === "receive" ? "Send us garments" : "Order")}</span>
                    <span className="v">#{a.number}{a.kind === "pay" ? ` · ${a.date}` : ""}</span>
                    <Ico d={I.arrow} size={16} />
                  </Link>
                ))}
              </div>
            )}
            <div className="pd-card pd-glance">
              <button type="button" onClick={() => go("orders")}><b>{inWork.length}</b><span>In progress</span></button>
              <button type="button" onClick={() => go("quotes")}><b>{openQ.length}</b><span>Quotes to review</span></button>
              <button type="button" onClick={() => go("payments")}><b>{money(due)}</b><span>Balance</span></button>
            </div>
            <div className="pd-card">
              <div className="pd-card-h"><h3>Your orders</h3><button type="button" className="pd-link" onClick={() => go("orders")}>See all</button></div>
              <div className="pd-tabs" role="tablist">
                {([["current", "Current", current.length], ["quotes", "Quotes", openQ.length], ["past", "Completed", past.length]] as const).map(([k, l, n]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setHomeTab(k as never)}>{l}{n ? <span>{n}</span> : null}</button>
                ))}
              </div>
              <div className="pd-orders">
                {rows.map((o) => (
                  <Link key={o.id} href={orderHref(o.id)} className="pd-o">
                    <span className="n">#{o.number}</span>
                    <span className="t"><b>{o.nickname || (o.type === "quote" ? "Quote" : "Order")}</b><small>{o.archived ? "Archived · " : ""}{o.type === "quote" ? money(o.total) : o.balance > 0.004 && !o.archived ? `${money(o.balance)} due` : when(o.due_date || o.created_at) || `${o.qty} pcs`}</small></span>
                    {pill(o)}
                  </Link>
                ))}
                {!rows.length && <div className="pd-none">{tab === "current" ? "No orders in progress right now." : tab === "quotes" ? "No quotes waiting on you." : "No completed orders yet."}</div>}
              </div>
            </div>
            <div className="pd-card">
              <div className="pd-card-h"><h3>Your artwork</h3><button type="button" className="pd-link" onClick={() => go("artwork")}>{artCount ? `All ${artCount}` : "Open"}</button></div>
              {favs.length ? (
                <div className="pd-art">{favs.map((d) => (
                  <button key={d.id} type="button" title={d.name} onClick={() => go("artwork")}><img src={designUrls[d.id]} alt={d.name} loading="lazy" />{d.starred && <span className="st" aria-label="Favorite">★</span>}</button>
                ))}</div>
              ) : <div className="pd-none">Logos you upload and mockups you make show up here. Star your favorites to keep them on top.</div>}
            </div>
          </aside>
        </div>
      </div>
    );
  } else if (area === "home" && mode === "shop") {
    // one line of numbers, then every order one line each under Active / Quotes / Done (Oct 21, Nick: "too much
    // information… how pieces are underneath each thing")
    const active = invoices.filter((o) => !o.archived && o.status !== "completed");
    const dayOf = (o: AOrder) => (o.created_at || o.due_date || "").slice(0, 10);
    const newest = (l: AOrder[]) => l.slice().sort((x, y) => dayOf(y).localeCompare(dayOf(x)) || y.number - x.number);
    const completed = invoices.filter((o) => o.archived || o.status === "completed");
    // All · Order requests · Quotes · Orders · Completed (Nov 2, Nick: "it should say all, order requests, quote, orders and
    // completed on this page"); a request isn't a quote yet
    const lists = { all: newest(orders.filter((o) => o.type === "invoice" || quotes.includes(o))), requests: newest(quotes.filter((o) => o.status === "request")), quotes: newest(quotes.filter((o) => o.status !== "request")), orders: newest(active), completed: newest(completed) };
    const owedList = owed.filter((o) => !o.archived);
    const sentQ = quotes.filter((o) => !o.archived && o.status === "quote_sent");
    // what's worth knowing at a glance (Oct 21, Nick: "surely we can put some more pertinent information there"): what's
    // in the works and when it's next due, what they owe, when they last ordered and how often they do, and their sales
    const t0 = today(), dd = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
    const nextDue = active.filter((o) => o.due_date).sort((x, y) => (x.due_date || "").localeCompare(y.due_date || ""))[0];
    const days = [...new Set(invoices.map(dayOf).filter(Boolean))].sort().reverse();
    const lastOrder = newest(invoices)[0];
    const gaps = days.slice(0, 11).map((d, i, a) => (i ? dd(a[i - 1], d) : 0)).slice(1).filter((g) => g > 0).sort((x, y) => x - y);
    const gap = gaps.length >= 2 ? gaps[Math.floor(gaps.length / 2)] : 0;
    const every = !gap ? "" : gap < 14 ? `Every ~${gap} days` : gap < 63 ? `Every ~${Math.round(gap / 7)} weeks` : `Every ~${Math.round(gap / 30.4)} months`;
    const nextAround = gap && days[0] ? new Date(Date.parse(days[0]) + gap * 86400000).toISOString().slice(0, 10) : "";
    const yr = t0.slice(0, 4), lastYr = String(+yr - 1);
    const sales = (y: string) => invoices.filter((o) => dayOf(o).startsWith(y)).reduce((a, o) => a + o.total, 0);
    const firstYr = days.length ? days[days.length - 1].slice(0, 4) : "";
    body = (
      <>
        {/* the order page's summary card (Oct 21, Nick: "a common theme") */}
        <div className="stats">
          <button type="button" className="stat" onClick={() => setOTab("orders")}><span className="k">In the works</span><span className="v">{active.length} job{active.length === 1 ? "" : "s"}{sentQ.length ? ` · ${sentQ.length} quote${sentQ.length === 1 ? "" : "s"}` : ""}</span><small>{nextDue ? `Next due ${when(nextDue.due_date)} · #${nextDue.number}` : active.length ? "No in-hands dates yet" : "Nothing in progress"}</small></button>
          <button type="button" className="stat money-only" onClick={() => go("payments")}><span className="k">Balance</span><span className="v">{due > 0.004 ? money(due) : "Paid up"}</span><small>{due > 0.004 ? `${owedList.length && owedList.length <= 3 ? owedList.map((o) => "#" + o.number).join(", ") : `${owedList.length} invoices`}${terms ? ` · ${terms}` : ""}` : terms || "Nothing owed"}</small></button>
          {/* four cards (Nov 3, Nick: "need a four card summary"): how often they order is under the last order */}
          <button type="button" className="stat" onClick={() => lastOrder && router.push(orderHref(lastOrder.id))}><span className="k">Last order</span><span className="v">{lastOrder ? when(dayOf(lastOrder)) : "None yet"}</span><small>{lastOrder ? `${dd(t0, dayOf(lastOrder))} days ago` : ""}{every ? `${lastOrder ? " · " : ""}orders ${every.replace(/^Every/, "every")}` : ""}{nextAround && nextAround < t0 ? " · due for one" : ""}</small></button>
          <button type="button" className="stat money-only" onClick={() => setOTab("done")}><span className="k">Sales this year</span><span className="v">{money(sales(yr))}</span><small>{`${lastYr} ${money(sales(lastYr))} · all time ${money(invoices.reduce((a, o) => a + o.total, 0))}`}{firstYr ? ` since ${firstYr}` : ""}</small></button>
        </div>
        {ordersCard()}
      </>
    );
  } else if (area === "home") {
    const groups: { kind: AAttn["kind"]; title: string; label: string }[] = [
      { kind: "request", title: "New order requests to price", label: "Request" },
      { kind: "draft", title: "Orders you haven't sent yet", label: "Order" },
      { kind: "quote", title: mode === "shop" ? "Quotes waiting on the customer" : "Quote approvals", label: "Quote" },
      { kind: "art", title: mode === "shop" ? "Artwork waiting on the customer" : "Artwork approvals", label: "Order" },
      { kind: "pay", title: "Payments due", label: "Order" },
      { kind: "receive", title: mode === "shop" ? "Garments to receive" : "Garments to send us", label: "Order" },
    ];
    body = (
      <>
        {homeTop}
        <div className="aa-stats">
          <div className="aa-stat"><span className="ic"><Ico d={I.quotes} size={22} /></span><b>{money(openQuotes)}</b><span>Open quotes</span></div>
          <div className="aa-stat"><span className="ic"><Ico d={I.orders} size={22} /></span><b>{inWork.length}</b><span>Orders in progress</span></div>
          <div className="aa-stat"><span className="ic"><Ico d={I.due} size={22} /></span><b>{money(due)}</b><span>Amount due</span></div>
          <div className={"aa-stat" + (overdue > 0.004 ? " red" : "")}><span className="ic"><Ico d={I.dollar} size={22} /></span><b>{money(overdue)}</b><span>Amount overdue</span></div>
        </div>
        <div className="aa-home">
          <div className="aa-home-main">
            <div className="aa-htabs">
              <button type="button" className={homeTab === "orders" ? "on" : ""} onClick={() => setHomeTab("orders")}>Orders</button>
              <button type="button" className={homeTab === "quotes" ? "on" : ""} onClick={() => setHomeTab("quotes")}>Quotes</button>
            </div>
            <div className="aa-htab-body">
              {tableHead(<span className="faint">{homeTab === "orders" ? `${invoices.length} order${invoices.length === 1 ? "" : "s"}` : `${quotes.length} quote${quotes.length === 1 ? "" : "s"}`}</span>, homeTab === "orders" ? "Search orders: number, garment, color, print…" : "Search quotes")}
              {homeTab === "orders" ? orderTable(invoices, "invoice") : orderTable(quotes, "quote")}
            </div>
          </div>
          <aside className="aa-attn">
            <div className="aa-attn-h">Requires {mode === "shop" ? "attention" : "your attention"}</div>
            {groups.map((g) => {
              const items = attention.filter((a) => a.kind === g.kind);
              if (!items.length) return null;
              return (
                <div key={g.kind} className="aa-attn-g">
                  <div className="aa-attn-t">{g.title}</div>
                  {items.map((a, i) => (
                    <Link key={g.kind + a.order_id + i} href={!a.number && a.href ? a.href : orderHref(a.order_id, a.hash)} className="aa-attn-i">
                      {a.number ? <span><span className="k">{g.label}</span><span className="v">#{a.number}</span></span> : <span><span className="k">Supplier shipment</span><span className="v">{a.label}</span></span>}
                      <span><span className="k">{g.kind === "pay" ? "Balance" : g.kind === "draft" ? "Started" : "Since"}</span><span className="v">{a.date}</span></span>
                      <span className="go"><Ico d={I.arrow} size={18} /></span>
                    </Link>
                  ))}
                </div>
              );
            })}
            {!attention.length && <div className="aa-attn-none">{mode === "shop" ? "Nothing waiting on this customer." : "You're all caught up."}</div>}
          </aside>
        </div>
      </>
    );
  } else if (area === "quotes") body = <>{tableHead(<h2 className="aa-areat">Quotes</h2>, "Search quotes")}{orderTable(quotes, "quote")}</>;
  else if ((area === "orders" || area === "invoices") && mode === "portal") {
    body = ordersCard();
  } else if (area === "orders" || area === "invoices") body = <>
    {tableHead(<><h2 className="aa-areat">Orders</h2><span className="aa-sum">{invoices.length} order{invoices.length === 1 ? "" : "s"} · Total <b>{money(invoices.reduce((a, o) => a + o.total, 0))}</b> · Balance <b className={mode === "shop" && due > 0.004 ? "aa-due" : ""}>{money(due)}</b></span></>, "Search orders")}
    {orderTable(invoices, "invoice")}</>;
  else if (area === "payments") {
    // never an order request: it isn't a quote or an order yet (Nov 2, Nick; lib/payReady.ts says the same)
    const open = liveInvoices.filter((o) => o.status !== "request" && o.balance > 0.004 && has(q, o.number, o.nickname));
    const waitingQuotes = quotes.filter((o) => !o.archived && o.status === "quote_sent" && has(q, o.number, o.nickname));
    const canPay = mode === "portal" && !!payCfg;
    const item = (o: AOrder): PayItem => ({ id: o.id, cardFeeIn: o.cardFeeIn, number: o.number, nickname: o.nickname, balance: Math.round(o.balance * 100) / 100, quote: o.type === "quote", deposit: payCfg && o.paid < 0.005 ? Math.min(o.balance, Math.round(o.total * payCfg.depositPct) / 100) : undefined });
    // only what's open for paying (Oct 24, Nick): a deposit-only order pays its deposit; one that isn't ready can't be picked
    // an old invoice is paid here once the account has moved (Nov 2, Nick); "pv:" tells the server it's an old one
    const payable = (o: AOrder) => (o.archived ? mode === "portal" && !!o.payHere : mode !== "portal" || o.payCan !== "none");
    const itemOf = (o: AOrder): PayItem => {
      if (o.archived) return { id: `pv:${o.id}`, number: o.number, nickname: o.nickname, balance: Math.round(o.balance * 100) / 100, cardFeeIn: o.cardFeeIn };
      const it = item(o); return o.payCan === "deposit" && it.deposit ? { ...it, balance: it.deposit, part: true, notFinal: o.notFinal, notFinalNote: o.payNote } : { ...it, notFinal: o.notFinal, notFinalNote: o.payNote };
    };
    const amtOf = (o: AOrder) => (o.archived ? o.balance : o.payCan === "deposit" ? itemOf(o).balance : o.balance);
    const oldOpen = oldOwed.filter((o) => has(q, o.number, o.nickname));
    const sel = [...open, ...waitingQuotes, ...oldOpen].filter((o) => paySel.includes(o.id) && payable(o));
    const selSum = sel.reduce((a, o) => a + amtOf(o), 0);
    const toggle = (id: string, on?: boolean) => setPaySel((x) => ((on ?? !x.includes(id)) ? [...x.filter((y) => y !== id), id] : x.filter((y) => y !== id)));
    // one list (Nov 2, Nick: "probably don't need to separate new portal orders from old… just use the little P"): every
    // open invoice and quote, the ones that can be paid first (oldest due first), then the ones still being made
    const dueOn = (o: AOrder) => (o.type === "quote" ? null : payDue(o));
    // no "past due" (Nov 2, Nick: due on receipt goes straight from "can't pay yet" to "past due"… "just get rid of the
    // idea of past due or due"): a finished order is "Ready to pay" (green) for a week after its payment date, and only
    // shows red once it's been open longer than that
    const GRACE = 7;
    const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    const isLate = (o: AOrder) => { const d = dueOn(o); return !!d && addDays(d, GRACE) < today(); };
    // can't be paid yet: still being made, or a quote that's paid by approving it first (Nov 2, Nick: "why isn't this
    // first invoice checkable?", a sent quote on due-on-receipt terms showed black like it was ready)
    const isLater = (o: AOrder) => !o.archived && o.payCan === "none";
    const allOpen = [...open, ...oldOpen, ...waitingQuotes];
    const sumOf = (l: AOrder[]) => l.reduce((a, o) => a + Math.max(0, o.balance), 0);
    const lateL = allOpen.filter((o) => o.type !== "quote" && isLate(o)), laterL = allOpen.filter(isLater);
    const dir = dueSort === "desc" ? -1 : 1;
    // oldest first: ready to pay by due date, then what's still being made; newest first: what's still being made on top
    // (newest invoice first), then the rest newest due first (Nov 2, Nick)
    const listAll = (payF === "late" ? lateL : payF === "later" ? laterL : allOpen).slice().sort((a, b) =>
      dir * (Number(isLater(a)) - Number(isLater(b))) || (isLater(a) && isLater(b) ? dir * (a.number - b.number) : dir * ((dueOn(a) || "9999").localeCompare(dueOn(b) || "9999") || a.number - b.number)));
    const readyL = allOpen.filter((o) => !isLater(o) && o.type !== "quote");
    // every open invoice, however many (Nov 2, Nick: "this is the one time I do want you to just show… a huge long list")
    const listShown = listAll;
    // just the date (Nov 2, Nick: "just put the date… just green. If it goes more than a week past due… red. Don't put
    // open since or ready to pay or anything like that"); no date yet (still being made, a quote): a dash
    const dueText = (o: AOrder) => {
      if (o.archived && mode === "portal" && !o.payHere) return o.payUrl ? <a className="pyl-ext" href={o.payUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Pay on its invoice ↗</a> : <span className="pyl-soon">—</span>;
      const d = o.type === "quote" || isLater(o) ? null : dueOn(o);
      return d ? <span className={isLate(o) ? "pyl-late" : "pyl-ok"}>{when(d)}</span> : <span className="pyl-soon">—</span>;
    };
    const searchBox = search("Search payments");
    body = <>
      <div className="aa-bar"><div className="aa-bar-l"><h2 className="aa-areat">Payments</h2></div>
      {/* the statement buttons on the title's line, at the right (Nov 2, Nick: "so that can collapse down some") */}
      {(!canPay || statementHref || onEmailStatement) && <div className="aa-stmt">
          {!canPay && searchBox}
          {statementHref && <a className="btn sm" href={statementHref} target={mode === "shop" ? "_blank" : undefined} rel="noreferrer">{mode === "shop" ? "Open statement" : "View / print statement"}</a>}
          {onEmailStatement && <button type="button" className="btn sm" onClick={async () => { setStNote("Sending…"); const r = await onEmailStatement(); setStNote(r.ok ? (r.emailed ? "Statement emailed." : "Couldn't send the email.") : r.error || "Couldn't send."); }}>Email statement</button>}
          {mode === "shop" && onRecordPayment && <button type="button" className={"btn sm" + (recOpen ? " on" : " primary")} onClick={() => setRecOpen((x) => !x)}>{recOpen ? "Close" : "Record a payment"}</button>}
          {stNote && <span className="faint">{stNote}</span>}
        </div>}
      </div>
      <div className={canPay ? "aa-home aa-paylay" : ""}><div className="aa-home-main stack">
      {mode === "shop" && onRecordPayment && recOpen && <RecordPayment record={onRecordPayment} onDone={() => { setRecOpen(false); router.refresh(); }} />}
      {/* their credit: use it or get it back (components/CreditBox.tsx) */}
      {creditBox}
      {/* the numbers in one summary card (Nov 2, Nick: "it looks busy") */}
      <div className="stats pyl-stats">
        {/* Balance due = Not due yet + Ready to pay; over a week (red) last; no paid this year (Nov 2, Nick: "how can your
            balance due not be what's to be paid… balance due, orders in the works not due yet… ready to be paid… the red
            thing last… I don't think we need the paid this year") */}
        <button type="button" className="stat" onClick={() => setPayF("open")}><span className="k">Balance due</span><span className="v">{money(due)}</span><small>{owed.length} invoice{owed.length === 1 ? "" : "s"}{terms ? ` · ${terms}` : ""}</small></button>
        <button type="button" className="stat" onClick={() => setPayF("later")}><span className="k">Not due yet</span><span className="v">{money(sumOf(laterL))}</span><small>{laterL.length ? `${laterL.length} still being made` : "Nothing in the works"}</small></button>
        <button type="button" className="stat" onClick={() => setPayF("open")}><span className="k">Ready to pay</span><span className="v">{money(sumOf(readyL))}</span><small>{readyL.length} invoice{readyL.length === 1 ? "" : "s"}</small></button>
        <button type="button" className="stat" onClick={() => setPayF("late")}><span className="k">Open over a week</span><span className={"v" + (sumOf(lateL) > 0.004 ? " alert" : "")}>{money(sumOf(lateL))}</span><small>{lateL.length} invoice{lateL.length === 1 ? "" : "s"}</small></button>
      </div>
      <div className="aa-card aa-tblcard pyl">
        <div className="toolbar pyl-bar aa-otabs">
          <div className="chips">
            <button type="button" className={"chip" + (payF === "open" ? " on" : "")} onClick={() => setPayF("open")}>Open<span className="chip-n">{allOpen.length}</span></button>
            <button type="button" className={"chip" + (payF === "late" ? " on" : "")} onClick={() => setPayF("late")}>Over a week<span className="chip-n">{lateL.length}</span></button>
            <button type="button" className={"chip" + (payF === "later" ? " on" : "")} onClick={() => setPayF("later")}>Not due yet<span className="chip-n">{laterL.length}</span></button>
          </div>
          {canPay && searchBox}
        </div>
        <table className="aa-tbl pyl-tbl" data-nofit>
          <thead><tr>{canPay && <th className="pyl-ck"><input type="checkbox" aria-label="Check all" checked={listAll.filter(payable).length > 0 && listAll.filter(payable).every((o) => paySel.includes(o.id))} onChange={(e) => listAll.filter(payable).forEach((o) => toggle(o.id, e.target.checked))} /></th>}<th>Inv.</th><th>Order</th><th><button type="button" className="pyl-sort" onClick={() => setDueSort(dueSort === "asc" ? "desc" : "asc")} title={dueSort === "asc" ? "Oldest first: press for newest first" : "Newest first: press for oldest first"}>Due date <span aria-hidden>{dueSort === "asc" ? "▲" : "▼"}</span></button></th><th className="r">Balance</th></tr></thead>
          <tbody>
            {listShown.map((o) => {
              const can = canPay && payable(o), on = can && paySel.includes(o.id);
              return (
                <tr key={o.id} className={(on ? "sel" : "") + (isLater(o) ? " aa-notready" : "")} onClick={() => (can ? toggle(o.id) : router.push(orderHref(o.id)))}>
                  {canPay && <td className="ck" onClick={(e) => e.stopPropagation()}>{can ? <input type="checkbox" aria-label={`Check #${o.number}`} checked={on} onChange={(e) => toggle(o.id, e.target.checked)} /> : null}</td>}
                  <td className="num"><Link href={orderHref(o.id)} onClick={(e) => e.stopPropagation()}>{o.number}</Link>{o.archived && <PrintavoMark />}</td>
                  <td className="m"><div className="aa-t">{o.nickname || (o.type === "quote" ? "Quote" : "Order")}</div>{mode === "portal" && o.notFinal ? <div className="aa-s aa-nf">Not final: {o.payNote || "charges may still change"}</div> : null}</td>
                  <td className="pyl-due" data-l="Due">{dueText(o)}</td>
                  <td className="r num b" data-l="Balance">{money(o.type === "quote" ? o.total : o.balance)}</td>
                </tr>
              );
            })}
            {!listAll.length && <tr><td colSpan={5}><div className="aa-empty">{payF === "open" ? (mode === "shop" ? "Nothing due." : "You're all paid up. Thank you!") : "Nothing here."}</div></td></tr>}
          </tbody>
        </table>
        {listAll.length > listShown.length && <div className="aa-more-row"><button type="button" className="btn sm" onClick={() => setShowOldOwed(true)}>Show all {listAll.length}</button></div>}
      </div>
      <div className="aa-card aa-tblcard aa-ph-card">
        {(() => {
          // one line per payment: an online payment (same processor id) or a check applied to many invoices (same note) groups its invoices
          const groups = new Map<string, { key: string; date: string; method: string; total: number; fee: number; lines: APayment[] }>();
          for (const p of payments) {
            const k = p.processor_id ? `px:${p.processor_id}` : p.note && /paid together|applied to \d+ invoice/i.test(p.note) ? `n:${p.paid_on}|${p.method}|${p.note}` : `p:${p.id}`;
            const g = groups.get(k) || { key: k, date: p.paid_on || p.created_at, method: p.method, total: 0, fee: 0, lines: [] };
            g.total = Math.round((g.total + p.amount) * 100) / 100; g.fee += +(p.fee || 0); g.lines.push(p);
            groups.set(k, g);
          }
          const all = [...groups.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          const w = (mode === "portal" ? q : hq).trim().toLowerCase().replace(/[$,]/g, "").replace(/^#/, "");
          const hit = (g: (typeof all)[number]) => !w || [g.total.toFixed(2), money(g.total), (g.total + g.fee).toFixed(2), when(g.date), g.method, ...g.lines.flatMap((l) => [String(l.number), l.amount.toFixed(2)])].some((x) => String(x).toLowerCase().replace(/[$,]/g, "").includes(w));
          const list = all.filter(hit);
          const PERH = 5, pages = Math.max(1, Math.ceil(list.length / PERH)), pg = Math.min(hp, pages - 1);
          const shown = list.slice(pg * PERH, pg * PERH + PERH);
          return (<>
            <div className="aa-sec-h ph-h"><h3>Payment history</h3>
              <label className="aa-search ph-search"><Ico d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM21 21l-4.3-4.3" size={15} /><SearchInput placeholder="Search payments" value={hq} onChange={(e) => { setHq(e.target.value); setHp(0); }} aria-label="Search payment history" /></label>
            </div>
            <table className="aa-tbl ph">
              <thead><tr><th>Date</th><th>Paid for</th><th>Method</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {shown.map((g) => {
                  const many = g.lines.length > 1, open = openPay === g.key;
                  return [
                    <tr key={g.key} className={many ? "ph-g" + (open ? " open" : "") : "rl"} onClick={many ? () => setOpenPay(open ? null : g.key) : undefined}>
                      <td className="dt"><RowLink href={g.lines[0].href || orderHref(g.lines[0].order_id)} off={many} />{when(g.date)}</td>
                      {/* paid together: one line, the first invoices under it, the rest when opened (Nov 2, Nick: "you pay 10
                          invoices… it should show paid $10,588 and these invoices") */}
                      <td className="m">{many ? <button type="button" className="ph-toggle ph-many" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpenPay(open ? null : g.key); }}>
                          <b>{g.lines.length} invoices paid together <span aria-hidden="true">{open ? "▴" : "▾"}</span></b>
                        </button>
                        : <span className="ph-one"><Link className="num" href={g.lines[0].href || orderHref(g.lines[0].order_id)} onClick={(e) => e.stopPropagation()}>#{g.lines[0].number}</Link>{g.lines[0].archived && <PrintavoMark />}{g.lines[0].nickname ? <span className="ph-nm">{g.lines[0].nickname}</span> : null}</span>}</td>
                      <td className="mt">{g.method || "—"}{g.fee > 0.004 ? <small className="faint"> (+{money(g.fee)} card fee)</small> : null}</td>
                      <td className="r num b amt">{money(g.total + g.fee)}</td>
                    </tr>,
                    // opened: each invoice on its own line, like a single payment's line (Nov 3, Nick: "two invoices paid
                    // together, and then we click down, it should show a long list of everything like that")
                    ...(many && open ? g.lines.slice().sort((a, b) => b.number - a.number).map((l) => (
                      <tr key={g.key + "-" + l.id} className="rl ph-sub">
                        <td className="dt"><RowLink href={l.href || orderHref(l.order_id)} /></td>
                        <td className="m"><span className="ph-one"><Link className="num" href={l.href || orderHref(l.order_id)} onClick={(e) => e.stopPropagation()}>#{l.number}</Link>{l.archived && <PrintavoMark />}{l.nickname ? <span className="ph-nm">{l.nickname}</span> : null}</span></td>
                        <td className="mt" />
                        <td className="r num amt">{money(l.amount)}</td>
                      </tr>
                    )) : []),
                  ];
                })}
                {!shown.length && <tr><td colSpan={4}><div className="aa-empty">{payments.length ? `No payments match “${mode === "portal" ? q : hq}”.` : "No payments yet."}</div></td></tr>}
              </tbody>
            </table>
            {pages > 1 && (
              <div className="aa-pager ph-pager">
                <span className="faint">Showing {pg * PERH + 1}–{Math.min(list.length, pg * PERH + PERH)} of {list.length} payments</span>
                <span className="spacer" />
                <button type="button" className="aa-pg" disabled={pg === 0} aria-label="Previous page" onClick={() => setHp(pg - 1)}>‹</button>
                {Array.from({ length: pages }, (_, i) => i).filter((i) => pages <= 7 || i === 0 || i === pages - 1 || Math.abs(i - pg) <= 1).map((i, k, arr) => (
                  <span key={i} className="row" style={{ gap: 4 }}>{k > 0 && i - arr[k - 1] > 1 && <span className="faint">…</span>}
                    <button type="button" className={"aa-pg" + (i === pg ? " on" : "")} aria-current={i === pg ? "page" : undefined} onClick={() => setHp(i)}>{i + 1}</button></span>
                ))}
                <button type="button" className="aa-pg" disabled={pg >= pages - 1} aria-label="Next page" onClick={() => setHp(pg + 1)}>›</button>
              </div>
            )}
          </>);
        })()}
      </div>
      </div>
      {canPay && payCfg && (
        <aside className="aa-payside">
          {/* the terms are small text on the title line now (Nov 2, Nick) */}
          {terms && mode !== "portal" && <div className="aa-terms"><span>Payment terms</span><b>{terms}</b></div>}
          {canPay && (
        <QuickPay initial={sp.get("find") || undefined} ask={onPaySelect} onSelect={(ids) => { setPaySel(ids); setPayNow(null); setPayAmt(undefined); }}
          onPayAmount={(parts, amount) => {
            const byId = new Map([...liveInvoices, ...oldOpen].map((o) => [o.id, o]));
            setPaySel(parts.map((p) => p.id));
            setPayAmt(amount);
            setPayNow(parts.map((p) => { const o = byId.get(p.id)!; return { ...itemOf(o), balance: p.amount, full: Math.round(amtOf(o) * 100) / 100 }; }));
          }}
          open={[...liveInvoices, ...oldOpen].filter((o) => o.balance > 0.004 && payable(o)).map((o) => ({ id: o.id, number: o.number, nickname: o.nickname, status: o.status, total: o.total, balance: Math.round(amtOf(o) * 100) / 100, created_at: o.created_at, due_date: o.due_date, pay_due: payDue(o), search: o.search }))} />
          )}
          {/* check the orders on the left; the total and one Pay button show here (Nov 2, Nick) */}
          <div className="aa-paybox pyb">
            <div className="aa-paybox-h">Pay orders</div>
            {sel.length ? <>
              <div className="pyb-sum"><span>{sel.length} order{sel.length === 1 ? "" : "s"} checked{payAmt !== undefined ? " · oldest first" : ""}</span><b className="num">{money(payAmt ?? selSum)}</b></div>
              <div className="pyb-nums">{sel.slice(0, 8).map((o) => <span key={o.id}>#{o.number}{o.archived && <PrintavoMark />}</span>)}{sel.length > 8 ? <span>+{sel.length - 8} more</span> : null}</div>
              {payAmt === undefined && <button type="button" className="btn primary pyb-go" onClick={() => { setPayAmt(undefined); setPayNow(sel.map(itemOf)); }}>Pay {money(selSum)}</button>}
              <button type="button" className="linkbtn pyb-clear" onClick={() => { setPaySel([]); setPayNow(null); setPayAmt(undefined); }}>Clear</button>
            </> : allOpen.some(payable) ? <>
              <div className="pyb-hint"><svg width="26" height="16" viewBox="0 0 26 16" aria-hidden><path d="M25 8H3M9 2 3 8l6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>Check the orders on the left</div>
              {/* a picture of what it looks like, not their own orders, fading out so it reads as an example (Nov 2, Nick:
                  "it should be like an example picture… five invoices checked… the text faded out") */}
              <div className="pyb-demo pyb-ex" aria-hidden>
                <span className="pyb-ex-tag">Example</span>
                {[["10421", "Team tees", "$412.50"], ["10422", "Event hoodies", "$935.00"], ["10425", "Staff polos", "$1,212.40"], ["10430", "Banner", "$86.00"], ["10433", "Hats", "$340.00"]].map(([n, t, a]) => (
                  <div key={n} className="pyb-row"><span className="pyb-cb on">✓</span><span className="pyb-n">#{n}</span><span className="pyb-ex-t">{t}</span><b>{a}</b></div>))}
                <div className="pyb-ex-sum"><span>5 orders</span><b>$2,985.90</b></div>
                <div className="pyb-ex-btn">Pay $2,985.90</div>
              </div>
              <div className="pyb-note">Check one or many{oldOpen.some(payable) ? <>, new orders and old <PrintavoMark /> ones together</> : null}. Your total and the Pay button show here.</div>
            </> : <div className="faint" style={{ fontSize: 13 }}>Nothing due right now.</div>}
          </div>
          {payNow && <PayPanel modal receiptEmail={payCfg.receiptEmail} key={payNow.map((x) => x.id).join() + (payAmt || "")} items={payNow} amount={payAmt} pay={payCfg} staxToken={payCfg.staxToken} canAct={canAct} onClose={() => { setPayNow(null); setPayAmt(undefined); }} />}
        </aside>
      )}
      </div></>;
  } else if (area === "artwork") {
    // the shop sees the logos saved to their file (Oct 31, Nick); the rest live with their mockups and orders
    const lib = mode === "shop" ? ds.filter((d) => d.saved) : ds;
    const live = lib.filter((d) => !gone[d.id] && !(d.id in arch ? arch[d.id] : d.archived_at));
    const archived = lib.filter((d) => !gone[d.id] && (d.id in arch ? arch[d.id] : d.archived_at));
    const dRows = live.filter((d) => designMatches(d, q)).sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || b.number - a.number);
    const aRows = archived.filter((d) => designMatches(d, q)).sort((a, b) => b.number - a.number);
    const ms = mockups.map((m) => ({ ...m, ...(m.id in mStars ? { starred: mStars[m.id] } : {}), shelved: String(m.mno ?? m.id) in mShelf ? mShelf[String(m.mno ?? m.id)] : !!m.shelved }));
    const mRows = ms.filter((m) => !!m.shelved === !!showArch && has(q, m.title, m.number, m.mno ? `M-${m.mno}` : "")).sort((a, b) => Number(!!b.starred) - Number(!!a.starred));
    // a mockup set (every shirt color saved together) is one card
    const mSets: AMockup[][] = [];
    for (const m of mRows) { const g = m.mno ? mSets.find((x) => x[0].mno === m.mno) : undefined; if (g) g.push(m); else mSets.push([m]); }
    const starMock = async (m: AMockup) => {
      if (!onStarMockup) return;
      setStarErr("");
      setMStars((x) => ({ ...x, [m.id]: !m.starred }));
      const r = await onStarMockup(m.id, !m.starred);
      if (!r.ok) { setMStars((x) => ({ ...x, [m.id]: !!m.starred })); setStarErr(r.error || "Couldn't save the star."); }
    };
    const favMocks = ms.filter((m) => m.starred && !m.shelved);
    const shelveMock = async (m: AMockup, on: boolean) => {
      if (!onArchiveMockup) return;
      setStarErr("");
      const k = String(m.mno ?? m.id);
      setMShelf((x) => ({ ...x, [k]: on }));
      const r = await onArchiveMockup(m.id, on);
      if (!r.ok) { setMShelf((x) => ({ ...x, [k]: !on })); setStarErr(r.error || "Couldn't archive the mockup."); }
    };
    const star = async (d: Design) => {
      if (!onStar) return;
      setStarErr("");
      setStars((s) => ({ ...s, [d.id]: !d.starred }));
      const r = await onStar(d.id, !d.starred);
      if (!r.ok) { setStars((s) => ({ ...s, [d.id]: !!d.starred })); setStarErr(r.error || "Couldn't save the star."); }
    };
    // archive, never trash (Oct 24, Nick: "it's not trash, you just archive it"); archived logos are under Archive
    const remove = async (d: Design) => {
      setStarErr("");
      if (!onArchive) return;
      setArch((x) => ({ ...x, [d.id]: new Date().toISOString() }));
      const r = await onArchive(d.id, true);
      if (!r.ok) { setArch((x) => ({ ...x, [d.id]: null })); setStarErr(r.error || "Couldn't archive the logo."); }
    };
    const restore = async (d: Design) => {
      if (!onArchive) return;
      setArch((x) => ({ ...x, [d.id]: null }));
      const r = await onArchive(d.id, false);
      if (!r.ok) { setArch((x) => ({ ...x, [d.id]: d.archived_at || new Date().toISOString() })); setStarErr(r.error || "Couldn't restore the logo."); }
    };
    const card = (d: Design, isArchived: boolean) => { const views = onShirtsOf(d); return (
      <div key={d.id} className={"design-card" + (d.starred ? " starred" : "") + (isArchived ? " archived" : "")}>
        <div className="dc-img">{designUrls[d.id] ? <LogoFace d={d} urls={designUrls} shirt={logoShirts[d.id]} shown={logoLooks[d.id]?.shown || null} printed={logoLooks[d.id]?.printed || null} /> : <span>{(d.file_name.split(".").pop() || "file").toUpperCase()}</span>}
          {/* how it looks on their shirt colors (Oct 16, Nick: a portfolio of their logos), picked in the strip below */}
          {(() => { const k = shirtSel[d.id] ?? 0, v = views[k], own = v?.path ? designUrls[v.path] : ""; return v && designUrls[d.id] ? <ShirtView className="main" url={own || designUrls[d.id]} shirt={v.shirt} ink={own ? "Original colors" : v.ink} /> : null; })()}
          {/* archive top left, the star top right (Oct 24, Nick: "make the archive button on the top left, like the opposite
              side of the star") */}
          {!isArchived && onArchive && <button type="button" className="dc-arch" title="Archive this logo (find it under Archive)" aria-label="Archive logo" onClick={() => remove(d)}><Ico d={I.archive} size={14} /></button>}
          <div className="dc-tools">
            {!isArchived && onStar && <button type="button" className={"dc-star" + (d.starred ? " on" : "")} title={d.starred ? "Remove from favorites" : "Add to favorites"} aria-label={d.starred ? "Remove from favorites" : "Add to favorites"} aria-pressed={!!d.starred} onClick={() => star(d)}>{d.starred ? "★" : "☆"}</button>}
            {!isArchived && mode === "shop" && <Link className="dc-edit" href={`/shop/artwork/${d.id}?edit=1`} title="Edit this logo: remove the white, change its colors, crop" aria-label="Edit logo">✎</Link>}
          </div>
        </div>
        {/* how it looks on each background (set in Edit logo → Backgrounds); scrolls sideways when there are many */}
        {designUrls[d.id] && views.length > 0 && (
          <div className="dc-views" aria-label="How it looks on shirt colors">
            {views.map((v, i) => <button key={i} type="button" className={(shirtSel[d.id] ?? 0) === i ? "on" : ""} title={`On ${v.shirt}`} onClick={() => setShirtSel((x) => ({ ...x, [d.id]: i }))}><ShirtView url={(v.path && designUrls[v.path]) || designUrls[d.id]} shirt={v.shirt} ink={v.path && designUrls[v.path] ? "Original colors" : v.ink} /></button>)}
            <button type="button" className={(shirtSel[d.id] ?? 0) === -1 ? "on" : ""} title="The logo as uploaded" onClick={() => setShirtSel((x) => ({ ...x, [d.id]: -1 }))}><span className="orig">Original</span></button>
          </div>
        )}
        <div className="dc-b">{mode === "shop" ? <Link href={`/shop/artwork/${d.id}`}><b>D-{d.number}</b></Link> : <b>D-{d.number}</b>}<span>{d.name || "Logo"}</span>{d.inks && <span className="faint">{d.inks}</span>}
          {isArchived && <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <button type="button" className="btn sm" onClick={() => restore(d)}>Restore</button>
            {onDeleteForever && <button type="button" className={"btn sm " + (armedDel === "forever" + d.id ? "danger" : "ghost")} title="Delete this logo and its file for good. Orders that used it keep their mockup pictures."
              onClick={async () => {
                if (armedDel !== "forever" + d.id) { setArmedDel("forever" + d.id); setTimeout(() => setArmedDel((x) => (x === "forever" + d.id ? "" : x)), 4000); return; }
                setArmedDel(""); setGone((g) => ({ ...g, [d.id]: true }));
                const r = await onDeleteForever(d.id);
                if (!r.ok) { setGone((g) => ({ ...g, [d.id]: false })); setStarErr(r.error || "Couldn't delete the logo."); }
              }}>{armedDel === "forever" + d.id ? "Delete for good?" : "Delete forever"}</button>}
          </div>}
        </div>
      </div>
    ); };
    const favs = live.filter((d) => d.starred).sort((a, b) => b.number - a.number);
    body = <>
      <div className="aa-home">
      <div className="aa-home-main stack">
      {/* Active / Archive at the top (Oct 24, Nick: "archive should be like a toggle on the top where it says archive") */}
      {!dcOn ? tableHead(<h2 className={showArch ? "" : "aa-areat"}>{showArch ? "Archived artwork" : "Artwork"}</h2>, showArch ? "Search archived" : "Search logos") : showArch ? <div className="aa-sec-h"><h3>Archived artwork</h3></div> : null}
      {/* brand standards (Oct 16, Nick): the exact inks we always print for them, grouped by their clients when needed */}
      {mode !== "portal" && brandCardEl}
      {mode === "shop" && !showArch && brandsPanel}
      <div className="aa-card">
        <div className="aa-sec-h aa-logos-h">{onUploadLogos && <LogoUpload onUpload={onUploadLogos} />}<h3>Logos</h3><span className="faint">{mode === "shop" ? "Starred logos come up first when picking art for this customer." : "Star your favorites so they come up first."} Archive the ones you don't need; they stay under Archive.</span>{starErr && <span className="aa-due">{starErr}</span>}</div>
        {showArch
          ? (aRows.length ? (() => { const P = pageOf("arch", aRows, 12); return <><div className="design-grid aa-grid6">{P.items.map((d) => card(d, true))}{slots(P.pad)}</div>{pager("arch", aRows.length, P.p, P.n, 12)}</>; })()
            : <div className="aa-empty">{archived.length ? `No archived logos match “${q}”.` : "No archived logos."}</div>)
          : dRows.length ? (() => { const P = pageOf("logos", dRows, 12); return <><div className="design-grid aa-grid6">{P.items.map((d) => card(d, false))}{slots(P.pad)}</div>{pager("logos", dRows.length, P.p, P.n, 12)}</>; })()
          : <div className="aa-empty">{live.length ? `No logos match “${q}”.` : "No logos on file yet."}</div>}
      </div>
      <div className="aa-card">
        <div className="aa-sec-h"><h3>Mockups</h3>{mode === "shop" && newMockup && <span className="aa-sec-acts"><a className="btn sm" href={newMockup}>New mockup</a><a className="btn sm" href={`${newMockup}&logo=1`} title="Just the logo on its colors, no garment and no order">New logo mockup</a></span>}</div>
        {/* one card per mockup set, with its number (Oct 24, Nick: "Mockups all need a number… they click on the mockup and
            they can either edit it or they can order it") */}
        {/* who made it, in its own section (Nov 3, Nick: "you should be able to see your mockups and then FBS mockups… different
            sections"); each side edits only its own, the other's opens to look at and copy (components/MockupBuilder.tsx) */}
        {(() => {
          const grid = (sets: AMockup[][], key: string) => (() => { const P = pageOf(key, sets, 12); return <>
          <div className="design-grid aa-grid6">
            {P.items.map((set) => { const m = set[0], name = m.title.split(" — ")[0].replace(/^Group \d+$/, "Mockup"); return (
              <div key={m.id} className={"design-card mk-card" + (m.starred ? " starred" : "")}>
                <div className="dc-img mock"><a href={m.url} target="_blank" rel="noreferrer" className="dc-open" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); setViewSet(set); }}>{m.thumb ? <img src={m.thumb} alt={m.title} /> : null}</a>
                  {m.mno != null && programMockups[m.mno] && <span className="dc-kept" title={`Used in their program (${programMockups[m.mno]}), so it can't be archived. Take it off the program first.`}>In program</span>}
                  {!m.shelved && onArchiveMockup && !(m.mno != null && programMockups[m.mno]) && <button type="button" className="dc-arch" title="Archive this mockup (find it under Archive)" aria-label="Archive mockup" onClick={() => shelveMock(m, true)}><Ico d={I.archive} size={14} /></button>}
                  {set.length > 1 && <span className="mk-card-n" title={set.map((x) => x.title.split(" — ")[1] || x.title).join("\n")}>{set.length} colors</span>}
                  {onStarMockup && !m.shelved && <div className="dc-tools"><button type="button" className={"dc-star" + (m.starred ? " on" : "")} title={m.starred ? "Remove from favorites" : "Add to favorites"} aria-label={m.starred ? "Remove from favorites" : "Add to favorites"} aria-pressed={!!m.starred} onClick={() => starMock(m)}>{m.starred ? "★" : "☆"}</button></div>}
                </div>
                <div className="dc-b">
                  <b data-notranslate>{m.mno ? `M-${m.mno}` : name}</b>
                  <span className={"mkx-by" + (m.byFbs ? " fbs" : "")}>{m.byFbs ? "Made by FBS" : mode === "portal" ? "Made by you" : "Made by the customer"}</span>
                  <span className="faint" title={m.title}>{[m.mno ? name : "", m.number ? `Order #${m.number}` : when(m.created_at)].filter(Boolean).join(" · ")}</span>
                  {m.shelved ? <div className="mk-card-acts"><button type="button" className="btn sm" onClick={() => shelveMock(m, false)}>Restore</button></div>
                  : !m.number && (m.setup || mode === "portal") && (
                    <div className="mk-card-acts">
                      {m.setup && <a className="btn sm" title={(mode === "portal" ? !m.byFbs : !!m.byFbs) ? undefined : "Made by the other side: open it to look, or make your own copy to change"} href={mode === "portal" ? `/portal/mockup?mockup=${m.id}${hrefQuery ? "&" + hrefQuery.replace(/^\?/, "") : ""}` : `/shop/artwork/mockup?mockup=${m.id}`}>{(mode === "portal" ? !m.byFbs : !!m.byFbs) ? "Edit" : "View"}</a>}
                      {mode === "portal" ? <MockupOrderButton id={m.id} canAct={canAct} /> : m.setup ? <><MockupOrderButton id={m.id} canAct shop send /><MockupOrderButton id={m.id} canAct shop className="btn sm" /></> : null}
                    </div>
                  )}
                </div>
              </div>
            ); })}{slots(P.pad)}
          </div>{pager(key, sets.length, P.p, P.n, 12)}</>; })();
          const mine = mSets.filter((x) => !x[0].byFbs), ours = mSets.filter((x) => !!x[0].byFbs);
          const parts: [string, string, AMockup[][], string][] = mode === "portal"
            ? [["Your mockups", "Made by you. Edit them, order them or share them.", mine, "mock"], ["From FBS", "Made by us for you. Open one to look, or make your own copy to change it.", ours, "mockf"]]
            : [["FBS mockups", "Made by us. Ours to change.", ours, "mockf"], ["Customer's mockups", "Made by the customer in their portal. Only they change these; we can make a copy.", mine, "mock"]];
          const shown = parts.filter((x) => x[2].length);
          if (!shown.length) return <div className="aa-empty">{showArch ? "No archived mockups." : mockups.length ? `No mockups match “${q}”.` : "No mockups yet."}</div>;
          return shown.map(([t, sub, sets, key]) => <div key={key} className="mkx-sec"><div className="mkx-h"><b>{t}</b><span className="faint">{sub}</span></div>{grid(sets, key)}</div>);
        })()}
      </div>
      {viewSet && (() => { const m0 = viewSet[0], name = m0.title.split(" — ")[0].replace(/^Group \d+$/, "Mockup"); return (
        <MockupViewer set={viewSet} name={name} onClose={() => setViewSet(null)}
          sub={<>{m0.mno ? `M-${m0.mno}` : ""}{m0.number ? <>{m0.mno ? " · " : ""}Order <Link href={orderHref(m0.order_id || "")}>#{m0.number}</Link></> : null}</>}
          actions={(m) => {
            const x = viewSet.find((y) => y.id === m.id) || m0;
            return <>
              {x.number && x.order_id ? <Link className="btn primary" href={orderHref(x.order_id)}>Open order #{x.number}</Link>
                : <>{x.setup && <MockupOrderButton id={x.id} canAct={mode === "portal" ? canAct : true} shop={mode !== "portal"} send={mode !== "portal"} className="btn primary" />}
                  {x.setup && mode !== "portal" && <MockupOrderButton id={x.id} canAct shop className="btn" />}
                  {x.setup && <a className="btn" href={mode === "portal" ? `/portal/mockup?mockup=${x.id}${hrefQuery ? "&" + hrefQuery.replace(/^\?/, "") : ""}` : `/shop/artwork/mockup?mockup=${x.id}`}>Edit</a>}</>}
            </>;
          }} />
      ); })()}
      {/* a small text button under the mockups, on the right (Oct 24, Nick: "at the bottom right-hand corner under mockups") */}
      <div className="aa-arch-foot"><button type="button" className="linkbtn aa-arch-link" onClick={() => { setShowArch(!showArch); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{showArch ? "Hide archive" : "Show archive"}</button></div>
      {mode === "shop" && gangPanel}
      {mode === "shop" && productionPanel}
      </div>
      <aside className="aa-attn aa-favs">
        <div className="aa-attn-h">★ Favorites</div>
        <div className="aa-attn-t">Logos</div>
        {favs.map((d) => (
          <div key={d.id} className="aa-fav">
            {designUrls[d.id] ? <span className="aa-fav-pic"><LogoFace d={d} urls={designUrls} shirt={logoShirts[d.id]} shown={logoLooks[d.id]?.shown || null} printed={logoLooks[d.id]?.printed || null} /></span> : <span className="aa-fav-ph">{(d.file_name.split(".").pop() || "").toUpperCase()}</span>}
            <span className="aa-fav-t">{mode === "shop" ? <Link href={`/shop/artwork/${d.id}`}><b>D-{d.number}</b></Link> : <b>D-{d.number}</b>}<span>{d.name || "Logo"}</span></span>
            {onStar && <button type="button" className="dc-star on" title="Remove from favorites" aria-label="Remove from favorites" onClick={() => star(d)}>★</button>}
          </div>
        ))}
        {!favs.length && <div className="aa-attn-none">No favorite logos yet. Tap the ☆ on a logo to add it here{mode === "shop" ? "; favorites come up first when picking art for this customer." : "."}</div>}
        <div className="aa-attn-t" style={{ marginTop: 6 }}>Mockups</div>
        {favMocks.map((m) => (
          <div key={m.id} className="aa-fav">
            <a href={m.url} target="_blank" rel="noreferrer">{m.thumb ? <img src={m.thumb} alt="" /> : <span className="aa-fav-ph" />}</a>
            <span className="aa-fav-t"><a href={m.url} target="_blank" rel="noreferrer"><b>{m.mno ? `M-${m.mno} · ` : ""}{m.title.split(" — ")[0]}</b></a><span className="faint">{m.number ? `Order #${m.number}` : when(m.created_at)}</span></span>
            {onStarMockup && <button type="button" className="dc-star on" title="Remove from favorites" aria-label="Remove from favorites" onClick={() => starMock(m)}>★</button>}
          </div>
        ))}
        {!favMocks.length && <div className="aa-attn-none">No favorite mockups yet. Tap the ☆ on a mockup to add it here.</div>}
      </aside>
      </div>
    </>;
  } else if (area === "texts" && textsPanel) {
    body = textsPanel;
  } else if (area === "messages" && mode === "shop" && messagesPanel) {
    // portal messages and their texts in one place (Oct 21, Nick)
    body = <>
      {textsPanel && (
        <div className="toolbar"><div className="chips" role="tablist" aria-label="Which conversation">
          <button type="button" role="tab" aria-selected={convNow === "portal"} className={"chip" + (convNow === "portal" ? " on" : "")} onClick={() => { setConv("portal"); if (rawArea === "texts") go("messages"); }}>Portal messages<span className="chip-n">{messages.length}</span></button>
          <button type="button" role="tab" aria-selected={convNow === "texts"} className={"chip" + (convNow === "texts" ? " on" : "")} onClick={() => { setConv("texts"); if (rawArea === "texts") go("messages"); }}>Texts<span className="chip-n">{(textsCount || 0).toLocaleString()}</span></button>
        </div></div>
      )}
      {convNow === "texts" && textsPanel ? textsPanel : messagesPanel}
    </>;
  } else if (area === "messages" && messagesPanel) {
    body = messagesPanel;
  } else if (area === "messages") {
    const rows = messages.filter((m) => has(q, m.body, m.author_name, m.number)).slice().reverse();
    body = <>
      {tableHead(<h2 className="aa-areat">Messages</h2>, "Search messages")}
      {onSend && <SendBox canAct={canAct} mode={mode} onSend={onSend} />}
      <div className="aa-msgs">
        {rows.map((m) => (
          <div key={m.id} className={"aa-msg " + (m.author_type === "staff" ? "shop" : "cust")}>
            <div className="aa-msg-h"><b>{m.author_name}</b><span className="faint">{new Date(m.created_at).toLocaleString()}</span>{m.order_id && m.number ? <Link href={orderHref(m.order_id, "messages")} className="aa-ord">Order #{m.number}</Link> : <span className="aa-ord gen">General</span>}</div>
            <div className="aa-msg-b">{m.body}</div>
          </div>
        ))}
        {!rows.length && <div className="aa-empty">{messages.length ? `No messages match “${q}”.` : "No messages yet."}</div>}
      </div>
    </>;
  } else if (area === "receive" && goodsPanel) {
    body = <>
      <div className="aa-bar"><div className="aa-bar-l"><h2 className="aa-areat">{mode === "shop" ? "Customer supplied goods" : "Goods"}</h2>{mode === "shop" ? <span className="aa-sum">Garments this customer sends us for their jobs</span> : null}</div></div>
      {goodsPanel}
    </>;
  } else if (area === "receive") {
    body = <>
      {tableHead(<><h2 className="aa-areat">{mode === "shop" ? "Waiting to receive" : "Garments to send us"}</h2><span className="aa-sum">{mode === "shop" ? "Customer-supplied garments we need before these jobs can print" : "These orders print on garments you supply"}</span></>, "Search orders")}
      {orderTable(receive, "work")}</>;
  } else if (area === "details") body = details;
  else if (area === "projects" && projectsPanel) body = <>
    <div className="aa-bar"><div className="aa-bar-l"><h2 className="aa-areat">Projects</h2><span className="aa-sum">{mode === "shop" ? "Events and bigger efforts with several orders" : "Planning an event, a season or a launch with several orders? Keep the dates, orders, to-dos and messages together."}</span></div></div>
    {projectsPanel}</>;
  else if (area === "program" && programPanel) body = programPanel;
  else if (area === "pricing" && (pricingPanel || (programPanel && hasProgram))) {
    const subs: [string, string][] = [...(programPanel && hasProgram ? [["program", "Your program pricing"] as [string, string]] : []), ...(pricingPanel ? [["list", "Price list"] as [string, string]] : [])]; // their own prices first
    const cur = subs.find((x) => x[0] === priceTab)?.[0] || subs[0][0];
    // the portal puts Price list / Your program pricing at the right of the title, where the search sits on other pages
    body = <>{mode === "portal" ? null : subBar(subs, cur, setPriceTab)}{cur === "program" ? programPanel : pricingPanel}</>;
  }
  else if (area === "designs" && designsPanel) body = designsPanel;
  // the shop's Artwork: Logos and mockups · Design catalog, as tabs inside it (Nov 3, Nick)
  if (mode === "shop" && area === "artwork" && designsPanel) {
    const subs: [string, string][] = [["art", "Logos and mockups"], ["catalog", "Design catalog"]];
    const cur = subs.find((x) => x[0] === shopArtTab)?.[0] || "art";
    body = <>{subBar(subs, cur, setShopArtTab)}{cur === "catalog" ? designsPanel : body}</>;
  }
  // portal Artwork: Logos and mockups · Design catalog · Brand standards, as tabs under it (Oct 24, Nick)
  if (dcOn && area === "artwork") {
    const subs: [string, string][] = [["catalog", "Design catalog"], ["art", "Artwork"], ...(brandCardEl ? [["brand", "Brand standards"] as [string, string]] : [])];
    const cur = subs.find((x) => x[0] === dcTab)?.[0] || "catalog";
    const dc = <ArtSearchContext.Provider value={q}>{designsPanel}</ArtSearchContext.Provider>;
    body = <>
      <div className="toolbar aa-otabs aa-subtabs aa-dc-bar" data-toolbar>
        <div className="chips">{subs.map(([k, t]) => <button key={k} type="button" className={"chip" + (cur === k ? " on" : "")} onClick={() => setDcTab(k)}>{t}</button>)}</div>
        <span className="spacer" />
        {cur !== "brand" && search(cur === "catalog" ? "Search your designs" : showArch ? "Search archived" : "Search logos")}
      </div>
      {cur === "catalog" ? dc : cur === "brand" ? brandCardEl : body}
    </>;
  } else if (mode === "portal" && area === "artwork") {
    const subs: [string, string][] = [["art", "Logos and mockups"], ...(designsPanel ? [["catalog", "Design catalog"] as [string, string]] : []), ...(brandCardEl ? [["brand", "Brand standards"] as [string, string]] : [])];
    const cur = subs.find((x) => x[0] === artTab)?.[0] || "art";
    body = <>{subBar(subs, cur, setArtTab)}{cur === "catalog" ? designsPanel : cur === "brand" ? brandCardEl : body}</>;
  }

  // the simple portal's Menu and "← Dashboard" (components/PortalSimpleMenu.tsx): the same pages as the tab bar it replaces
  const simpleNav = mode === "portal" && simple;
  const simpleCtx = simpleNav ? {
    go: (id: string) => { go(id as Area); setQ(""); }, current: area, settingsHref, settingsIcon: <Ico d={I.settings} />,
    items: AREAS.filter((a) => a.show !== false && !(a.id === "program" && !hasProgram)).map((a) => ({ id: a.id, label: a.label, icon: <Ico d={a.icon} />, n: a.id === "messages" ? a.n : undefined })),
  } : null;
  return (
    <SimpleMenuContext.Provider value={simpleCtx}>
    <div className={"aa" + (mode === "shop" ? " aa-shop" : "") + (simple ? " aa-simple" : "")} data-area={area}>
      {rqAsk && <RequestAsk order={rqAsk} customer={customerName} onClose={() => setRqAsk(null)} />}
      {mode === "shop" ? (
        <nav className="toolbar aa-shopnav" aria-label="Customer sections">
          <div className="chips">
            {AREAS.filter((a) => a.show !== false).map((a) => (
              <button key={a.id} type="button" className={"chip" + (area === a.id ? " on" : "")} onClick={() => { go(a.id); setQ(""); }}>{a.label}{a.n ? <span className="chip-n">{a.n}</span> : null}</button>
            ))}
            {(() => {
              const more = [
                !!programPanel && !hasProgram && area !== "program" ? { id: "program" as Area, label: "Turn on program pricing" } : null,
                !!projectsPanel && !(projectsCount || 0) && area !== "projects" ? { id: "projects" as Area, label: "Add a project" } : null,
                !!goodsPanel && area !== "receive" ? { id: "receive" as Area, label: `Customer goods${goodsCount ? ` (${goodsCount})` : ""}` } : null,
              ].filter(Boolean) as { id: Area; label: string }[];
              return more.length ? (
                <>
                  <button type="button" className="chip" aria-expanded={!!moreOpen} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMoreOpen((x) => (x ? null : { top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })); }}>More ▾</button>
                  {moreOpen && <><span className="cx-more-bg" onClick={() => setMoreOpen(null)} /><span className="cx-more-m" role="menu" style={{ top: moreOpen.top, right: moreOpen.right }}>{more.map((m) => <button key={m.id} type="button" role="menuitem" onClick={() => { setMoreOpen(null); go(m.id); setQ(""); }}>{m.label}</button>)}</span></>}
                </>
              ) : null;
            })()}
          </div>
        </nav>
      ) : (
      <nav className="aa-nav" aria-label="Account areas">
        {AREAS.filter((a) => a.show !== false).map((a) => (
          <button key={a.id} type="button" data-area={a.id} className={"aa-tab" + (area === a.id ? " on" : "") + (a.id === "program" && !hasProgram ? " off" : "")} title={a.id === "program" && !hasProgram ? (mode === "portal" ? "Program pricing: special flat prices on the items you order often. Ask us about it." : "No program set up yet") : a.label} onClick={() => { go(a.id); setQ(""); }}>
            <Ico d={a.icon} /><span>{a.label}</span>{a.n && (mode !== "portal" || a.id === "messages") ? <span className="aa-n">{a.n}</span> : null}
          </button>
        ))}
        {/* the customer's Settings, last on the bar (Oct 24, Nick: "on the toolbar all the way to the right") */}
        {mode === "portal" && settingsHref && <Link className="aa-tab aa-tab-end" href={settingsHref}><Ico d={I.settings} /><span>Settings</span></Link>}
      </nav>
      )}
      {/* every portal page opens with its name in one place, one font, one rainbow (Nov 2, Nick: "all the pages in the
          customer portal should have the exact same look as payments… just slightly in"); the areas' own titles step aside */}
      {mode === "portal" && <div className="aa-ptop">
        {simpleNav ? <span className="psmn-tl"><SimpleBack /><h1 className="aa-ptitle">{AREAS.find((a) => a.id === area)?.label || ""}</h1></span> : <h1 className="aa-ptitle">{AREAS.find((a) => a.id === area)?.label || ""}</h1>}
        {/* the page's search, on the title's line at the right; it filters what this page shows. On Payments the statement
            sits just left of it (Nov 2, Nick) */}
        <span className="aa-ptop-r">{area === "payments" && terms && <span className="aa-ptop-terms">Terms: <b>{terms}</b></span>}{area === "payments" && statementHref && <a className="btn sm" href={statementHref}>View / print statement</a>}
        {area === "pricing" && (() => {
          const subs: [string, string][] = [...(programPanel && hasProgram ? [["program", "Your program pricing"] as [string, string]] : []), ...(pricingPanel ? [["list", "Price list"] as [string, string]] : [])]; // their own prices first
          if (subs.length < 2) return null;
          const cur = subs.find((x) => x[0] === priceTab)?.[0] || subs[0][0];
          return <div className="toolbar aa-otabs aa-ptop-sw" data-toolbar><div className="chips">{subs.map(([k, t]) => <button key={k} type="button" className={"chip" + (cur === k ? " on" : "")} onClick={() => setPriceTab(k)}>{t}</button>)}</div></div>;
        })()}
        {area === "home" && titleAsk ? titleAsk : area !== "pricing" && search(({ home: "Search the dashboard", orders: "Search orders and quotes", quotes: "Search quotes", payments: "Search payments", artwork: "Search logos", projects: "Search projects", messages: "Search messages", receive: "Search goods" } as Record<string, string>)[area] || "Search this page")}</span>
        {/* the simple menu: a direct child of the title row, so on a phone it stays on the title's line as a ☰ (Nov 4, Nick) */}
        {simpleNav && <PortalSimpleMenu />}
      </div>}
      <section className="aa-body">{mode === "portal" ? <PageSearchContext.Provider value={q}>{body}</PageSearchContext.Provider> : body}</section>
    </div>
    </SimpleMenuContext.Provider>
  );
}

function SendBox({ onSend, canAct, mode }: { onSend: (b: string) => Promise<{ ok: boolean; error?: string; emailed?: boolean }>; canAct: boolean; mode: "shop" | "portal" }) {
  const [t, setT] = useState(""), [busy, setBusy] = useState(false), [note, setNote] = useState("");
  const router = useRouter();
  return (
    <div className="aa-card aa-send">
      <label className="lbl" htmlFor="aa-msg">{mode === "shop" ? "SEND A MESSAGE TO THIS CUSTOMER" : "SEND US A MESSAGE"}</label>
      <textarea id="aa-msg" rows={3} placeholder={mode === "shop" ? "Not about one order? Write it here. They'll see it in their portal and get an email." : "Questions about anything? Write us here. For a specific order, message on that order."} value={t} onChange={(e) => setT(e.target.value)} disabled={!canAct} />
      <div className="row"><span className="faint" style={{ fontSize: 12 }}>{note || (!canAct ? "Turned off in the preview." : "")}</span><span className="spacer" />
        <button type="button" className="btn primary" disabled={!canAct || busy || !t.trim()} onClick={async () => { setBusy(true); const r = await onSend(t); setBusy(false); if (r.ok) { setT(""); setNote(r.emailed ? "Sent and emailed." : "Sent."); router.refresh(); } else setNote(r.error || "Couldn't send."); }}>{busy ? "Sending…" : "Send"}</button>
      </div>
    </div>
  );
}

/** Upload logos to a customer's account (shop): a small button at the right of the Logos heading (pick several files,
 *  or drop them on the page); each becomes a logo (D-number) for future use. */
function LogoUpload({ onUpload }: { onUpload: (files: File[], star: boolean, progress: (done: number) => void) => Promise<string | void> }) {
  const [busy, setBusy] = useState<{ done: number; of: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [star, setStar] = useState(false);
  const [over, setOver] = useState(false);
  const go = async (list: FileList | File[] | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    setBusy({ done: 0, of: files.length }); setMsg("");
    const err = await onUpload(files, star, (done) => setBusy({ done, of: files.length })).catch((e) => (e instanceof Error ? e.message : String(e)));
    setBusy(null);
    setMsg(err ? String(err) : `Added ${files.length} logo${files.length === 1 ? "" : "s"}${star ? " to their favorites" : ""}.`);
    setTimeout(() => setMsg(""), 6000);
  };
  // files dropped anywhere on the page land here (the Artwork tab is the only drop target)
  useEffect(() => {
    const on = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); setOver(e.type === "dragover"); } };
    const drop = (e: DragEvent) => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); setOver(false); go(e.dataTransfer.files); };
    window.addEventListener("dragover", on); window.addEventListener("dragleave", on); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", on); window.removeEventListener("dragleave", on); window.removeEventListener("drop", drop); };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className={"aa-up" + (over ? " over" : "")}>
      {msg && <span className="aa-up-msg">{msg}</span>}
      <label className="check aa-up-star" title="Star the logos as they're added"><input type="checkbox" checked={star} onChange={(e) => setStar(e.target.checked)} /> Star</label>
      <label className="btn sm aa-up-btn" title="Add logos (AI, EPS, PDF, SVG, PNG); or drop the files on the page">{busy ? `Uploading ${busy.done}/${busy.of}…` : over ? "Drop to upload" : "+ Upload"}<input type="file" multiple accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.ai,.eps,.psd,.dst,.heic,.heif,.tif,.tiff,.bmp" hidden disabled={!!busy} onChange={(e) => { go(heldFiles(e.target.files)); e.target.value = ""; }} /></label>
    </span>
  );
}
