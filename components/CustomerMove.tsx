"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PAY_TERMS, type Customer, type PayTerms } from "@/lib/pricing";
import CustomerContacts from "@/components/CustomerContacts";

/**
 * Moving a customer to the new system (Nick, Oct 7, 2026): a short checklist filled in once, before their first
 * order here. Each step edits the customer in the new system only; their Printavo customer is never changed, and
 * the link to it stays (Printavo's "Peter Sleiman" can become Cedar Promos here). It can be saved part way and
 * finished later. The last step marks them moved (moved_at / moved_by); their new orders are then 40,000-series.
 */
type Step = "name" | "contacts" | "type" | "pricing" | "address";
const STEPS: { k: Step; title: string; hint: string }[] = [
  { k: "name", title: "Name", hint: "Exactly as it should print on quotes and invoices." },
  { k: "contacts", title: "Contacts", hint: "The main contact, plus anyone else who orders, approves art or pays." },
  { k: "type", title: "Retail or wholesale", hint: "Printavo doesn't record this, so set it here." },
  { k: "pricing", title: "Pricing and terms", hint: "Payment terms, tax exempt, and any special pricing to remember." },
  { k: "address", title: "Addresses and shipping", hint: "Billing and ship-to, and whose carrier account pays." },
];
export type MoveChecklist = Partial<Record<Step, boolean>> & { pricing_note?: string };
type Cust = Customer & { moved_at?: string | null; moved_by?: string; move_checklist?: MoveChecklist };

export const isMoved = (c: { moved_at?: string | null; is_test?: boolean } | null | undefined) => !!c && (!!c.moved_at || !!c.is_test);
/**
 * Should this customer's new order wait for the move checklist? Only once the database has the move fields (a customer
 * row read with select("*") then carries `moved_at`), and never for test accounts. Before that, nothing is blocked.
 */
export const needsMove = (c: Record<string, unknown> | null | undefined) => !!c && "moved_at" in c && !c.moved_at && !c.is_test;

