"use client";
import { useEffect, useMemo, useState } from "react";
import { billView, sendBillNow, type BillView } from "@/app/shop/bill-actions";
import { money } from "@/lib/format";

/**
 * Send a bill (Nick, Nov 16 2026: "when we finalize an invoice… send them a bill… individual bills or grouped… not
 * everybody's going into the portal every day"). ONE tool, a panel on the right: from the customer's page (Send a bill,
 * and the Payments area in place of Email statement) and the order page's Send (that invoice picked). Everything owed /
 * Ready to pay / Pick invoices, who it goes to, an optional note, and one reminder 7 days on. The email's Pay button opens
 * their portal with exactly those invoices picked (lib/bills.ts).
 */
type Pick = "all" | "ready" | "pick";

export default function SendBillTool({ customerId, orderIds, onClose, onSent }: { customerId: string; /** start with just these invoices (the order page) */ orderIds?: string[]; onClose: () => void; onSent?: () => void }) {
  const [v, setV] = useState<BillView | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<Pick>(orderIds?.length ? "pick" : "ready");
  const [sel, setSel] = useState<string[]>(orderIds || []);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [remind, setRemind] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  /** some picked invoices aren't done yet: ask before the bill opens them to be paid now */
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    let live = true;
    billView(customerId).then((r) => {
      if (!live) return;
      if (!r.ok) { setErr(r.error); return; }
      setV(r.v); setTo(r.v.to.join(", "));
      // nothing given: start on what's ready to pay (everything owed when nothing is ready yet)
      if (!orderIds?.length) { const ready = r.v.invoices.filter((o) => o.ready); setMode(ready.length ? "ready" : "all"); setSel((ready.length ? ready : r.v.invoices).map((o) => o.id)); }
    }, (e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const inv = v?.invoices || [];
  const sum = (ids: string[]) => inv.filter((o) => ids.includes(o.id)).reduce((a, o) => a + o.balance, 0);
  const allIds = inv.map((o) => o.id), readyIds = inv.filter((o) => o.ready).map((o) => o.id);
  const choose = (m: Pick) => { setMode(m); if (m === "all") setSel(allIds); else if (m === "ready") setSel(readyIds); };
  const toggle = (id: string) => { setMode("pick"); setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); };
  const picked = useMemo(() => inv.filter((o) => sel.includes(o.id)), [inv, sel]);
  const total = picked.reduce((a, o) => a + o.balance, 0);

  const early = picked.filter((o) => !o.ready);
  async function send() {
    setAsk(false); setBusy(true); setErr("");
    const r = await sendBillNow(customerId, { orderIds: sel, to: to.split(/[,;\s]+/).filter(Boolean), note, remind }).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setDone(`Bill sent to ${r.sent.join(", ")}: ${money(r.total)} for ${r.count} invoice${r.count === 1 ? "" : "s"}.${remind ? " They'll get one reminder in 7 days if it's still open." : ""}`);
    onSent?.();
  }

  return (
    <div className="dla-bg dock" role="dialog" aria-label="Send a bill">
      <div className="dla sbl">
        <div className="sbl-head">
          <div><h2>Send a bill</h2><div className="faint">{v ? `${v.name}${v.terms ? ` · terms: ${v.terms}` : ""}` : "Loading…"}</div></div>
          <button type="button" className="btn ghost sbl-x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        {done ? (
          <div className="sbl-done"><p>{done}</p><button type="button" className="btn primary" onClick={onClose}>Done</button></div>
        ) : !v ? (err ? <p className="err">{err}</p> : <p className="faint">Loading their open invoices…</p>) : !inv.length ? (
          <div className="sbl-done"><p>{v.name} doesn&apos;t owe anything right now.</p><button type="button" className="btn" onClick={onClose}>Close</button></div>
        ) : <>
          <div className="sbl-seg" role="group" aria-label="What to bill">
            <button type="button" className={mode === "all" ? "on" : ""} aria-pressed={mode === "all"} onClick={() => choose("all")}>Everything owed<b>{money(sum(allIds))}</b></button>
            <button type="button" className={mode === "ready" ? "on" : ""} aria-pressed={mode === "ready"} disabled={!readyIds.length} onClick={() => choose("ready")}>Ready to pay<b>{readyIds.length ? money(sum(readyIds)) : "None yet"}</b></button>
            <button type="button" className={mode === "pick" ? "on" : ""} aria-pressed={mode === "pick"} onClick={() => setMode("pick")}>Pick invoices<b>{mode === "pick" ? `${sel.length} picked` : "—"}</b></button>
          </div>
          <div className="sbl-list">
            {inv.map((o) => (
              <label key={o.id} className={"sbl-it" + (o.ready ? "" : " later")}>
                <input type="checkbox" checked={sel.includes(o.id)} onChange={() => toggle(o.id)} />
                <span><b>#{o.number}</b> {o.nickname}{o.po_number ? <span className="faint"> · PO {o.po_number}</span> : null}<small>{o.ready ? (o.paid > 0.004 ? `Ready to pay · ${money(o.paid)} paid so far` : "Ready to pay") : "Still being made: billing it lets them pay now"}</small></span>
                <b className="nowrap">{money(o.balance)}</b>
              </label>
            ))}
          </div>
          <div className="sbl-tot"><span>{picked.length} invoice{picked.length === 1 ? "" : "s"}</span><b>{money(total)}</b></div>
          <div className="field"><label htmlFor="sbl-to">To</label><input id="sbl-to" type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="their billing email" list="sbl-people" />
            <datalist id="sbl-people">{v.people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}</datalist>
            <small className="faint">Whoever at {v.name} gets invoices. Separate several with commas.</small></div>
          <div className="field"><label htmlFor="sbl-note">A note (optional)</label><textarea id="sbl-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Thanks for the business! Here's everything ready to pay." /></div>
          <label className="check"><input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} /> Remind them in 7 days if it&apos;s still unpaid</label>
          {v.recent.length > 0 && <div className="faint sbl-last">Last bill: {v.recent[0].when}, {money(+v.recent[0].total)} to {v.recent[0].sent_to.join(", ")}</div>}
          {err && <p className="err">{err}</p>}
          {ask ? (
            /* not done yet (Nick, Nov 19 2026): the bill lets them pay it now, whatever their terms say */
            <div className="sbl-ask" role="alertdialog" aria-label="Let them pay before it's done?">
              <b>{early.length === 1 ? `#${early[0].number} isn't done yet` : `${early.length} of these aren't done yet`}</b>
              <p>{early.length === 1 ? `${early[0].nickname || "This order"} is still being made.` : early.map((o) => `#${o.number}`).join(", ") + " are still being made."} {v.terms ? `Their terms are ${v.terms.toLowerCase()}, so ` : "So "}they couldn&apos;t pay {early.length === 1 ? "it" : "them"} online until {early.length === 1 ? "it's" : "they're"} ready. Send the bill and let them pay now?</p>
              <div className="sbl-acts">
                <button type="button" className="btn" onClick={() => setAsk(false)}>Go back</button>
                <button type="button" className="btn primary" onClick={() => void send()}>Yes, let them pay now</button>
              </div>
            </div>
          ) : (
          <div className="sbl-acts">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => (early.length ? setAsk(true) : void send())} disabled={busy || !picked.length || !to.trim()}>{busy ? "Sending…" : `Send bill · ${money(total)}`}</button>
          </div>
          )}
        </>}
      </div>
    </div>
  );
}
