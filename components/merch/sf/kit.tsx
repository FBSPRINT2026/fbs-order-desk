"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicProduct, PublicStore } from "@/lib/merchServer";
import { r2 } from "@/lib/merch";

/* Shared bits of the public store: money, the school's colors, the store's own little router, and the bag. */

export const money = (n: number) => (+n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
/** "$18" for whole dollars, "$18.50" otherwise (prices on tiles) */
export const price = (n: number) => (Math.round(n * 100) % 100 ? money(n) : `$${Math.round(n)}`);

/** readable text on a color (white on dark colors, ink on light ones) */
export function onColor(hex?: string) {
  const m = (hex || "").replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "#fff";
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? "#15181E" : "#fff";
}
export const brandVars = (b: PublicStore["brand"]) => {
  const c = b?.primary || "#1F3A8A", a = b?.accent || "#F2B705";
  return { ["--c" as string]: c, ["--a" as string]: a, ["--on-c" as string]: onColor(c), ["--on-a" as string]: onColor(a) };
};

/* ------------------------------------------------------------ the store's pages (real URLs, so Back works) */

export type Route = { view: "home" | "item" | "checkout"; item?: string; bag?: boolean };
export function readRoute(search: string): Route {
  const q = new URLSearchParams(search);
  const item = q.get("item") || undefined;
  return { view: q.get("checkout") ? "checkout" : item ? "item" : "home", item, bag: q.get("bag") === "1" };
}
const toSearch = (r: Route) => {
  const q = new URLSearchParams();
  if (r.view === "item" && r.item) q.set("item", r.item);
  if (r.view === "checkout") q.set("checkout", "1");
  if (r.bag) q.set("bag", "1");
  const s = q.toString();
  return s ? `?${s}` : "";
};

/**
 * Pages inside the store (an item, the bag, checkout) are ?item=…, ?bag=1, ?checkout=1 on the store's address: each one
 * is its own history entry, so the phone's Back button does what people expect, and links can be shared.
 */
export function useRoute(initial: Route) {
  const [route, setRoute] = useState<Route>(initial);
  const homeScroll = useRef(0);
  useEffect(() => {
    const on = () => setRoute(readRoute(location.search));
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const cur = useRef(route);
  cur.current = route;
  const go = useCallback((r: Route, opts: { replace?: boolean } = {}) => {
    if (cur.current.view === "home" && r.view !== "home") homeScroll.current = scrollY;
    const url = location.pathname + toSearch(r);
    if (url !== location.pathname + location.search) history[opts.replace ? "replaceState" : "pushState"](null, "", url);
    cur.current = r;
    setRoute(r);
  }, []);
  // a new page starts at the top; coming back to the store's front page returns to where you were
  const last = useRef(route.view + (route.item || ""));
  useEffect(() => {
    const k = route.view + (route.item || "");
    if (k === last.current) return;
    last.current = k;
    scrollTo({ top: route.view === "home" ? homeScroll.current : 0, behavior: "instant" as ScrollBehavior });
  }, [route.view, route.item]);
  return { route, go };
}

/* ------------------------------------------------------------ the bag (kept on this device until checkout) */

export type BagLine = { key: string; product_id: string; color: string; size: string; qty: number; personalization?: Record<string, string> };
const lineKey = (l: Omit<BagLine, "key" | "qty">) => [l.product_id, l.color, l.size, JSON.stringify(l.personalization || {})].join("|");

export function useBag(slug: string, products: PublicProduct[]) {
  const key = `fbs:bag2:${slug}`;
  const [lines, setLines] = useState<BagLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try { const v = localStorage.getItem(key); if (v) setLines((JSON.parse(v) as BagLine[]).filter((l) => l && l.product_id && l.qty > 0)); } catch { /* private window: the bag lasts for this visit */ }
    setLoaded(true);
  }, [key]);
  const save = useCallback((next: BagLine[]) => {
    setLines(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* fine */ }
  }, [key]);
  const add = useCallback((adds: Omit<BagLine, "key">[]) => {
    setLines((cur) => {
      const next = [...cur];
      for (const a of adds) {
        if (a.qty <= 0) continue;
        const k = lineKey(a), hit = next.find((x) => x.key === k);
        if (hit) hit.qty = Math.min(99, hit.qty + a.qty); else next.push({ ...a, key: k });
      }
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* fine */ }
      return next.map((x) => ({ ...x }));
    });
  }, [key]);
  const setQty = useCallback((k: string, qty: number) => save(lines.map((l) => (l.key === k ? { ...l, qty: Math.max(0, Math.min(99, qty)) } : l)).filter((l) => l.qty > 0)), [lines, save]);
  const clear = useCallback(() => save([]), [save]);

  // what each line is now (name, picture, price come from the store, never from what was saved)
  const view = useMemo(() => lines.map((l) => {
    const p = products.find((x) => x.id === l.product_id);
    const c = p?.colors.find((x) => x.name === l.color);
    const okSize = !!p && !!c && (c.sizes?.length ? c.sizes : p.sizes).includes(l.size);
    const extra = (p?.personalize || []).reduce((a, f) => a + (l.personalization?.[f.label]?.trim() ? +f.price || 0 : 0), 0);
    const each = p && okSize ? r2((p.prices[l.size] || 0) + extra) : 0;
    return { ...l, p, c, ok: !!p && okSize, name: p?.name || "No longer available", image: c?.image || c?.photo || "", each, total: r2(each * l.qty) };
  }), [lines, products]);
  const live = view.filter((l) => l.ok);
  const count = live.reduce((a, l) => a + l.qty, 0);
  const subtotal = r2(live.reduce((a, l) => a + l.total, 0));
  return { lines: view, live, count, subtotal, loaded, add, setQty, clear, remove: (k: string) => setQty(k, 0) };
}
export type Bag = ReturnType<typeof useBag>;
export type BagView = Bag["lines"][number];

