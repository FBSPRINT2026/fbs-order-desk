"use client";
import { useEffect, useRef, useState } from "react";
import { allocateOldest, applyPay, describePay, hasFilter, parsePay, type PayFilter, type PayOrderLite } from "@/lib/paySelect";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const KEY = "fbs-quickpay-recent";
const SUGGEST = ["Everything due", "Past due", "Completed orders", "Last month", "Under $100"];

/**
 * "What do you want to pay?": type it the way you'd say it ("all of August", "everything under $100",
 * "the Brewery jobs") or tap a suggestion; the matching orders get checked, ready to pay together.
 * Common phrasings are understood right away; anything else is read by Claude.
 */
export default function QuickPay({ open, onSelect, ask, onPayAmount, initial }: {
  /** run this request right away (e.g. from the dashboard helper: "all of August") */
  initial?: string;
  open: PayOrderLite[];
  onSelect: (ids: string[]) => void;
  /** "pay an amount": pay these (oldest first; the last one partly) */
  onPayAmount?: (parts: { id: string; amount: number }[], amount: number) => void;
  ask?: (text: string) => Promise<{ ok: boolean; error?: string; filter?: PayFilter; explain?: string; off?: boolean }>;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; why: string; n: number; sum: number; ai?: boolean } | null>(null);
  const [err, setErr] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [amt, setAmt] = useState("");
  const owed = open.reduce((a, o) => a + o.balance, 0);
  const amtN = Math.round((+amt.replace(/[$,\s]/g, "") || 0) * 100) / 100;
  const parts = amtN >= 1 ? allocateOldest(open, Math.min(amtN, owed)) : [];
  const partial = parts.find((p) => p.amount < p.item.balance - 0.004);
  useEffect(() => { try { setRecent(JSON.parse(localStorage.getItem(KEY) || "[]").slice(0, 4)); } catch { /* private window */ } }, []);
  const ran = useRef(false);
  useEffect(() => { if (initial && !ran.current && open.length) { ran.current = true; setQ(initial); run(initial); } }, [initial, open.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const remember = (s: string) => { const r = [s, ...recent.filter((x) => x.toLowerCase() !== s.toLowerCase())].slice(0, 4); setRecent(r); try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* ignore */ } };

  const pick = (f: PayFilter, text: string, why: string, ai = false) => {
    const hit = applyPay(f, open);
    onSelect(hit.map((o) => o.id));
    setResult({ text, why, n: hit.length, sum: hit.reduce((a, o) => a + o.balance, 0), ai });
    if (hit.length) remember(text);
  };

  async function run(text: string) {
    const s = text.trim();
    if (!s) return;
    setErr(""); setResult(null);
    const { filter, rest } = parsePay(s);
    // understood it all here: done
    if (!rest.length && (hasFilter(filter) || /everything|all/i.test(s))) return pick(filter, s, describePay(filter));
    if (ask) {
      setBusy(true);
      const r = await ask(s);
      setBusy(false);
      if (r.ok && r.filter) return pick(r.filter, s, r.explain || describePay(r.filter), true);
      if (!r.off) { setErr(r.error || "I couldn't work that out."); return; }
    }
    // no AI: treat the words it didn't know as words in the job name
    const f2 = { ...filter, text: [...(filter.text || []), ...rest] };
    pick(f2, s, describePay(f2));
  }

  return (
    <div className="qp">
      <form className="qp-row" onSubmit={(e) => { e.preventDefault(); run(q); }}>
        <label htmlFor="qp-in" className="qp-l">What do you want to pay?</label>
        <div className="qp-in">
          <span aria-hidden="true">✨</span>
          <input type="text" id="qp-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. all orders in August · everything under $100 · the Brewery jobs · past due" autoComplete="off" />
          <button type="submit" className="btn primary" disabled={busy || !q.trim()}>{busy ? "Finding…" : "Select"}</button>
        </div>
      </form>
      <div className="qp-chips">
        {[...recent.filter((r) => !SUGGEST.some((s) => s.toLowerCase() === r.toLowerCase())), ...SUGGEST].slice(0, 7).map((s, i) => (
          <button key={s} type="button" className={"qp-chip" + (i < recent.length && !SUGGEST.includes(s) ? " recent" : "")} onClick={() => { setQ(s); run(s === "Everything due" ? "everything" : s); }}>{s}</button>
        ))}
      </div>
      {onPayAmount && open.length > 0 && (
        <div className="qp-amt">
          <label htmlFor="qp-amt">Or pay an amount</label>
          <div className="qp-amt-in"><span>$</span><input type="text" id="qp-amt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="5,000" /></div>
          {parts.length > 0 ? (
            <>
              <span className="qp-amt-say">{amtN > owed + 0.004 ? `That's more than you owe; we'll use ${money(owed)}. ` : ""}Pays {parts.length - (partial ? 1 : 0)} of your oldest order{parts.length - (partial ? 1 : 0) === 1 ? "" : "s"} in full{partial ? ` and ${money(partial.amount)} toward #${partial.item.number}` : ""}.</span>
              <button type="button" className="btn primary sm" onClick={() => onPayAmount(parts.map((p) => ({ id: p.item.id, amount: p.amount })), Math.min(amtN, owed))}>Pay {money(Math.min(amtN, owed))}</button>
            </>
          ) : <span className="qp-amt-say faint">Goes to your oldest orders first.</span>}
        </div>
      )}
      {result && (
        <div className={"qp-res" + (result.n ? "" : " none")} role="status">
          {result.n ? <><b>{result.n} order{result.n === 1 ? "" : "s"} selected · {money(result.sum)}</b><span>{result.why}{result.ai ? " (read by AI; check the list)" : ""}</span></>
            : <><b>No open orders match</b><span>{result.why}. Try different words, or pick orders in the list below.</span></>}
          {result.n > 0 && <button type="button" className="btn sm ghost" onClick={() => { onSelect([]); setResult(null); }}>Clear</button>}
        </div>
      )}
      {err && <div className="qp-res none" role="alert"><b>Hmm</b><span>{err}</span></div>}
    </div>
  );
}
