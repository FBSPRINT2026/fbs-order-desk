"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtPhone } from "@/lib/phone";
import { claimContactEmail } from "@/app/shop/mail-actions";
import { sendPortalEmailTo } from "@/app/shop/customers/contacts/actions";

type Contact = { id: string; name: string; email: string; phone: string; title: string; is_primary: boolean; portal_access: boolean; printavo_id: string | null };

/**
 * Everyone at this customer. One company, many contacts: each can sign in to the company's portal with their email
 * (unless portal access is off) and sees all of the company's orders. A contact's email, once typed in, is this
 * customer's: their emails come here (Oct 26: support@effinggear.com kept going to Effing Gear). Removing a contact
 * takes them off the list (kept on file, never erased).
 */
export default function CustomerContacts({ customerId }: { customerId: string }) {
  const sb = createClient();
  const [list, setList] = useState<Contact[] | null>(null);
  const [state, setState] = useState("");
  // who's had the portal's "It's here" email, and sending it to one person (Nov 5, Nick)
  const [sentTo, setSentTo] = useState<Record<string, string>>({});
  const [sending, setSending] = useState("");
  const sendOne = async (c: Contact) => {
    setSending(c.id); setState("");
    const r = await sendPortalEmailTo(c.id);
    setSending("");
    if (!r.ok) return setState(r.error);
    setState(r.already ? `${c.name || c.email} already had the portal email.` : `Portal email sent to ${c.email}.`);
    load();
  };
  const load = useCallback(async () => {
    const { data } = await sb.from("customer_contacts").select("id, name, email, phone, title, is_primary, portal_access, printavo_id").eq("customer_id", customerId).is("removed_at", null).order("is_primary", { ascending: false }).order("name");
    setList((data || []) as Contact[]);
    const { data: sends } = await sb.from("launch_email_sends").select("email, sent_at").eq("customer_id", customerId).eq("ok", true);
    setSentTo(Object.fromEntries(((sends || []) as { email: string; sent_at: string }[]).map((x) => [x.email.toLowerCase(), x.sent_at])));
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const save = async (id: string, patch: Partial<Contact>) => {
    setList((xs) => (xs || []).map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await sb.from("customer_contacts").update(patch.email !== undefined ? { ...patch, email: patch.email.trim().toLowerCase() } : patch).eq("id", id);
    setState(error ? "Couldn't save: " + error.message : "Saved");
  };
  if (!list) return null;
  return (
    <div className="ccx">
      <div className="ccx-h"><span className="lbl">Contacts ({list.length})</span><span className="faint" style={{ fontSize: 12 }}>{state || "Each can sign in to this customer's portal with their email"}</span></div>
      {list.map((c) => (
        <div key={c.id} className="ccx-row">
          <input type="text" aria-label="Name" placeholder="Name" value={c.name} onChange={(e) => save(c.id, { name: e.target.value })} />
          <input type="email" aria-label="Email" placeholder="Email" value={c.email} onChange={(e) => save(c.id, { email: e.target.value })} onBlur={async (e) => { const v = e.target.value.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return; const r = await claimContactEmail(customerId, v); if (r.ok && r.moved) setState(`Saved. ${r.moved} email${r.moved === 1 ? "" : "s"} from ${v} moved to this customer.`); }} />
          <input type="tel" aria-label="Phone" placeholder="Phone" value={c.phone} onChange={(e) => save(c.id, { phone: e.target.value })} onBlur={(e) => { const f = fmtPhone(e.target.value); if (f !== e.target.value) save(c.id, { phone: f }); }} />
          {/* the portal switch, its email and remove stay together at the row's end, and wrap under the fields as a group
              when the panel is narrow (Nov 12, Nick: "this is cutting off") */}
          <span className="ccx-act">
          <label className="check" title="Can sign in to the portal"><input type="checkbox" checked={c.portal_access} onChange={(e) => save(c.id, { portal_access: e.target.checked })} /> Portal</label>
          {c.portal_access && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email) && (sentTo[c.email.toLowerCase()]
            ? <span className="ccx-sent" title="The portal's It's here email went to them">Emailed {new Date(sentTo[c.email.toLowerCase()]).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            : <button type="button" className="btn sm" disabled={sending === c.id} title="Send them the portal's It's here email: how to sign in" onClick={() => void sendOne(c)}>{sending === c.id ? "Sending…" : "Send portal email"}</button>)}
          {c.is_primary ? <span className="ccx-tag">Main</span> : <button type="button" className="btn icon ghost sm" aria-label="Remove contact" title="Remove contact" onClick={async () => { const { data: { user } } = await sb.auth.getUser(); await sb.from("customer_contacts").update({ removed_at: new Date().toISOString(), removed_by: user?.email || "staff" }).eq("id", c.id); load(); }}>✕</button>}
          </span>
        </div>
      ))}
      <button type="button" className="btn sm" onClick={async () => { const { error } = await sb.from("customer_contacts").insert({ customer_id: customerId }); if (error) setState(error.message); load(); }}>+ Add contact</button>
    </div>
  );
}