/* ------------------------------------------------------------ small pieces */

/** − [n] + : the number can be typed too */
export function Stepper({ value, onChange, min = 0, max = 99, label, size = "md" }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string; size?: "md" | "sm" }) {
  const [txt, setTxt] = useState(String(value || ""));
  useEffect(() => { setTxt(value ? String(value) : ""); }, [value]);
  const set = (n: number) => onChange(Math.max(min, Math.min(max, Math.round(n) || 0)));
  return (
    <div className={"sf-step" + (value > 0 ? " on" : "") + (size === "sm" ? " sm" : "")} role="group" aria-label={label}>
      <button type="button" aria-label={`One less: ${label}`} onClick={() => set(value - 1)} disabled={value <= min}>−</button>
      <input inputMode="numeric" pattern="[0-9]*" aria-label={`How many: ${label}`} value={txt} placeholder="0"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 2); setTxt(v); set(+v || 0); }}
        onBlur={() => setTxt(value ? String(value) : "")} />
      <button type="button" aria-label={`One more: ${label}`} onClick={() => set(value + 1)} disabled={value >= max}>+</button>
    </div>
  );
}

/** "3 days left", "5 hours left", ticking each minute */
export function useCountdown(iso: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  if (!iso) return { text: "", soon: false, gone: false };
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return { text: "closed", soon: false, gone: true };
  const h = ms / 3600000, d = Math.floor(h / 24);
  const text = d >= 2 ? `${d} days left` : h >= 24 ? `1 day, ${Math.floor(h - 24)} hr left` : h >= 1 ? `${Math.floor(h)} hr ${Math.floor((h % 1) * 60)} min left` : `${Math.max(1, Math.floor(ms / 60000))} min left`;
  return { text, soon: h < 48, gone: false };
}

/** a date for people: "Friday, Oct 17" / "Oct 17" */
export function day(iso: string | null | undefined, weekday = true) {
  if (!iso) return "";
  const x = iso.length === 10 ? new Date(iso + "T12:00:00") : new Date(iso);
  return x.toLocaleDateString("en-US", { timeZone: "America/Chicago", ...(weekday ? { weekday: "long" } : {}), month: "short", day: "numeric" });
}
/** "5:00 PM" when a store closes at a time other than midnight */
export function closeTime(iso: string | null | undefined) {
  if (!iso) return "";
  const t = new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  return /^11:59|^12:00 AM/.test(t) ? "" : t;
}
