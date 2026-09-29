"use client";
import { useEffect, useRef, useState } from "react";
import { useSticky } from "@/lib/useSticky";

/**
 * "Translate to Spanish": a switch at the top right of every page. When it's on, the page's text is shown in Spanish:
 * each piece of text on screen is looked up (this browser's copy first, then the shop's saved translations, then
 * Claude for anything new, saved for everyone after), and swapped in place. Numbers stay as they are ("8 jobs" is
 * translated once as "{0} jobs"). Typing in fields isn't touched. Mark anything that must stay in English with
 * data-notranslate. Turning it off puts the English back. The setting is remembered in this browser.
 */
type Lang = "es";
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE", "SVG", "svg", "IFRAME", "CANVAS"]);
const ATTRS = ["placeholder", "title", "aria-label"] as const;
const LETTER = /[A-Za-z]{2,}/;
const NUM = /\d+(?:[.,:/]\d+)*/g;
const LOCAL = "fbs:tr:";

// "4h 19m booked" → { key: "{0}h {1}m booked", nums: ["4", "19"] }
function templ(s: string) {
  const nums: string[] = [];
  const key = s.replace(NUM, (m) => `{${nums.push(m) - 1}}`);
  return { key, nums };
}
const fill = (t: string, nums: string[]) => t.replace(/\{(\d+)\}/g, (_, i) => nums[+i] ?? "");
const wanted = (s: string) => s.length <= 400 && LETTER.test(s) && !/^[A-Z]{1,3}$/.test(s) && !/^\S+@\S+\.\S+$/.test(s) && !/^https?:\/\//.test(s);

export default function Translate({ className = "" }: { className?: string }) {
  const [lang, setLang] = useSticky<"en" | Lang>("lang", "en");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const on = lang === "es";
  const eng = useRef<Engine | null>(null);

  useEffect(() => {
    if (!on) return;
    const e = new Engine("es", setBusy, setErr);
    eng.current = e;
    e.start();
    return () => { e.stop(); eng.current = null; setBusy(false); setErr(""); };
  }, [on]);

  return (
    <label className={"tr-sw " + className} data-notranslate title={err || (on ? "Showing this page in Spanish. Turn off for English." : "Show this page in Spanish")}>
      <input type="checkbox" aria-label="Translate to Spanish" checked={on} onChange={(e) => setLang(e.target.checked ? "es" : "en")} />
      <span className="tr-track" aria-hidden><i /></span>
      <span className="tr-l">{on ? (busy ? "Traduciendo…" : "Español") : "Translate to Spanish"}</span>
      {err && <span className="tr-err" aria-label={err}>!</span>}
    </label>
  );
}

