"use client";
/**
 * Add to customer (Oct 26, Nick: "for everybody's email that we have listed, there should be a button… add to
 * customer… it's basically add a contact automatically to a customer. It pulls up the customer. You enter the name or
 * number if you got it"). One box, used on every email (the Inbox, any folder, a conversation): pick the customer
 * (type to find) or make a new one; their name, email, phone and title, filled in from the email where we can. Saving
 * puts them on the customer's contacts and matches their email to that customer from now on.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import CustomerPick from "@/components/CustomerPick";
import { addSenderToCustomer } from "@/app/shop/mail-actions";

export type Sender = { email: string; name?: string };

/** open the box from anywhere (a toolbar button, a phone's More sheet): the one AddToCustomerHost in the menu shows it */
export function openAddToCustomer(s: Sender) { window.dispatchEvent(new CustomEvent("fbs:add-to-customer", { detail: s })); }

/** mounted once (the shop menu): shows the Add to customer box when a button asks for it */
export function AddToCustomerHost() {
  const [s, setS] = useState<Sender | null>(null);
  useEffect(() => {
    const h = (e: Event) => setS((e as CustomEvent<Sender>).detail);
    window.addEventListener("fbs:add-to-customer", h); return () => window.removeEventListener("fbs:add-to-customer", h);
  }, []);
  return s ? <AddToCustomer key={s.email} sender={s} onClose={() => setS(null)} onDone={(r) => window.dispatchEvent(new CustomEvent("fbs:customer-added", { detail: { ...r, email: s.email } }))} /> : null;
}

export default function AddToCustomer({ sender, onClose, onDone }: { sender: Sender; onClose: () => void; onDone?: (r: { customerId: string; customer: string }) => void }) {
  const [cust, setCust] = useState<{ id: string; label: string } | null>(null), [isNew, setIsNew] = useState(false), [company, setCompany] = useState("");
  const [name, setName] = useState(clean(sender.name || "")), [email, setEmail] = useState(sender.email || ""), [phone, setPhone] = useState(""), [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [done, setDone] = useState<{ customerId: string; customer: string } | null>(null);
  async function save() {
    setBusy(true); setErr("");
    const r = await addSenderToCustomer({ email, name, phone, title, customerId: isNew ? null : cust?.id || null, newCompany: isNew ? company : undefined });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setDone({ customerId: r.customerId, customer: r.customer });
    onDone?.({ customerId: r.customerId, customer: r.customer });
  }
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="atc-back" role="dialog" aria-modal="true" aria-label="Add to customer" onClick={() => !busy && onClose()}>
      <div className="atc-box" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dla-x" aria-label="Close" onClick={onClose}>×</button>
        <h3>Add to customer</h3>
        {done ? <>
          <p className="atc-ok"><b data-notranslate>{name || email}</b> is a contact at <b data-notranslate>{done.customer}</b>. Their email goes to this customer from now on.</p>
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <Link className="btn" href={`/shop/customers/${done.customerId}`}>Open the customer</Link>
            <button type="button" className="btn primary" onClick={onClose}>Done</button>
          </div>
        </> : <>
          <div className="field">
            <label>Customer</label>
            {isNew
              ? <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="New customer's company" aria-label="New customer's company" autoFocus />
              : <CustomerPick field value={cust?.id || null} label={cust?.label} placeholder="Type a customer: company, name or email" onPick={(id, label) => setCust(id ? { id, label } : null)} />}
            <button type="button" className="linkbtn atc-new" onClick={() => { setIsNew(!isNew); setCust(null); }}>{isNew ? "Pick an existing customer instead" : "+ New customer"}</button>
          </div>
          <div className="grid g2 atc-g">
            <div className="field"><label htmlFor="atc-n">Name</label><input id="atc-n" value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" /></div>
            <div className="field"><label htmlFor="atc-e">Email</label><input id="atc-e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field"><label htmlFor="atc-p">Phone</label><input id="atc-p" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="If you have it" /></div>
            <div className="field"><label htmlFor="atc-t">Title</label><input id="atc-t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Buyer, owner, coach…" /></div>
          </div>
          {err && <div className="pv-err">{err}</div>}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy || !email.trim() || (isNew ? !company.trim() : !cust)} onClick={() => void save()}>{busy ? "Adding…" : isNew ? "Make customer" : "Add contact"}</button>
          </div>
        </>}
      </div>
    </div>,
    document.body,
  );
}

/** "Haley-Silber, Kelly" → "Kelly Haley-Silber"; quotes off */
function clean(n: string) {
  const t = n.replace(/["']/g, "").replace(/\s+/g, " ").trim();
  const m = /^([^,@]+),\s*([^,@]+)$/.exec(t);
  return m ? `${m[2].trim()} ${m[1].trim()}` : t.includes("@") ? "" : t;
}
