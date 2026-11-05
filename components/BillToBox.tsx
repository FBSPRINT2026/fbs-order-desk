"use client";
import { useEffect, useState } from "react";
import { billDepartments } from "@/app/shop/orders/bill-actions";
import { billKey, cleanBill, type BillTo } from "@/lib/billTo";

/**
 * Bill to on the order, under the customer (Nov 5, Nick: "override master billing for a one-off invoice"): the account's
 * billing, or one of its departments for this order only. The departments are the ones past orders were billed to, so
 * one typed once is offered next time. The quote / invoice, its emails and QuickBooks follow (lib/billTo.ts).
 */
const EMPTY: BillTo = { dept: "", attn: "", email: "", cc: "", address: "" };

export default function BillToBox({ customerId, accountName, value, onChange, disabled, open, setOpen }: {
  customerId: string; accountName: string; value: BillTo | null; onChange: (b: BillTo | null) => void; disabled?: boolean;
  /** opened from the customer's line ("▸ Change billing", beside "Address, email, notes") */ open: boolean; setOpen: (v: boolean) => void;
}) {
  const [form, setForm] = useState<BillTo>(EMPTY), [err, setErr] = useState("");
  const [deps, setDeps] = useState<{ b: BillTo; n: number }[] | null>(null);
  useEffect(() => { if (open && customerId) void billDepartments(customerId).then(setDeps).catch(() => setDeps([])); }, [open, customerId]);
  useEffect(() => { setDeps(null); }, [customerId]);
  // each opening starts from what the order bills now
  useEffect(() => { if (open) { setForm(value ? { ...EMPTY, ...value } : EMPTY); setErr(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const use = (b: BillTo | null) => { onChange(b); setOpen(false); };
  const save = () => {
    const b = cleanBill(form);
    if (!b) return setErr("Enter the department.");
    if (b.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(b.email)) return setErr("That invoice email doesn't look right.");
    use(b);
  };
  const set = (k: keyof BillTo) => (e: { target: { value: string } }) => { setErr(""); setForm((f) => ({ ...f, [k]: e.target.value })); };
  const cur = value ? billKey(value) : "";
  return (
    <div className="btx">
      {value && <div className="btx-row">
        <div className="btx-who">
          <span className="btx-k">Bill to</span>
          {value ? <>
            <b>{value.dept}</b><span className="btx-tag">This order only</span>
            <div className="btx-sub">{[value.attn && `Attn: ${value.attn}`, value.email, value.cc && `Cost center ${value.cc}`].filter(Boolean).join(" · ")}</div>
            {value.address && <div className="btx-sub">{value.address}</div>}
          </> : null}
        </div>
        <div className="btx-acts"><button type="button" className="linkbtn" disabled={disabled} onClick={() => use(null)}>Back to account billing</button></div>
      </div>}
      {open && (
        <div className="btx-pick">
          <div className="btx-list">
            <button type="button" className={`btx-dep${!value ? " on" : ""}`} onClick={() => use(null)}><b>Account billing</b><span>{accountName}</span></button>
            {(deps || []).map(({ b, n }) => (
              <button type="button" key={billKey(b)} className={`btx-dep${cur === billKey(b) ? " on" : ""}`} onClick={() => use(b)}>
                <b>{b.dept}</b><span>{[b.attn, b.cc && `CC ${b.cc}`, `${n} order${n === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
            {deps === null && <div className="btx-sub">Loading departments…</div>}
          </div>
          <div className="btx-k btx-new">{value ? "Edit this department" : "New department"}</div>
          <div className="btx-f">
            <div className="field"><label htmlFor="btx-d">Department</label><input id="btx-d" type="text" value={form.dept} onChange={set("dept")} placeholder="Marketing" autoFocus /></div>
            <div className="field"><label htmlFor="btx-a">Attn / contact</label><input id="btx-a" type="text" value={form.attn || ""} onChange={set("attn")} /></div>
            <div className="field"><label htmlFor="btx-e">Invoice email</label><input id="btx-e" type="email" value={form.email || ""} onChange={set("email")} placeholder="name@company.com" /></div>
            <div className="field"><label htmlFor="btx-c">Cost center / GL</label><input id="btx-c" type="text" value={form.cc || ""} onChange={set("cc")} /></div>
            <div className="field btx-wide"><label htmlFor="btx-ad">Billing address (blank = the account's)</label><input id="btx-ad" type="text" value={form.address || ""} onChange={set("address")} /></div>
          </div>
          {err && <div className="err">{err}</div>}
          <div className="row btx-end"><button type="button" className="btn sm" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn primary sm" onClick={save}>Bill this order to {form.dept.trim() || "the department"}</button></div>
        </div>
      )}
    </div>
  );
}
