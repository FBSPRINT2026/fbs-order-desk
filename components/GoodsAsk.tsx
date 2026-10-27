"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { goodsFor, kindOf, rankWord, type PreferredGood } from "@/lib/preferredGoods";

/**
 * Create order: the email didn't say which garment (Oct 26, Nick: "read the email cold… I can't detect what this is…
 * I noticed the customer has a preferred… should I apply that? …yes… OK which color… if you can't find it you say I
 * can't find this color"). One question per thing it couldn't tell, in the Create order panel (a full screen on a
 * phone): their preferred goods first (1st choice, 2nd choice), or type a model number. The colors are checked on the
 * picked blank right after (the shirt color check asks when one isn't exact).
 */
export type GoodsItem = { key: string; called: string; colors: string[]; pcs: number };
export type GoodsPick = { style: string; brand: string; name: string; preferred: boolean; remember: boolean } | null;

export default function GoodsAsk({ items, prefs, company, onDone, onCancel }: { items: GoodsItem[]; prefs: PreferredGood[]; company: string; onDone: (a: Record<string, GoodsPick>) => void; onCancel: () => void }) {
  const [at, setAt] = useState(0), [ans, setAns] = useState<Record<string, GoodsPick>>({});
  const [typing, setTyping] = useState(false), [q, setQ] = useState(""), [busy, setBusy] = useState(false), [found, setFound] = useState<{ style: string; brand: string; name: string } | null>(null), [err, setErr] = useState(""), [remember, setRemember] = useState(false);
  const it = items[at];
  const fits = goodsFor(prefs, it.called);
  const what = it.called || "garment";
  const next = (p: GoodsPick) => {
    const a = { ...ans, [it.key]: p };
    setAns(a); setTyping(false); setQ(""); setFound(null); setErr(""); setRemember(false);
    if (at + 1 < items.length) setAt(at + 1); else onDone(a);
  };
  async function find() {
    const st = q.trim().toUpperCase().replace(/\s+/g, "");
    if (!st) return;
    setBusy(true); setErr(""); setFound(null);
    try {
      const { data } = await createClient().from("garments").select("style, brand, description").ilike("style", st).limit(1);
      const g = (data || [])[0] as { style: string; brand: string; description: string } | undefined;
      if (g) { setFound({ style: g.style, brand: g.brand || "", name: g.description || "" }); return; }
      const r = await fetch(`/api/ss/lookup?style=${encodeURIComponent(st)}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.garment) setFound({ style: j.garment.style, brand: j.garment.brand || "", name: j.garment.description || "" });
      else setErr(j.error || `Couldn't find ${st} at S&S or SanMar. Check the number, or leave it for now.`);
    } finally { setBusy(false); }
  }
  return (
    <div className="ap ga" role="group" aria-label="Which garment">
      {items.length > 1 && <div className="ga-step">{at + 1} of {items.length}</div>}
      <p className="ap-q">The email doesn&apos;t say which {what}.</p>
      <p className="ap-why">{[it.colors.length ? it.colors.join(", ") : "", it.pcs ? `${it.pcs.toLocaleString()} pcs` : ""].filter(Boolean).join(" · ") || "No colors or sizes given either."}</p>
      {!typing && <>
        {fits.length > 0
          ? <p className="ga-say">{company} has {fits.length === 1 ? "a preferred" : "preferred"} {kindOf(it.called) || "garment"}{fits.length === 1 ? "" : "s"} in their Brand standards. Use {fits.length === 1 ? "it" : "one"}?</p>
          : <p className="ga-say">{prefs.length ? `None of ${company}'s preferred goods are for ${what}.` : `${company} has no preferred goods in their Brand standards yet.`} Type the model number.</p>}
        <div className="ga-opts">
          {fits.map((g, i) => (
            <button key={g.id} type="button" className={"ga-opt" + (i === 0 ? " first" : "")} onClick={() => next({ style: g.style, brand: g.brand, name: g.name, preferred: true, remember: false })}>
              <b>{i === 0 ? "Yes, " : ""}{[g.brand, g.style].filter(Boolean).join(" ")}</b>
              <span>{[rankWord(g.rank), g.name, g.colors.length ? `usually ${g.colors.slice(0, 3).join(", ")}` : ""].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
          <button type="button" className="ga-opt other" onClick={() => setTyping(true)}><b>Something else</b><span>Type a model number</span></button>
        </div>
      </>}
      {typing && <div className="ga-type">
        <div className="field"><label htmlFor="ga-q">Model number</label>
          <div className="ga-row"><input id="ga-q" autoFocus value={q} onChange={(e) => { setQ(e.target.value); setFound(null); setErr(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void find(); } }} placeholder="e.g. 6210, 3001CVC, 1717" inputMode="text" autoCapitalize="characters" />
            <button type="button" className="btn" disabled={busy || !q.trim()} onClick={() => void find()}>{busy ? "Finding…" : "Find"}</button></div>
        </div>
        {err && <div className="pv-err">{err}</div>}
        {found && <div className="ga-found">
          <div><b>{[found.brand, found.style].filter(Boolean).join(" ")}</b>{found.name ? <span> · {found.name}</span> : null}</div>
          <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Add to {company}&apos;s preferred goods for {what}</label>
          <button type="button" className="btn primary" onClick={() => next({ ...found, preferred: false, remember })}>Use the {found.style}</button>
        </div>}
        <button type="button" className="ap-link" onClick={() => { setTyping(false); setQ(""); setFound(null); setErr(""); }}>Back</button>
      </div>}
      <div className="ap-foot"><span className="ap-more"><button type="button" className="ap-link ap-cancel" onClick={onCancel}>Cancel</button></span>
        <button type="button" className="btn ghost" onClick={() => next(null)} title="The line stays without a style; it's added to the questions for the customer">Leave it for now</button></div>
    </div>
  );
}
