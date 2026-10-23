"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Group } from "@/lib/pricing";
import { guessHex } from "@/lib/mockup";
import { fixDesignArt, type ArtAction } from "@/lib/artFix";
import { MicButton } from "@/components/SearchInput";
import { aiOrderFix, applyOrderFixChanges, markOrderChecked, noteArtChange, saveOrderLesson } from "@/app/shop/ai-actions";
import type { OrderChange } from "@/lib/ai/orderFix";

/**
 * THE order check after it's made (Oct 23, Nick: "the right panel opens. That never closes until I say, yes, we've got
 * everything right… or no, we got to make these changes… my team should be able to just talk to you… you should learn
 * from it… I don't want my account manager to have to open up Illustrator"). One tool (lib/aiTools.ts "order-review"):
 * the end of Create order, and an order's page.
 *   - what was made: each group's mockup, garments (extras stamped), prints (where, size, height, inks, art changes)
 *   - Check it for me: the AI compares it with what the customer sent and suggests changes
 *   - No, change something: say it (typed or spoken); order changes are made, art fixes drawn on the logo here
 *   - a lesson for this customer, ticked to remember (their next Create order reads it first)
 *   - Yes, it's right: closes. Every correction is kept for the overnight review (lib/ai/orderFix.ts).
 */
type O = { id: string; number: number; nickname: string; customer_id: string | null; groups: Group[]; due_date: string | null; firm?: boolean; customers?: { name?: string; company?: string } | null };
type Result = { reply: string; applied: string[]; art: (OrderChange & { state: "doing" | "done" | "error"; err?: string })[]; suggest: OrderChange[]; lesson?: string; rule?: string };