export default function CustomerMove({ customerId, onClose, onMoved }: { customerId: string; onClose: () => void; onMoved?: () => void }) {
  const sb = createClient();
  const [c, setC] = useState<Cust | null>(null);
  const [pv, setPv] = useState<{ name: string; contact: string }[]>([]);
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const [{ data: cu }, { data: links }] = await Promise.all([
        sb.from("customers").select("*").eq("id", customerId).maybeSingle(),
        sb.from("printavo_customers").select("data").eq("customer_id", customerId),
      ]);
      setC(cu as Cust);
      setPv(((links || []) as { data: { companyName?: string; primaryContact?: { fullName?: string; email?: string } } }[]).map((x) => ({ name: x.data?.companyName || "", contact: [x.data?.primaryContact?.fullName, x.data?.primaryContact?.email].filter(Boolean).join(", ") })));
      const done = ((cu as Cust | null)?.move_checklist || {}) as MoveChecklist;
      const first = STEPS.findIndex((s) => !done[s.k]);
      setStep(first < 0 ? STEPS.length - 1 : first);
    })();
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <div className="pp-modal" role="dialog" aria-modal="true"><div className="mv"><p className="faint">Loading…</p></div></div>;
  const list = (c.move_checklist || {}) as MoveChecklist;
  const set = <K extends keyof Cust>(k: K, v: Cust[K]) => setC((x) => (x ? { ...x, [k]: v } : x));
  const s = STEPS[step];

  /** save this step's fields and tick it; `moved` also marks the customer moved */
  async function saveStep(next: number | "moved") {
    if (!c) return;
    setBusy(true); setMsg("");
    const checklist: MoveChecklist = { ...list, [s.k]: true };
    const fields: Record<string, unknown> = {
      company: c.company.trim(), name: c.name.trim(), email: (c.email || "").trim().toLowerCase(), phone: (c.phone || "").trim(),
      price_type: c.price_type || "retail", payment_terms: c.payment_terms || "receipt", tax_exempt: !!c.tax_exempt,
      address: c.address || "", ship_address: c.ship_address || "", ship_bill: c.ship_bill || "fbs", ship_ups_account: c.ship_ups_account || "", ship_fedex_account: c.ship_fedex_account || "", ship_bill_zip: c.ship_bill_zip || "",
      move_checklist: checklist,
    };
    if (next === "moved") {
      const { data: u } = await sb.auth.getUser();
      fields.moved_at = new Date().toISOString();
      fields.moved_by = u.user?.email || "";
    }
    const { error } = await sb.from("customers").update(fields).eq("id", c.id);
    if (error) { setBusy(false); return setMsg(/moved_at|move_checklist|column/i.test(error.message) ? "The database isn't ready for this yet (the SQL script hasn't been run)." : "Couldn't save: " + error.message); }
    // special pricing goes in the shop-only notes too, so it's seen on every order
    if (s.k === "pricing" && (list.pricing_note || "").trim()) {
      const { data: priv } = await sb.from("customer_private").select("notes").eq("customer_id", c.id).maybeSingle();
      const line = `Special pricing: ${(list.pricing_note || "").trim()}`;
      if (!(priv?.notes || "").includes(line)) await sb.from("customer_private").upsert({ customer_id: c.id, notes: [priv?.notes, line].filter(Boolean).join("\n\n") });
    }
    if (next === "moved") await sb.from("activities").insert({ customer_id: c.id, kind: "note", direction: "none", subject: "Moved to the new system", body: `Checklist done; new orders are 40,000-series and go to Printavo by Send to Printavo.`, occurred_at: new Date().toISOString() }).then(() => {});
    setC((x) => (x ? { ...x, move_checklist: checklist, ...(next === "moved" ? { moved_at: fields.moved_at as string } : {}) } : x));
    setBusy(false);
    if (next === "moved") { onMoved?.(); onClose(); } else setStep(next);
  }

  const allDone = STEPS.every((x) => list[x.k] || x.k === s.k);
  return (
    <div className="pp-modal" role="dialog" aria-modal="true" aria-label="Move this customer to the new system" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mv">
        <div className="mv-h">
          <div><div className="eyebrow">Move to the new system</div><h2>{c.company || c.name || "Customer"}</h2></div>
          <button type="button" className="btn icon ghost" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {pv.length > 0 && <div className="mv-pv">In Printavo as <b>{pv.map((x) => x.name || x.contact).filter(Boolean).join(" / ")}</b>. That stays linked; changes here don&apos;t touch Printavo or orders under 40,000.</div>}
        <ol className="mv-steps">{STEPS.map((x, i) => (
          <li key={x.k} className={(i === step ? "on " : "") + (list[x.k] ? "done" : "")}><button type="button" onClick={() => setStep(i)}>{list[x.k] ? "✓ " : ""}{x.title}</button></li>
        ))}</ol>
        <div className="mv-b">
          <p className="faint" style={{ marginTop: 0 }}>{s.hint}</p>
          {s.k === "name" && <div className="stack">
            <div className="field"><label htmlFor="mv-co">Company / organization</label><input id="mv-co" type="text" value={c.company} onChange={(e) => set("company", e.target.value)} /></div>
            <div className="field"><label htmlFor="mv-nm">Main contact name</label><input id="mv-nm" type="text" value={c.name} onChange={(e) => set("name", e.target.value)} /></div>
            <div className="grid g2">
              <div className="field"><label htmlFor="mv-em">Main email</label><input id="mv-em" type="email" value={c.email} onChange={(e) => set("email", e.target.value)} /></div>
              <div className="field"><label htmlFor="mv-ph">Phone</label><input id="mv-ph" type="tel" value={c.phone} onChange={(e) => set("phone", e.target.value)} /></div>
            </div>
          </div>}
          {s.k === "contacts" && <CustomerContacts customerId={c.id} />}
          {s.k === "type" && <div className="mv-choice">
            {(["retail", "wholesale"] as const).map((t) => (
              <label key={t} className={"mv-opt" + ((c.price_type || "retail") === t ? " on" : "")}><input type="radio" name="mv-type" checked={(c.price_type || "retail") === t} onChange={() => set("price_type", t)} />
                <b>{t === "retail" ? "Retail" : "Wholesale"}</b><span>{t === "retail" ? "We supply the garments; retail price list." : "They supply the garments; contract (imprint) pricing."}</span></label>
            ))}
          </div>}
          {s.k === "pricing" && <div className="stack">
            <div className="field"><label htmlFor="mv-terms">Payment terms</label><select id="mv-terms" value={c.payment_terms || "receipt"} onChange={(e) => set("payment_terms", e.target.value as PayTerms)}>{(Object.keys(PAY_TERMS) as PayTerms[]).map((k) => <option key={k} value={k}>{PAY_TERMS[k]}</option>)}</select></div>
            <label className="check"><input type="checkbox" checked={!!c.tax_exempt} onChange={(e) => set("tax_exempt", e.target.checked)} /> Tax exempt</label>
            <div className="field"><label htmlFor="mv-sp">Special pricing (optional)</label><textarea id="mv-sp" rows={3} placeholder="e.g. $1 off per piece on reorders over 144; no screen charges on repeat art" value={list.pricing_note || ""} onChange={(e) => set("move_checklist", { ...list, pricing_note: e.target.value })} /><small className="faint">Saved to the shop-only notes on the customer.</small></div>
          </div>}
          {s.k === "address" && <div className="stack">
            <div className="grid g2">
              <div className="field"><label htmlFor="mv-ad">Billing address</label><textarea id="mv-ad" rows={3} value={c.address} onChange={(e) => set("address", e.target.value)} /></div>
              <div className="field"><label htmlFor="mv-sh">Ship-to (if different)</label><textarea id="mv-sh" rows={3} value={c.ship_address || ""} onChange={(e) => set("ship_address", e.target.value)} /></div>
            </div>
            <div className="field"><label htmlFor="mv-sb">Shipping is billed to</label><select id="mv-sb" value={c.ship_bill || "fbs"} onChange={(e) => set("ship_bill", e.target.value as Customer["ship_bill"])}><option value="fbs">Our account (with markup)</option><option value="ups">Their UPS account</option><option value="fedex">Their FedEx account</option></select></div>
            {c.ship_bill === "ups" && <div className="field"><label htmlFor="mv-ups">Their UPS account #</label><input id="mv-ups" type="text" value={c.ship_ups_account || ""} onChange={(e) => set("ship_ups_account", e.target.value)} /></div>}
            {c.ship_bill === "fedex" && <div className="field"><label htmlFor="mv-fx">Their FedEx account #</label><input id="mv-fx" type="text" value={c.ship_fedex_account || ""} onChange={(e) => set("ship_fedex_account", e.target.value)} /></div>}
          </div>}
        </div>
        {msg && <div className="err">{msg}</div>}
        <div className="mv-f">
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Finish later</button>
          <span className="spacer" />
          {step > 0 && <button type="button" className="btn" disabled={busy} onClick={() => setStep(step - 1)}>Back</button>}
          {step < STEPS.length - 1
            ? <button type="button" className="btn primary" disabled={busy} onClick={() => saveStep(step + 1)}>{busy ? "Saving…" : "Looks right, next"}</button>
            : <button type="button" className="btn primary" disabled={busy || !allDone} title={allDone ? undefined : "Check every step first"} onClick={() => saveStep("moved")}>{busy ? "Saving…" : "Mark as moved"}</button>}
        </div>
      </div>
    </div>
  );
}

/** The warning at the top of an order (or the Inbox) for a customer who hasn't moved: the order waits until they have. */
export function NotMovedBanner({ customerId, name, onMoved, what = "this order" }: { customerId: string; name: string; onMoved: () => void; what?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mv-warn" role="alert">
      <div><b>{name || "This customer"} isn&apos;t in the new system yet.</b> Move them over before working on {what}: a short checklist to get their name, contacts, pricing and addresses right.</div>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>Move them now</button>
      {open && <CustomerMove customerId={customerId} onClose={() => setOpen(false)} onMoved={onMoved} />}
    </div>
  );
}
