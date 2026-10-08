"use client";
import { useEffect, useState } from "react";
import { lineQty, SIZES, type GLine, type Order, type OrderCalc, type Size } from "@/lib/pricing";

/**
 * Send to Printavo (40,000-series orders, until Nov 2): asks for Printavo's status and the two dates, then makes the
 * quote in Printavo and links it here. Once sent, shows Printavo's number, status and the customer's invoice link.
 */
type Status = { id: string; name: string; color: string; type: "QUOTE" | "INVOICE" };
type Preview = {
  number: number; nickname: string; po: string; customerDue: string; productionDue: string; productionNote: string;
  contact: { id: string; name: string; email: string; company: string } | null; problem: string; statuses: Status[]; defaultStatus: string; total: number;
  files: number; mockups: number; sent: { visualId: string; publicUrl: string; url: string; status: string; at: string } | null;
};
type Sent = { visualId: string; publicUrl: string; url: string; status: string; statusError?: string; numberError?: string; warnings?: string; sentTotal?: number; ourTotal?: number; cardFee?: number };
const money = (n: number) => `$${(+n || 0).toFixed(2)}`;

export function PrintavoLink({ visualId, url, publicUrl, status, number, orderId, onRenumbered }: { visualId: string; url?: string; publicUrl?: string; status?: string; number?: number; orderId?: string; onRenumbered?: (visualId: string) => void }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const off = !!number && !!visualId && visualId !== String(number);
  async function renumber() {
    setBusy(true); setErr("");
    const r = await fetch("/api/printavo/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, action: "renumber" }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy(false);
    if (!r?.ok) return setErr(j.error || "Printavo didn't change the number.");
    onRenumbered?.(j.visualId);
  }
  return (
    <div className="pvs-strip" role="status">
      <span>In Printavo as <b>#{visualId}</b>{status ? <> · {status}</> : null}. Production runs from Printavo; the customer sees Printavo&apos;s invoice.</span>
      <span className="row" style={{ gap: 8 }}>
        {off && orderId && <button type="button" className="btn primary sm" disabled={busy} onClick={renumber}>{busy ? "Changing…" : `Make it #${number} in Printavo`}</button>}
        {url && <a className="btn sm" href={url} target="_blank" rel="noreferrer">Open in Printavo</a>}
        {publicUrl && <button type="button" className="btn sm" onClick={() => navigator.clipboard?.writeText(publicUrl)} title={publicUrl}>Copy customer link</button>}
      </span>
      {err && <div className="err" style={{ flexBasis: "100%" }}>{err}</div>}
    </div>
  );
}

export default function SendToPrintavo({ orderId, onSaved, onSent }: { orderId: string; onSaved: () => Promise<unknown>; onSent: (s: Sent) => void }) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState<Sent | null>(null);
  const [f, setF] = useState({ statusId: "", productionDue: "", customerDue: "", nickname: "", po: "", productionNote: "" });
  useEffect(() => {
    if (!open) return;
    setP(null); setErr(""); setDone(null);
    (async () => {
      await onSaved(); // what's on screen is what goes
      const r = await fetch(`/api/printavo/send?order=${orderId}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(j.error || "Couldn't reach Printavo.");
      setP(j);
      setF({ statusId: j.defaultStatus, productionDue: j.productionDue, customerDue: j.customerDue, nickname: j.nickname, po: j.po, productionNote: j.productionNote });
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  async function send() {
    setBusy(true); setErr("");
    const r = await fetch("/api/printavo/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, ...f }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server. Check Printavo before trying again." };
    setBusy(false);
    if (!r?.ok) return setErr(j.error || "It didn't go through.");
    setDone(j); onSent(j);
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const close = () => { if (!busy) setOpen(false); };
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)} title="Makes this order in Printavo (garments, prints, mockups, files, prices) and links it here">Send to Printavo</button>
      {open && (
        <div className="pp-modal" role="dialog" aria-modal="true" aria-label="Send to Printavo" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="pp-sheet" style={{ maxWidth: 560 }}>
            <div className="pp-sheet-h"><b>Send to Printavo</b><button type="button" className="btn icon ghost" aria-label="Close" onClick={close}>✕</button></div>
            <div className="stack" style={{ padding: 18, gap: 12 }}>
              {!p && !err && <div className="faint">Checking Printavo…</div>}
              {err && <div className="err">{err}</div>}
              {p?.sent && <PrintavoLink visualId={p.sent.visualId} url={p.sent.url} publicUrl={p.sent.publicUrl} status={p.sent.status} />}
              {p?.problem && <div className="err">{p.problem}</div>}
              {done ? (
                <div className="stack" style={{ gap: 10 }}>
                  <div className="pvs-ok">Sent. It&apos;s <b>#{done.visualId}</b> in Printavo{done.status ? <>, set to <b>{done.status}</b></> : null}.</div>
                  {done.statusError && <div className="err">The status didn&apos;t change in Printavo ({done.statusError}). Set it there by hand.</div>}
                  {done.numberError && <div className="err">Printavo kept its own number ({done.numberError}). Use &quot;Make it #{p?.number}&quot; on the order to try again.</div>}
                  {done.warnings && <div className="faint">Printavo noted: {done.warnings}</div>}
                  {done.sentTotal != null && done.ourTotal != null && Math.abs(done.sentTotal - done.ourTotal - (done.cardFee || 0)) > 0.05 && <div className="err">Printavo&apos;s total is {money(done.sentTotal)}; ours is {money(done.ourTotal)} plus the 3% card surcharge ({money(done.cardFee || 0)}). Check the prices in Printavo.</div>}
                  <div className="faint">The &quot;Order confirmation&quot; reply in the Inbox now links to Printavo&apos;s invoice page.</div>
                  <PrintavoLink visualId={done.visualId} url={done.url} publicUrl={done.publicUrl} status={done.status} />
                  <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn" onClick={() => setOpen(false)}>Done</button></div>
                </div>
              ) : p && !p.problem && !p.sent && (
                <>
                  <div className="pvs-who">For <b>{p.contact?.company || "?"}</b>{p.contact?.name ? <> · {p.contact.name}</> : null}{p.contact?.email ? <span className="faint"> · {p.contact.email}</span> : null}</div>
                  <div className="field"><label htmlFor="pvs-st">Status in Printavo</label>
                    <select id="pvs-st" value={f.statusId} onChange={set("statusId")}>
                      {(["QUOTE", "INVOICE"] as const).map((t) => <optgroup key={t} label={t === "QUOTE" ? "Quote" : "Invoice"}>{p.statuses.filter((s) => s.type === t).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
                    </select>
                  </div>
                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                    <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="pvs-pd">Production date (print by)</label><input id="pvs-pd" type="date" value={f.productionDue} onChange={set("productionDue")} /></div>
                    <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="pvs-cd">Customer due date</label><input id="pvs-cd" type="date" value={f.customerDue} onChange={set("customerDue")} /></div>
                  </div>
                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                    <div className="field" style={{ flex: "2 1 220px" }}><label htmlFor="pvs-nn">Nickname in Printavo</label><input id="pvs-nn" value={f.nickname} onChange={set("nickname")} /></div>
                    <div className="field" style={{ flex: "1 1 120px" }}><label htmlFor="pvs-po">PO</label><input id="pvs-po" value={f.po} onChange={set("po")} /></div>
                  </div>
                  <div className="field"><label htmlFor="pvs-note">Production note</label><textarea id="pvs-note" rows={3} value={f.productionNote} onChange={set("productionNote")} /></div>
                  <div className="faint" style={{ fontSize: 12.5 }}>Goes over: garments and sizes, each print with its details, {p.mockups} mockup{p.mockups === 1 ? "" : "s"}, {p.files} production file{p.files === 1 ? "" : "s"} plus the art, setup as New/Repeat Screen Fees, and the 3% card surcharge. Total {money(p.total)}. It gets the same number in Printavo: #{p.number}.</div>
                  <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                    <button type="button" className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
                    <button type="button" className="btn primary" onClick={send} disabled={busy || !f.statusId || !f.productionDue || !f.customerDue}>{busy ? "Sending…" : "Send to Printavo"}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- changes made in Printavo, brought back (40,000-series orders only) ---------- */
type PvSnap = {
  at: string; visualId: string; status: string; total: number;
  groups: { lines: { itemNumber: string; color: string; description: string; sizes: Record<string, number>; price: number; mockups?: number }[] }[];
  fees: { description: string; amount: number; quantity: number | null; unitPrice: number | null; pct: boolean }[];
};
// the fees Send to Printavo makes from our setup (screens, digitizing, PMS, ink changes, minimum, 2XL+)
const SETUP_FEE = /^(new screen fee|repeat screen fee|digitize file|pms match|color change|minimum order charge|sizes above xl)$/i;
const ADJUST = "Setup adjustment (from Printavo)";
// the card surcharge is always worked out in Printavo: taken as it is, without asking
const CARD = /credit card processing surcharge/i;
const norm = (x: string) => (x || "").replace(/\s+/g, " ").trim().toLowerCase();
type Change = { key: string; text: string; apply?: (d: Order) => void };

export function PrintavoChanges({ o, calc, patch }: { o: Order; calc: OrderCalc; patch: (fn: (d: Order) => void) => void }) {
  const st = (o as Order & { printavo_state?: { pv?: PvSnap } | null }).printavo_state;
  const pv = st?.pv;
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [fresh, setFresh] = useState<PvSnap | null>(null);
  const snap = fresh && (!pv || fresh.at > pv.at) ? fresh : pv;
  async function check() {
    setBusy(true); setErr("");
    const r = await fetch("/api/printavo/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: o.id, action: "refresh" }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy(false);
    if (!r?.ok) return setErr(j.error || "Couldn't read the order from Printavo.");
    setFresh(j.pv);
  }
  const changes: Change[] = [];
  const info: string[] = [];
  if (snap) {
    const groups = o.groups || [];
    groups.forEach((g, gi) => {
      const ours = g.lines.filter((l) => lineQty(l) > 0), theirs = snap.groups[gi]?.lines || [];
      ours.forEach((l, li) => {
        const t = theirs[li]; if (!t) return;
        const name = `${[l.style, l.color].filter(Boolean).join(" ")}`;
        const keys = [...new Set([...Object.keys(l.sizes || {}), ...Object.keys(t.sizes)])].filter((z) => (SIZES as readonly string[]).includes(z));
        const diff = keys.filter((z) => (+(l.sizes?.[z as Size] || 0)) !== (+(t.sizes[z] || 0)));
        if (diff.length) changes.push({ key: `q${gi}.${li}`, text: `${name}: ${diff.map((z) => `${z} ${+(l.sizes?.[z as Size] || 0)} → ${+(t.sizes[z] || 0)}`).join(", ")}`,
          apply: (d) => { const x = d.groups[gi].lines.find((y) => y.id === l.id); if (x) x.sizes = Object.fromEntries(keys.filter((z) => +(t.sizes[z] || 0) > 0).map((z) => [z, +t.sizes[z]])) as GLine["sizes"]; } });
        const each = calc.groups[gi]?.lines.find((y) => y.id === l.id)?.each ?? 0;
        if (Math.abs(each - t.price) > 0.005) changes.push({ key: `p${gi}.${li}`, text: `${name}: price $${each.toFixed(2)} → $${t.price.toFixed(2)} each`,
          apply: (d) => { const x = d.groups[gi].lines.find((y) => y.id === l.id); if (x) x.priceOverride = t.price; } });
      });
      theirs.slice(ours.length).forEach((t) => info.push(`New line in Printavo: ${[t.itemNumber, t.color].filter(Boolean).join(" ")} ${Object.entries(t.sizes).map(([z, q]) => `${z} ${q}`).join(", ")} at $${t.price.toFixed(2)}. Add it here by hand.`));
    });
    snap.groups.slice(groups.length).forEach(() => info.push("Printavo has a line item group this order doesn't. Add it here by hand."));
    // fees: the setup ones are compared as a total, the rest one by one
    const pvSetup = snap.fees.filter((f) => SETUP_FEE.test(norm(f.description))).reduce((a, f) => a + f.amount, 0);
    const ourSetup = calc.groups.reduce((a, c) => a + c.setup + c.materials, 0);
    const adj = (o.fees || []).find((f) => f.label === ADJUST);
    const wantAdj = Math.round((pvSetup - ourSetup) * 100) / 100;
    if (Math.abs(wantAdj - (+(adj?.amount || 0))) > 0.005) changes.push({ key: "setup", text: `Setup fees in Printavo $${pvSetup.toFixed(2)}, ours $${ourSetup.toFixed(2)}${adj ? ` (+ $${(+(adj.amount || 0)).toFixed(2)} adjustment)` : ""}`,
      apply: (d) => { d.fees = (d.fees || []).filter((f) => f.label !== ADJUST); if (Math.abs(wantAdj) > 0.005) d.fees.push({ label: ADJUST, amount: wantAdj }); } });
    // their own fees one by one, the card surcharge included (Printavo's amount, so both invoices show the same total)
    const theirFees = snap.fees.filter((f) => !SETUP_FEE.test(norm(f.description)) && !CARD.test(f.description));
    for (const f of theirFees) {
      const mine = (o.fees || []).find((x) => norm(x.label) === norm(f.description));
      if (!mine) changes.push({ key: `f+${f.description}`, text: `New fee in Printavo: ${f.description.trim()} $${f.amount.toFixed(2)}`, apply: (d) => { d.fees = [...(d.fees || []), { label: f.description.trim(), amount: f.amount }]; } });
      else if (Math.abs(+(mine.amount || 0) - f.amount) > 0.005) changes.push({ key: `f=${f.description}`, text: `${f.description.trim()}: $${(+(mine.amount || 0)).toFixed(2)} → $${f.amount.toFixed(2)}`, apply: (d) => { const x = (d.fees || []).find((y) => norm(y.label) === norm(f.description)); if (x) x.amount = f.amount; } });
    }
    for (const mine of (o.fees || []).filter((x) => x.label !== ADJUST && !CARD.test(x.label) && +(x.amount || 0) && !theirFees.some((f) => norm(f.description) === norm(x.label))))
      changes.push({ key: `f-${mine.label}`, text: `Fee removed in Printavo: ${mine.label} $${(+(mine.amount || 0)).toFixed(2)}`, apply: (d) => { d.fees = (d.fees || []).filter((y) => y.label !== mine.label); } });
  }
  const pvCard = snap?.fees.find((f) => CARD.test(f.description));
  const ourCard = (o.fees || []).find((f) => CARD.test(f.label));
  const cardOff = !!snap && (pvCard ? !ourCard || Math.abs(+(ourCard.amount || 0) - pvCard.amount) > 0.005 : !!ourCard);
  useEffect(() => {
    if (!cardOff) return;
    patch((d) => { d.fees = [...(d.fees || []).filter((f) => !CARD.test(f.label)), ...(pvCard ? [{ label: pvCard.description.trim(), amount: pvCard.amount }] : [])]; });
  }, [cardOff, pvCard?.amount]); // eslint-disable-line react-hooks/exhaustive-deps
  // Printavo's invoice page shows the customer only the mockups on the product lines
  const noArt = snap ? snap.groups.flatMap((g) => g.lines).filter((l) => l.mockups === 0).length : 0;
  async function pushArt() {
    setBusy(true); setErr("");
    const r = await fetch("/api/printavo/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: o.id, action: "mockups" }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Couldn't reach the server." };
    setBusy(false);
    if (!r?.ok) return setErr(j.error || "Printavo didn't take the mockup.");
    setFresh(j.pv);
  }
  const applyAll = () => patch((d) => { for (const c of changes) c.apply?.(d); });
  return (
    <div className="pvc">
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <b>{changes.length ? `Changed in Printavo (${changes.length})` : "Matches Printavo"}</b>
        <span className="row" style={{ gap: 8 }}>
          <span className="faint" style={{ fontSize: 12 }}>{snap ? `Checked ${new Date(snap.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · Printavo total $${snap.total.toFixed(2)}` : "Not checked yet"}</span>
          <button type="button" className="btn sm" disabled={busy} onClick={check}>{busy ? "Checking…" : "Check Printavo now"}</button>
          {changes.length > 1 && <button type="button" className="btn primary sm" onClick={applyAll}>Accept all</button>}
        </span>
      </div>
      {err && <div className="err">{err}</div>}
      {noArt > 0 && <div className="pvc-art"><span>{noArt === 1 ? "The product line in Printavo has" : `${noArt} product lines in Printavo have`} no mockup, so the customer can&apos;t see the art on their invoice.</span><button type="button" className="btn primary sm" disabled={busy} onClick={pushArt}>Add our mockup in Printavo</button></div>}
      {changes.length > 0 && <ul className="pvc-list">{changes.map((c) => <li key={c.key}><span>{c.text}</span>{c.apply && <button type="button" className="btn sm" onClick={() => patch((d) => c.apply!(d))}>Accept</button>}</li>)}</ul>}
      {info.length > 0 && <ul className="pvc-info">{info.map((t, i) => <li key={i} className="faint">{t}</li>)}</ul>}
    </div>
  );
}
