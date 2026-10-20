"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Right-click an email (Oct 20, Nick: "right-click an email and it do things like Outlook does, like click reply or
 * click find all the messages in this conversation"): a small menu at the pointer with what the Email screen already
 * does. Also from the keyboard (the Menu key or Shift+F10 on a row). Closes on Escape, a click elsewhere, scrolling or
 * resizing; always kept inside the window. Phones keep press-and-hold (components/HoldMenu.tsx).
 */
export type CtxItem = { key: string; label: string; icon?: React.ReactNode; hint?: string; danger?: boolean; disabled?: boolean; /** a nested folder */ indent?: number; onPick?: () => void; sub?: CtxItem[] } | "-";

const M = 8; // keep this far from the window's edges

function Menu({ items, x, y, alignRight, onClose, label, depth, closeAll, focusFirst }: { items: CtxItem[]; x: number; y: number; /** opened from the keyboard: its first item gets the focus */ focusFirst: boolean; /** a submenu: x is the parent's left edge, for flipping */ alignRight?: number; onClose: () => void; label: string; depth: number; closeAll: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [subAt, setSubAt] = useState<{ k: string; x: number; y: number; left: number; kb: boolean } | null>(null);
  const live = items.filter((i): i is Exclude<CtxItem, "-"> => i !== "-");
  // inside the window: flipped left / up when it would run off (a submenu opens to the left of its menu instead)
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left = x, top = y;
    if (left + w > vw - M) left = alignRight != null ? alignRight - w : x - w;
    if (top + h > vh - M) top = Math.max(M, vh - M - h);
    setPos({ left: Math.max(M, Math.min(left, vw - M - w)), top: Math.max(M, top) });
  }, [x, y, alignRight]);
  // the first item has the focus, so the arrow keys work straight away
  useEffect(() => { if (pos && focusFirst) ref.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus(); }, [!!pos]); // eslint-disable-line react-hooks/exhaustive-deps
  const btns = () => [...(ref.current?.querySelectorAll<HTMLElement>(":scope > [role=menuitem]:not([disabled])") || [])];
  const openSub = (it: Exclude<CtxItem, "-">, el: HTMLElement, kb = false) => { const r = el.getBoundingClientRect(), m = ref.current!.getBoundingClientRect(); setSubAt({ k: it.key, x: m.right - 4, y: r.top - 6, left: m.left + 4, kb }); };
  const onKey = (e: React.KeyboardEvent) => {
    const list = btns(), i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); const n = list.length; if (n) list[(i + (e.key === "ArrowDown" ? 1 : -1) + n) % n].focus(); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); e.stopPropagation(); list[e.key === "Home" ? 0 : list.length - 1]?.focus(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); const it = live.find((x) => x.key === (document.activeElement as HTMLElement)?.dataset.k); if (it?.sub && document.activeElement) openSub(it, document.activeElement as HTMLElement, true); }
    else if (e.key === "ArrowLeft" && depth > 0) { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (depth > 0) onClose(); else closeAll(); }
    else if (e.key === "Tab") { e.preventDefault(); closeAll(); }
  };
  const sub = subAt ? live.find((x) => x.key === subAt.k)?.sub : undefined;
  return (
    <>
      <div ref={ref} className="cxm" role="menu" aria-label={label} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}
        style={pos ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: "hidden" }}>
        {items.map((it, k) => it === "-" ? <div key={"s" + k} className="cxm-sep" role="separator" /> : (
          <button key={it.key} data-k={it.key} type="button" role="menuitem" className={"cxm-i" + (it.danger ? " danger" : "") + (subAt?.k === it.key ? " on" : "")} disabled={it.disabled}
            aria-haspopup={it.sub ? "menu" : undefined} aria-expanded={it.sub ? subAt?.k === it.key : undefined}
            style={it.indent ? { paddingLeft: 10 + Math.min(3, it.indent) * 12 } : undefined}
            onMouseEnter={(e) => { if (it.sub) openSub(it, e.currentTarget); else setSubAt(null); }}
            onClick={(e) => { if (it.sub) { openSub(it, e.currentTarget, e.detail === 0); return; } closeAll(); it.onPick?.(); }}>
            <span className="cxm-ic" aria-hidden>{it.icon}</span><span className="cxm-l">{it.label}</span>
            {it.hint && <span className="cxm-h">{it.hint}</span>}
            {it.sub && <svg className="cxm-more" viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>}
          </button>
        ))}
      </div>
      {sub && subAt && <Menu items={sub} x={subAt.x} y={subAt.y} alignRight={subAt.left} label={live.find((x) => x.key === subAt.k)?.label || ""} depth={depth + 1} closeAll={closeAll} focusFirst={subAt.kb}
        onClose={() => { const k = subAt.k; setSubAt(null); ref.current?.querySelector<HTMLElement>(`[data-k="${CSS.escape(k)}"]`)?.focus(); }} />}
    </>
  );
}

export default function MailContextMenu({ at, items, label, onClose }: { at: { x: number; y: number }; items: CtxItem[]; label: string; onClose: () => void }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null;
    const born = Date.now();
    // (the Menu key / Shift+F10 also send a right-click event just after the key opened the menu: not a click elsewhere)
    const away = (e: Event) => { if (e.type === "contextmenu" && Date.now() - born < 700) return; if (!wrap.current?.contains(e.target as Node)) onClose(); };
    const shut = () => onClose();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // a scroll inside the menu itself (a long folder list) doesn't close it
    const scroll = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("contextmenu", away, true);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", shut);
    window.addEventListener("blur", shut);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("contextmenu", away, true);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", shut);
      window.removeEventListener("blur", shut);
      // the focus goes back to the email it was opened on (not when what was picked put it somewhere, like the reply box)
      const a = document.activeElement;
      if (!a || a === document.body) { try { back.current?.focus({ preventScroll: true }); } catch { /* gone */ } }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={wrap} className="cxm-wrap"><Menu items={items} x={at.x} y={at.y} label={label} depth={0} onClose={onClose} closeAll={onClose} focusFirst /></div>;
}