export default function OrderReview({ orderId, onClose, did }: { orderId: string; onClose: () => void; /** what Create order did, folded */ did?: string[] }) {
  const sb = useRef(createClient()).current;
  const [o, setO] = useState<O | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"look" | "talk">("look");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [pick, setPick] = useState<Record<number, boolean>>({});
  const [lesson, setLesson] = useState({ on: true, text: "" });
  const [stale, setStale] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const { data } = await sb.from("orders").select("id, number, nickname, customer_id, groups, due_date, firm, customers(name, company)").eq("id", orderId).maybeSingle();
    if (data) setO(data as unknown as O);
  }, [sb, orderId]);
  // the mockup is made in another tab: its pictures show here when it's saved
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 6000); const f = () => void load(); window.addEventListener("focus", f); return () => { clearInterval(t); window.removeEventListener("focus", f); }; }, [load]);
  const thumbKey = (o?.groups || []).flatMap((g) => g.mockupThumbs || []).join("|");
  useEffect(() => {
    const ps = thumbKey ? thumbKey.split("|").filter((p) => p && !urls[p]) : [];
    if (!ps.length) return;
    void sb.storage.from("proofs").createSignedUrls(ps, 3600).then(({ data }) => { const m: Record<string, string> = {}; ps.forEach((p, i) => { if (data?.[i]?.signedUrl) m[p] = data[i].signedUrl; }); setUrls((u) => ({ ...u, ...m })); });
  }, [thumbKey, sb]); // eslint-disable-line react-hooks/exhaustive-deps

  const who = o?.customers?.company || o?.customers?.name || "this customer";
  const mockHref = (g: Group) => `/shop/artwork/mockup?order=${orderId}&group=${g.id}${(g.mockupThumbs || []).length ? "" : "&auto=1"}`;

  /** the art fixes, drawn on each logo here, then said on its print */
  async function runArt(art: OrderChange[]) {
    if (!o || !art.length) return;
    const byPrint = new Map<string, OrderChange[]>();
    for (const c of art) byPrint.set(c.id, [...(byPrint.get(c.id) || []), c]);
    for (const [pid, cs] of byPrint) {
      const g = o.groups.find((x) => x.imprints.some((im) => im.id === pid)), im = g?.imprints.find((x) => x.id === pid);
      const mark = (state: "done" | "error", e?: string) => setRes((r) => r && { ...r, art: r.art.map((a) => (a.id === pid ? { ...a, state, err: e } : a)) });
      if (!g || !im?.design_id) { mark("error", "That print has no logo"); continue; }
      const f = await fixDesignArt(sb, im.design_id, cs.map((c) => c.field as ArtAction), { shirt: guessHex(g.lines[0]?.color || ""), widthIn: parseFloat(String(im.size || "")) || undefined, say: cs.map((c) => c.say) });
      if (!f.ok) { mark("error", f.error); continue; }
      for (const c of cs) await noteArtChange(orderId, pid, c.say).catch(() => null);
      mark("done"); setStale(true);
    }
    void load();
  }

  async function ask(m: "review" | "change") {
    if (m === "change" && !text.trim()) { setErr("Say what to change first."); return; }
    setBusy(m === "review" ? "Comparing it with what the customer sent…" : "Making the changes…"); setErr("");
    const r = await aiOrderFix(orderId, m === "change" ? text : "", m);
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    const x = r.r;
    if (m === "review") {
      setRes({ reply: x.reply, applied: [], art: [], suggest: x.changes, lesson: x.lesson, rule: x.rule });
      setPick(Object.fromEntries(x.changes.map((_, i) => [i, true])));
    } else {
      setRes({ reply: x.reply, applied: x.applied, art: x.art.map((a) => ({ ...a, state: "doing" as const })), suggest: [], lesson: x.lesson, rule: x.rule });
      setText("");
      void runArt(x.art);
      void load();
    }
    if (x.lesson) setLesson({ on: true, text: x.lesson });
  }

  async function makeSuggested() {
    if (!res) return;
    const ch = res.suggest.filter((_, i) => pick[i]);
    if (!ch.length) return;
    setBusy("Making the changes…"); setErr("");
    const r = await applyOrderFixChanges(orderId, ch);
    setBusy("");
    if (!r.ok) { setErr(r.error); return; }
    const art = ch.filter((c) => c.what === "art");
    setRes({ ...res, applied: r.applied, art: art.map((a) => ({ ...a, state: "doing" as const })), suggest: [] });
    void runArt(art);
    void load();
  }

  async function done() {
    setBusy("Saving…");
    if (lesson.on && lesson.text.trim()) await saveOrderLesson(orderId, lesson.text).catch(() => null);
    await markOrderChecked(orderId).catch(() => null);
    setBusy("");
    onClose();
  }

  if (!o) return <div className="ap orv"><p className="faint">Opening the order…</p></div>;
  const working = !!res?.art.some((a) => a.state === "doing");
  return (
    <div className="ap orv" role="group" aria-label="Check the order">
      <p className="ap-q">#{o.number} is made. Did I get everything right?</p>
      <p className="ap-why">Look it over. Open the mockup to check the art and where it sits. Nothing goes to the customer.</p>
      {o.groups.map((g) => (
        <section key={g.id} className="orv-g">
          <div className="orv-pics">
            {(g.mockupThumbs || []).filter((p) => urls[p]).slice(0, 2).map((p) => <a key={p} href={mockHref(g)} target="_blank" rel="noreferrer" className="ap-pic big"><img src={urls[p]} alt="The mockup" /></a>)}
            {!(g.mockupThumbs || []).length && <a className="ap-pic big orv-none" href={mockHref(g)} target="_blank" rel="noreferrer"><span>No mockup yet</span></a>}
          </div>
          <div className="orv-d">
            {g.lines.map((l) => (
              <div key={l.id} className="orv-l" data-notranslate>
                <b>{[l.brand, l.style].filter(Boolean).join(" ")}</b> · {l.color || "no color"} · {Object.values(l.sizes || {}).reduce<number>((a, v) => a + (+(v || 0)), 0)} pcs
                {l.extras && <span className="gl-stamp orv-stamp"><span>{l.extrasPrint === false ? "Not printed extras" : "Printed extras"}</span><span>· {l.extrasFree === false ? "charged" : "no charge"}</span></span>}
              </div>
            ))}
            {g.imprints.map((im) => (
              <div key={im.id} className="orv-p" data-notranslate>
                <b>{im.location}</b> · {parseFloat(String(im.size || "")) > 0 ? `${parseFloat(String(im.size))}" wide` : "standard size"} · {im.drop ? `${im.drop}" below the collar` : "normal height"}{im.inks ? ` · ${im.inks}` : ""}{im.underbase ? " + white underbase" : ""}
                {(im.artChanges || []).length > 0 && <ul className="orv-art">{im.artChanges!.map((t, i) => <li key={i}>{t}</li>)}</ul>}
              </div>
            ))}
            <a className="ap-link" href={mockHref(g)} target="_blank" rel="noreferrer">{(g.mockupThumbs || []).length ? "Open the mockup ›" : "Make the mockup ›"}</a>
          </div>
        </section>
      ))}
      {did && did.length > 0 && <details className="orv-did"><summary>What I did ({did.length})</summary><ul>{did.map((x, i) => <li key={i}>{x}</li>)}</ul></details>}

      {res && (
        <div className="orv-res" aria-live="polite">
          {res.reply && <p>{res.reply}</p>}
          {res.applied.length > 0 && <ul className="orv-done">{res.applied.map((t, i) => <li key={i}>{t}</li>)}</ul>}
          {res.art.length > 0 && <ul className="orv-done">{res.art.map((a, i) => <li key={i} className={a.state}>{a.say}{a.state === "doing" ? <span className="faint"> · changing the logo…</span> : a.state === "error" ? <span className="err-t"> · {a.err}</span> : <span className="orv-tag">On the proof</span>}</li>)}</ul>}
          {stale && !working && <p className="faint">The logo changed: <a className="ap-link" href={mockHref(o.groups[0])} target="_blank" rel="noreferrer">open the mockup</a> and save it again so its picture shows it.</p>}
          {res.suggest.length > 0 && <>
            <ul className="orv-sug">{res.suggest.map((c, i) => <li key={i}><label><input type="checkbox" checked={!!pick[i]} onChange={(e) => setPick((p) => ({ ...p, [i]: e.target.checked }))} /> {c.say}{c.what === "art" && <span className="orv-tag">On the proof</span>}</label></li>)}</ul>
            <button type="button" className="btn primary" onClick={() => void makeSuggested()} disabled={!!busy}>Make {Object.values(pick).filter(Boolean).length === 1 ? "this change" : "these changes"}</button>
          </>}
          {res.lesson && <label className="orv-lesson"><input type="checkbox" checked={lesson.on} onChange={(e) => setLesson((l) => ({ ...l, on: e.target.checked }))} /> <span>Remember for {who}:</span><input type="text" value={lesson.text} onChange={(e) => setLesson((l) => ({ ...l, text: e.target.value }))} aria-label="What to remember" /></label>}
          {res.rule && <p className="faint orv-rule">For tonight&apos;s review: {res.rule}</p>}
        </div>
      )}

      {mode === "talk" && (
        <div className="orv-talk">
          <textarea ref={box} rows={3} value={text} onChange={(e) => { setText(e.target.value); setErr(""); }} placeholder="Hudson came back. The black should be solid, and take out the thin white line around the hawk." aria-label="What to change" />
          <div className="orv-talk-b">
            <MicButton target={() => box.current} append label="Say what to change" />
            <button type="button" className="btn primary" onClick={() => void ask("change")} disabled={!!busy}>Make the changes</button>
          </div>
        </div>
      )}
      {busy && <p className="faint" aria-live="polite">{busy}</p>}
      {err && <div className="err">{err}</div>}
      <div className="ap-foot">
        <span className="ap-more"><button type="button" className="ap-link" onClick={onClose}>Close for now</button>{!res && <button type="button" className="ap-link" onClick={() => void ask("review")} disabled={!!busy}>Check it for me</button>}</span>
        {mode === "look" && <button type="button" className="btn" onClick={() => { setMode("talk"); setTimeout(() => box.current?.focus(), 50); }}>No, change something</button>}
        <button type="button" className="btn primary" onClick={() => void done()} disabled={!!busy || working}>Yes, it&apos;s right</button>
      </div>
    </div>
  );
}

/** the order check as its own panel on the right (an order's page: "Check or change it") */
export function OrderReviewPanel({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("fbs:dock", { detail: { open: true } }));
    return () => { window.dispatchEvent(new CustomEvent("fbs:dock", { detail: { open: false } })); };
  }, []);
  return (
    <div className="dla-bg dock wide" role="dialog" aria-label="Check the order">
      <div className="dla qo wide"><OrderReview orderId={orderId} onClose={onClose} /></div>
    </div>
  );
}
