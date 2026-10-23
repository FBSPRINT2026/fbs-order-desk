"use client";
import { useCallback, useEffect, useState } from "react";
import { decideItem, dropRule, loadReviews, runReviewNow, type Review } from "@/app/shop/ai/review-actions";

/**
 * What went wrong on orders, and the rules to add (Oct 23, Nick: corrections kept, looked at overnight, "here's what went
 * wrong yesterday, and here's the rule I'd add"; you approve it or not). The overnight review lands here (from a to-do
 * on My Day); approved rules are followed by every Create order and order check. Bugs are noted for Claude to fix.
 */
export default function CorrectionsReview() {
  const [data, setData] = useState<{ reviews: Review[]; rules: { id: string; at: string; text: string }[]; waiting: number } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [edit, setEdit] = useState<Record<string, string>>({});
  const load = useCallback(async () => { const r = await loadReviews(); if (r.ok) setData(r); else setErr(r.error); }, []);
  useEffect(() => { void load(); }, [load]);
  const focus = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("id") : null;

  async function decide(id: string, i: number, d: "approved" | "no" | "noted") {
    setBusy(`${id}:${i}`); setErr("");
    const r = await decideItem(id, i, d, edit[`${id}:${i}`]);
    setBusy("");
    if (!r.ok) setErr(r.error); else void load();
  }
  async function runNow() {
    setBusy("run"); setErr("");
    const r = await runReviewNow();
    setBusy("");
    if (!r.ok) setErr(r.error); else void load();
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Corrections review</h1><p className="eyebrow">What staff fixed on orders after they were made, what keeps going wrong, and the rules to add</p></div>
        <div className="row" style={{ gap: 8 }}>
          {data && <span className="faint">{data.waiting} correction{data.waiting === 1 ? "" : "s"} waiting for tonight</span>}
          <button type="button" className="btn" onClick={() => void runNow()} disabled={busy === "run" || !data?.waiting}>{busy === "run" ? "Looking them over…" : "Look them over now"}</button>
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      {!data ? <p className="faint">Loading…</p> : <>
        {data.reviews.length === 0 && <section className="panel"><div className="panel-b"><p className="faint">Nothing yet. When staff change an order after it&apos;s made (the order check), the changes are looked over overnight and show here.</p></div></section>}
        {data.reviews.map((rv) => (
          <section key={rv.id} className={"panel crv" + (focus === rv.id ? " on" : "")}>
            <div className="panel-h"><h2>{new Date(rv.at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</h2><span className="faint">{rv.summary}</span></div>
            <div className="panel-b">
              <ul className="crv-list">
                {rv.items.map((it, i) => (
                  <li key={i} className={"crv-it " + it.kind + (it.state ? " " + it.state : "")}>
                    <span className="crv-k">{it.kind === "rule" ? "Rule to add" : it.kind === "bug" ? "Site bug" : "This customer"}</span>
                    {it.kind === "rule" && !it.state
                      ? <input type="text" aria-label="The rule" value={edit[`${rv.id}:${i}`] ?? it.text} onChange={(e) => setEdit((x) => ({ ...x, [`${rv.id}:${i}`]: e.target.value }))} />
                      : <span className="crv-t">{it.text}</span>}
                    <span className="faint crv-n" data-notranslate>{it.times}× {it.orders.length ? `· #${it.orders.join(", #")}` : ""}</span>
                    <span className="crv-a">
                      {it.state ? <span className="faint">{it.state === "approved" ? "Added to the shop's rules" : it.state === "noted" ? "Noted for Claude to fix" : "Not added"}</span>
                        : it.kind === "rule" ? <><button type="button" className="btn sm" onClick={() => void decide(rv.id, i, "no")} disabled={!!busy}>Not this</button><button type="button" className="btn sm primary" onClick={() => void decide(rv.id, i, "approved")} disabled={!!busy}>Add the rule</button></>
                        : it.kind === "bug" ? <button type="button" className="btn sm" onClick={() => void decide(rv.id, i, "noted")} disabled={!!busy}>Noted</button>
                        : <span className="faint">Only this customer</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
        <section className="panel">
          <div className="panel-h"><h2>The shop&apos;s rules</h2><span className="faint">Followed on every Create order and order check</span></div>
          <div className="panel-b">
            {data.rules.length === 0 ? <p className="faint">None yet.</p> : <ul className="crv-list">{data.rules.map((r) => (
              <li key={r.id} className="crv-it rule"><span className="crv-t">{r.text}</span><span className="faint crv-n">{new Date(r.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                <span className="crv-a"><button type="button" className="btn sm" onClick={async () => { const x = await dropRule(r.id); if (!x.ok) setErr(x.error); else void load(); }}>Take back</button></span></li>
            ))}</ul>}
          </div>
        </section>
      </>}
    </>
  );
}
