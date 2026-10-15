"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The Home Screen app's first page (Oct 15, Nick: "I just want the web app to open right to my email"). The app
 * always starts at /shop (app/manifest.ts); on this phone it can go straight on to another page instead. Kept on the
 * phone (each phone or iPad decides for itself), so nothing needs re-adding to the Home Screen.
 */
const KEY = "fbs.app.start", LAUNCHED = "fbs.app.launched";
export const isApp = () => typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
const read = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
/** the same choice as a cookie, so the server sends the app straight there before drawing the dashboard (middleware.ts) */
const COOKIE = "fbs_app_start";
const setCookie = (v: string) => { document.cookie = v ? `${COOKIE}=${v}; path=/; max-age=31536000; samesite=lax; secure` : `${COOKIE}=; path=/; max-age=0`; };
const hasCookie = () => document.cookie.split(/;\s*/).some((c) => c.startsWith(COOKIE + "="));

/** in the shop's menu: when the app has just been opened on its start page, go to the page chosen for this phone */
export function AppLaunch() {
  const router = useRouter();
  useEffect(() => {
    if (!isApp()) return;
    // chosen before the cookie existed: add it, so the next launch skips the dashboard
    const chosen = read(); if (chosen && !hasCookie()) setCookie(chosen);
    try { if (sessionStorage.getItem(LAUNCHED)) return; sessionStorage.setItem(LAUNCHED, "1"); } catch { return; }
    const to = read(), here = window.location.pathname;
    if (to && to !== here && (here === "/shop" || here === "/")) router.replace(to);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** on a page: "Open the app here" (only in the Home Screen app) */
export function AppStartToggle({ path, label }: { path: string; label: string }) {
  const [app, setApp] = useState(false), [on, setOn] = useState(false);
  useEffect(() => { setApp(isApp()); setOn(read() === path); }, [path]);
  if (!app) return null;
  const set = (v: boolean) => { try { if (v) localStorage.setItem(KEY, path); else localStorage.removeItem(KEY); } catch { /* private mode */ } setCookie(v ? path : ""); setOn(v); };
  return on
    ? <button type="button" className="btn sm ghost app-start on" onClick={() => set(false)} title="The app opens to the dashboard instead">✓ App opens to {label}</button>
    : <button type="button" className="btn sm ghost app-start" onClick={() => set(true)} title={`Open the Home Screen app straight to ${label}`}>Open the app to {label}</button>;
}
