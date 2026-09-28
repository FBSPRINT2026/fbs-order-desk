"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Contact = { id: string; name: string; email: string; phone: string; title: string; is_primary: boolean; portal_access: boolean; printavo_id: string | null };

/**
 * Everyone at this customer. One company, many contacts: each can sign in to the company's portal with their email
 * (unless portal access is off) and sees all of the company's orders.
 */
export default function CustomerContacts({ customerId }: { customerId: string }) {
  const sb = createClient();
  const [list, setList] = useState<Contact[] | null>(null);
  const [state, setState] = useState("");
  const load = useCallback(async () => {
    const { data } = await sb.from("customer_contacts").select("id, name, email, phone, title, is_primary, portal_access, printavo_id").eq("customer_id", customerId).order("is_primary", { ascending: false }).order("name");
    setList((data || []) as Contact[]);
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const save = async (id: string, patch: Partial<Contact>) => {
    setList((xs) => (xs || []).map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await sb.from("customer_contacts").update(patch.email !== undefined ? { ...patch, email: patch.email.trim().toLowerCase() } : patch).eq("id", id);
    setState(error ? "Couldn't save: " + error.message : "Saved");
  };
  if (!list) return null;
  return (
    <div className="cc">
      <div className="cc-h"><span className="lbl">Contacts ({list.length})</span><span className="faint" style={{ fontSize: 12 }}>{state || "Each can sign in to this customer's portal with their email"}</span></div>
      {list.map((c) => (
        <div key={c.id} className="cc-row">
          <input type="text" aria-label="Name" placeholder="Name" value={c.name} onChange={(e) => save(c.id, { name: e.target.value })} />
          <input type="email" aria-label="Email" placeholder="Email" value={c.email} onChange={(e) => save(c.id, { email: e.target.value })} />
          <input type="tel" aria-label="Phone" placeholder="Phone" value={c.phone} onChange={(e) => save(c.id, { phone: e.target.value })} />
          <label className="check" title="Can sign in to the portal"><input type="checkbox" checked={c.portal_access} onChange={(e) => save(c.id, { portal_access: e.target.checked })} /> Portal</label>
          {c.is_primary ? <span className="cc-tag">Main</span> : <button type="button" className="btn icon ghost sm" aria-label="Remove contact" title="Remove contact" onClick={async () => { await sb.from("customer_contacts").delete().eq("id", c.id); load(); }}>✕</button>}
        </div>
      ))}
      <button type="button" className="btn sm" onClick={async () => { const { error } = await sb.from("customer_contacts").insert({ customer_id: customerId }); if (error) setState(error.message); load(); }}>+ Add contact</button>
    </div>
  );
}
