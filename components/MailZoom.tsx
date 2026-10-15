"use client";
import { useEffect, useState } from "react";

/**
 * Email text size, phones (Oct 15, Nick: "a zoom in or zoom out… Amanda has the bigger phone, smaller type so she can
 * see more emails"). Kept on each phone (its own setting, like the iPhone's), as `--mz` on the page: the email list's
 * rows and the email's text scale by it (globals.css `.ibx2-item{zoom:var(--mz)}`, PHONE_MAIL_CSS). Changed from the
 * folders sheet (A− / A+) or by pinching the email list.
 */
const KEY = "fbs_mail_zoom";
export const MZ_MIN = 0.8, MZ_MAX = 1.3, MZ_STEP = 0.05;
const clamp = (v: number) => Math.min(MZ_MAX, Math.max(MZ_MIN, +(Math.round(v / MZ_STEP) * MZ_STEP).toFixed(2)));

export function mailZoom(): number {
  try { const v = parseFloat(localStorage.getItem(KEY) || ""); return Number.isFinite(v) ? clamp(v) : 1; } catch { return 1; }
}
/** `:root{--mz:…}` for an email's frame (its own page, so it needs telling) */
export const mzCss = () => `:root{--mz:${mailZoom()}}`;

const subs = new Set<(v: number) => void>();
/** show a size (live, while pinching); `keep` saves it */
export function showZoom(v: number, keep = true) {
  const x = keep ? clamp(v) : +Math.min(MZ_MAX, Math.max(MZ_MIN, v)).toFixed(3);
  document.documentElement.style.setProperty("--mz", String(x));
  // the open emails' frames too
  document.querySelectorAll("iframe").forEach((f) => { try { f.contentDocument?.documentElement.style.setProperty("--mz", String(x)); } catch { /* not ours */ } });
  if (keep) { try { if (x === 1) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(x)); } catch { /* private mode */ } subs.forEach((f) => f(x)); }
}

/** on the Inbox: put the phone's size on, and let a pinch on the email list change it */
export function useMailZoom(list: React.RefObject<HTMLElement | null>) {
  useEffect(() => { document.documentElement.style.setProperty("--mz", String(mailZoom())); }, []);
  useEffect(() => {
    const el = list.current; if (!el || !matchMedia("(pointer:coarse)").matches) return;
    let p: { d: number; z: number } | null = null, now = 1;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const start = (e: TouchEvent) => { if (e.touches.length === 2) { p = { d: dist(e.touches), z: mailZoom() }; now = p.z; } };
    const move = (e: TouchEvent) => {
      if (!p || e.touches.length !== 2) return;
      e.preventDefault(); // not the page's own zoom
      now = p.z * Math.pow(dist(e.touches) / p.d, 0.6); // gentle: a full pinch is about one size
      showZoom(now, false);
    };
    const end = (e: TouchEvent) => { if (p && e.touches.length < 2) { showZoom(now); p = null; } };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end); el.addEventListener("touchcancel", end);
    return () => { el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move); el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end); };
  }, [list]);
}

/** the folders sheet's "Text size  A−  100%  A+" */
export function MailZoomControl() {
  const [z, setZ] = useState(1);
  useEffect(() => { setZ(mailZoom()); subs.add(setZ); return () => { subs.delete(setZ); }; }, []);
  const pct = Math.round(z * 100);
  return (
    <div className="mz">
      <span className="mz-l">Text size<small>{pct === 100 ? "Standard" : `${pct}%`} · on this phone · or pinch the list</small></span>
      <button type="button" className="mz-b sm" aria-label="Smaller text" disabled={z <= MZ_MIN + 0.001} onClick={() => showZoom(z - MZ_STEP)}>A</button>
      <button type="button" className="mz-b lg" aria-label="Larger text" disabled={z >= MZ_MAX - 0.001} onClick={() => showZoom(z + MZ_STEP)}>A</button>
    </div>
  );
}