class Engine {
  private lang: Lang;
  private dict: Record<string, string>;
  private orig = new WeakMap<Text, { src: string; shown: string }>();
  private origAttr = new WeakMap<Element, Record<string, { src: string; shown: string }>>();
  private touched = new Set<WeakRef<Text | Element>>();
  private mo: MutationObserver | null = null;
  private queued = false;
  private want = new Set<string>();
  private asked = new Set<string>();
  private inflight = 0;
  private saveT: ReturnType<typeof setTimeout> | null = null;
  constructor(lang: Lang, private setBusy: (b: boolean) => void, private setErr: (e: string) => void) {
    this.lang = lang;
    try { this.dict = JSON.parse(localStorage.getItem(LOCAL + lang) || "{}"); } catch { this.dict = {}; }
  }
  start() {
    document.documentElement.lang = this.lang;
    this.mo = new MutationObserver(() => this.schedule());
    this.mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    this.pass();
  }
  stop() {
    this.mo?.disconnect(); this.mo = null;
    document.documentElement.lang = "en";
    // put the English back wherever the page still shows our Spanish
    for (const ref of this.touched) {
      const n = ref.deref();
      if (!n) continue;
      if (n instanceof Text) { const o = this.orig.get(n); if (o && n.nodeValue === o.shown) n.nodeValue = o.src; }
      else { const oa = this.origAttr.get(n); if (oa) for (const [a, o] of Object.entries(oa)) if (n.getAttribute(a) === o.shown) n.setAttribute(a, o.src); }
    }
    this.touched.clear();
  }
  private schedule() {
    if (this.queued || !this.mo) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; if (this.mo) this.pass(); });
  }
  private skip(el: Element | null): boolean {
    for (let e = el; e; e = e.parentElement) {
      if (SKIP.has(e.tagName) || e.hasAttribute("data-notranslate") || (e as HTMLElement).isContentEditable) return true;
      if (e === document.body) return false;
    }
    return false;
  }
  // one sweep of the page: swap what we know, collect what we don't
  private pass() {
    const mo = this.mo!;
    mo.disconnect();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
      // React writes "{n} jobs won't make {their} date" as several text nodes side by side: translate the run as one
      // sentence (the Spanish goes in the first node, the rest are emptied), so word order can change
      if (n.previousSibling instanceof Text) continue;
      const run: Text[] = [n];
      for (let x = n.nextSibling; x instanceof Text; x = x.nextSibling) run.push(x);
      const recs = run.map((t) => this.orig.get(t));
      // our own Spanish from last time, untouched: nothing to do
      if (recs.every((o, i) => o && run[i].nodeValue === o.shown)) continue;
      if (this.skip(n.parentElement)) continue;
      // the English as the page has it now (a node the page changed since shows its new English)
      const srcs = run.map((t, i) => { const v = t.nodeValue || "", o = recs[i]; return o && v === o.shown ? o.src : v; });
      const src = srcs.join(""), core = src.trim();
      if (!core || !wanted(core)) continue;
      const { key, nums } = templ(core);
      const hit = this.dict[key];
      if (hit == null) { this.want.add(key); continue; }
      const whole = src.replace(core, fill(hit, nums));
      run.forEach((t, i) => {
        const shown = i === 0 ? whole : "";
        if (!recs[i]) this.touched.add(new WeakRef(t));
        this.orig.set(t, { src: srcs[i], shown });
        if (t.nodeValue !== shown) t.nodeValue = shown;
      });
    }
    for (const el of document.body.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(","))) {
      if (this.skip(el)) continue;
      const rec = this.origAttr.get(el) || {};
      let changed = false;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v || (rec[a] && v === rec[a].shown)) continue;
        const core = v.trim();
        if (!wanted(core)) continue;
        const { key, nums } = templ(core);
        const hit = this.dict[key];
        if (hit == null) { this.want.add(key); continue; }
        const shown = fill(hit, nums);
        rec[a] = { src: v, shown }; changed = true;
        if (shown !== v) el.setAttribute(a, shown);
      }
      if (changed) { if (!this.origAttr.has(el)) this.touched.add(new WeakRef(el)); this.origAttr.set(el, rec); }
    }
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    this.fetchMissing();
  }
  private fetchMissing() {
    const need = [...this.want].filter((k) => !(k in this.dict) && !this.asked.has(k));
    this.want.clear();
    for (let i = 0; i < need.length; i += 80) {
      const batch = need.slice(i, i + 80);
      batch.forEach((k) => this.asked.add(k));
      this.inflight++; this.setBusy(true);
      fetch("/api/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang: this.lang, strings: batch }) })
        .then((r) => r.json())
        .then((j: { t?: Record<string, string>; error?: string }) => {
          // anything that didn't come back is tried again next time the switch is turned on (not in a loop now)
          const got = j.t || {};
          Object.assign(this.dict, got);
          this.setErr(j.error || "");
          if (Object.keys(got).length) { this.save(); if (this.mo) this.schedule(); }
        })
        .catch(() => this.setErr("Couldn't reach the translator. Check the connection."))
        .finally(() => { this.inflight--; if (!this.inflight) this.setBusy(false); });
    }
  }
  private save() {
    if (this.saveT) clearTimeout(this.saveT);
    this.saveT = setTimeout(() => {
      try {
        const keys = Object.keys(this.dict);
        // keep this browser's copy to a sensible size (the shop's saved translations are the full list)
        if (keys.length > 6000) for (const k of keys.slice(0, keys.length - 6000)) delete this.dict[k];
        localStorage.setItem(LOCAL + this.lang, JSON.stringify(this.dict));
      } catch { /* storage full or blocked */ }
    }, 800);
  }
}
