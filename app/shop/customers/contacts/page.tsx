"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import BackLink from "@/components/BackLink";
import { contactDetail, contactList, saveContacts, type ContactRow, type ContactState, type Detail, type Person } from "./actions";

/**
 * Update contacts (Nov 3, Nick): every account on the left, biggest first, with whether we have a contact; the picked
 * one on the right as a short form. Blank boxes are filled in from the people found in our mail (shown blue until saved),
 * so most accounts are one look and "Save and next". Saves here only; Printavo isn't touched.
 */
type Show = ContactState | "all";
const LABEL: Record<Show, string> = { missing: "Needs a contact", check: "Check", done: "Done", all: "All" };
const when = (d: string) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "");
const first = (n: string) => n.split(/\s+/)[0];
type Form = { company: string; name: string; email: string; phone: string; address: string };

export default function UpdateContacts() {
  const [show, setShow] = useSticky<Show>("customers.contacts.show", "missing");
  const [who, setWho] = useSticky<string>("customers.contacts.owner", "");
  const [rows, setRows] = useState<ContactRow[] | null>(null), [owners, setOwners] = useState<string[]>([]);
  const [q, setQ] = useState(""), [cur, setCur] = useState(""), [err, setErr] = useState("");
  const [d, setD] = useState<Detail | null>(null), [f, setF] = useState<Form | null>(null), [sug, setSug] = useState<Set<keyof Form>>(new Set());
  const [add, setAdd] = useState<Person[]>([]), [busy, setBusy] = useState(false), [note, setNote] = useState("");

  useEffect(() => { void contactList().then((r) => { if (r.ok) { setRows(r.rows); setOwners(r.owners); } else setErr(r.error); }); }, []);
  const all = rows || [];
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter((r) => (show === "all" || r.state === show) && (!who || first(r.owner).toLowerCase() === first(who).toLowerCase())
      && (!t || `${r.name} ${r.contact} ${r.email}`.toLowerCase().includes(t)));
  }, [all, show, who, q]);
  const count = (s: Show) => all.filter((r) => (s === "all" || r.state === s) && (!who || first(r.owner).toLowerCase() === first(who).toLowerCase())).length;

  // open one: what's on file, then the blanks filled from the best person found
  const open = async (id: string) => {
    setCur(id); setD(null); setF(null); setAdd([]); setNote(""); setErr("");
    const r = await contactDetail(id);
    if (!r.ok) return setErr(r.error);
    const x = r.detail;
    const form: Form = { company: x.company, name: x.name, email: x.email, phone: x.phone, address: x.address };
    const filled = new Set<keyof Form>();
    const best = x.found.find((p) => p.sameCompany) || x.found[0];
    if (best && !form.email && !x.contacts.some((c) => c.email === best.email)) {
      form.email = best.email; filled.add("email");
      if (!form.name) { form.name = best.name; filled.add("name"); }
    }
    setD(x); setF(form); setSug(filled);
  };
  useEffect(() => { if (!cur && list[0]) void open(list[0].id); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof Form, v: string) => { setF((x) => (x ? { ...x, [k]: v } : x)); setSug((s) => { const n = new Set(s); n.delete(k); return n; }); };
  const makeMain = (p: { name: string; email: string }) => { setF((x) => (x ? { ...x, name: p.name, email: p.email } : x)); setSug(new Set()); };
  const next = () => { const i = list.findIndex((r) => r.id === cur); const n = list[i + 1] || list.find((r) => r.id !== cur); if (n) void open(n.id); };
  const save = async () => {
    if (!d || !f) return;
    setBusy(true); setErr("");
    const r = await saveContacts({ id: d.id, ...f, add: add.map((p) => ({ name: p.name, email: p.email })) });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setRows((rs) => (rs || []).map((x) => (x.id === d.id ? { ...x, name: f.company || f.name || x.name, contact: f.name, email: f.email, state: "done", checkedAt: new Date().toISOString() } : x)));
    setNote(`Saved ${f.company || f.name}.`);
    next();
  };

  const onFile = new Set([...(d?.contacts || []).map((c) => c.email), f?.email || ""].filter(Boolean));
  const others = (d?.found || []).filter((p) => !onFile.has(p.email) && !add.some((a) => a.email === p.email));
  const row = all.find((r) => r.id === cur);

  return (
    <>
      <BackLink href="/shop/customers" label="Customers" />
      <div className="page-head">
        <div><h1>Update contacts</h1><div className="eyebrow">Every account, biggest first. Blue boxes were filled in from your email: check them and save.</div></div>
        <div className="row"><Link className="btn" href="/shop/customers/move-list">Move to the portal</Link></div>
      </div>
      {rows && <div className="stats">
        {(["missing", "check", "done"] as Show[]).map((s) => <button key={s} type="button" className="stat" onClick={() => setShow(s)}><span className={"v" + (s === "missing" && count(s) ? " alert" : "")}>{count(s)}</span><span className="k">{LABEL[s]}</span></button>)}
      </div>}
      <div className="toolbar">
        <div className="chips">{(["missing", "check", "done", "all"] as Show[]).map((s) => <button key={s} type="button" className={"chip" + (show === s ? " on" : "")} onClick={() => setShow(s)}>{LABEL[s]}</button>)}</div>
        <div className="chips">
          <button type="button" className={"chip" + (!who ? " on" : "")} onClick={() => setWho("")}>Everyone</button>
          {owners.map((o) => <button key={o} type="button" className={"chip" + (who === o ? " on" : "")} onClick={() => setWho(o)}>{first(o)}&apos;s</button>)}
        </div>
        <input type="search" className="ucx-q" placeholder="Find an account" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err && <div className="err">{err}</div>}
      {note && <div className="ok-note">{note}</div>}
      {rows === null ? <p className="faint">Loading accounts…</p> : (
        <div className="ucx">
          <section className="panel ucx-list">
            <div className="panel-h"><h2>Accounts</h2><span className="faint">{list.length}</span></div>
            <div className="ucx-items">
              {list.map((r) => (
                <button key={r.id} type="button" className={"ucx-i" + (r.id === cur ? " on" : "")} onClick={() => void open(r.id)}>
                  <span className={"ucx-dot " + r.state} aria-hidden />
                  <span className="ucx-it"><b data-notranslate>{r.name}</b><small>{r.state === "missing" ? "No contact" : r.state === "check" ? `${r.email} · never in our mail` : r.contact || r.email}{r.owner ? ` · ${first(r.owner)}` : ""}</small></span>
                  {r.rank > 0 && <span className="ucx-rank">#{r.rank}</span>}
                </button>
              ))}
              {!list.length && <p className="faint" style={{ padding: 12 }}>Nothing here.</p>}
            </div>
          </section>
          <section className="panel ucx-form">
            {!d || !f ? <div className="panel-b faint">{cur ? "Looking through your email…" : "Pick an account."}</div> : (
              <>
                <div className="panel-h"><h2 data-notranslate>{f.company || f.name || "Customer"}</h2><span className="faint">{[d.owner && `Owner ${first(d.owner)}`, d.printavoAs.length && `In Printavo as "${d.printavoAs.join(" / ")}"`, row?.rank && `#${row.rank} by sales`].filter(Boolean).join(" · ")}</span><Link className="pd-link ucx-open" href={`/shop/customers/${d.id}`}>Open customer</Link></div>
                <div className="panel-b">
                  <div className="ucx-sec">Main contact</div>
                  <div className="ucx-g">
                    <div className="field"><label htmlFor="ucx-n">Name</label><input id="ucx-n" className={sug.has("name") ? "ucx-sug" : ""} value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
                    <div className="field"><label htmlFor="ucx-e">Email</label><input id="ucx-e" type="email" className={sug.has("email") ? "ucx-sug" : ""} value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
                    <div className="field"><label htmlFor="ucx-p">Phone</label><input id="ucx-p" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
                    <div className="field"><label htmlFor="ucx-c">Company name on invoices</label><input id="ucx-c" value={f.company} onChange={(e) => set("company", e.target.value)} /></div>
                    <div className="field ucx-wide"><label htmlFor="ucx-a">Billing address</label><textarea id="ucx-a" rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} /></div>
                  </div>
                  {sug.size > 0 && <div className="ucx-hint">Blue was filled in from your email. Change it if it&apos;s not the right person.</div>}

                  {(d.contacts.length > 0 || add.length > 0) && <>
                    <div className="ucx-sec">People on this account</div>
                    {d.contacts.filter((c) => c.email || c.name).map((c) => (
                      <div key={c.id} className="ucx-p"><span className="ucx-pt"><b>{c.name || c.email}</b><small>{[c.email, c.phone].filter(Boolean).join(" · ")}</small></span>
                        {c.email === f.email ? <span className="ucx-main">Main</span> : c.email ? <button type="button" className="btn sm" onClick={() => makeMain(c)}>Make main</button> : null}</div>
                    ))}
                    {add.map((p) => (
                      <div key={p.email} className="ucx-p added"><span className="ucx-pt"><b>{p.name}</b><small>{p.email} · added, saves with the account</small></span><button type="button" className="btn sm ghost" onClick={() => setAdd((a) => a.filter((x) => x.email !== p.email))}>Undo</button></div>
                    ))}
                  </>}

                  <div className="ucx-sec">Found in your email</div>
                  {!others.length ? <p className="faint ucx-none">{d.found.length ? "Everyone found is already on the account." : "Nobody found in the shop's email for this name. Fill it in by hand, or skip it."}</p> : others.map((p) => (
                    <div key={p.email} className={"ucx-p" + (p.sameCompany ? " same" : "")}>
                      <span className="ucx-pt"><b>{p.name}</b><small>{p.email} · {p.n} email{p.n === 1 ? "" : "s"} with {p.boxes.join(", ")} · last {when(p.last)}{p.sameCompany ? " · their company's address" : ""}</small></span>
                      <span className="ucx-pa">
                        <button type="button" className="btn sm" onClick={() => makeMain(p)}>Main contact</button>
                        <button type="button" className="btn sm" onClick={() => setAdd((a) => [...a, p])}>Add</button>
                      </span>
                    </div>
                  ))}

                  <div className="ucx-foot">
                    <button type="button" className="btn" onClick={next}>Skip</button>
                    <span className="faint">Saves here only. Printavo isn&apos;t touched.</span>
                    <span className="spacer" />
                    <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save and next"}</button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
