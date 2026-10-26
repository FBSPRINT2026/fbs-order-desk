"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSticky } from "@/lib/useSticky";
import BackLink from "@/components/BackLink";
import { ownerList, setOwners, type OwnerRow } from "./actions";

/**
 * Account owners (Oct 26, Nick: "a quick update of who owns each account… take the top 30 accounts and send me a link
 * and I'll put the account owner on there"). The biggest customers of the last 12 months, one click to set who owns each.
 * Printavo's owner on their latest order shows as a hint; "Fill the blanks from Printavo" copies the hints into every
 * customer that has no owner yet.
 */
type Show = "30" | "100" | "blank";
const money0 = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const first = (n: string) => n.split(/\s+/)[0];

export default function AccountOwners() {
  const [show, setShow] = useSticky<Show>("customers.owners.show", "30");
  const [rows, setRows] = useState<OwnerRow[] | null>(null);
  const [owners, setOwnerNames] = useState<string[]>([]);
  const [err, setErr] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState("");

  useEffect(() => {
    setRows(null);
    void ownerList(show === "30" ? 30 : 200).then((r) => { if (r.ok) { setRows(r.rows); setOwnerNames(r.owners); setErr(""); } else setErr(r.error); });
  }, [show]);

  const list = (rows || []).filter((r) => show !== "blank" || !r.owner).slice(0, show === "30" ? 30 : 200);
  const pick = async (r: OwnerRow, owner: string) => {
    const v = r.owner === owner ? "" : owner;
    setBusy(r.id);
    setRows((rs) => (rs || []).map((x) => (x.id === r.id ? { ...x, owner: v } : x)));
    const res = await setOwners([{ id: r.id, owner: v }]);
    setBusy("");
    if (!res.ok) { setErr(res.error); setRows((rs) => (rs || []).map((x) => (x.id === r.id ? { ...x, owner: r.owner } : x))); }
  };
  const blanks = list.filter((r) => !r.owner && r.printavo);
  const fill = async () => {
    const items = blanks.map((r) => ({ id: r.id, owner: owners.find((o) => first(o).toLowerCase() === first(r.printavo).toLowerCase()) || r.printavo }));
    setBusy("all");
    const res = await setOwners(items);
    setBusy("");
    if (!res.ok) return setErr(res.error);
    const m = new Map(items.map((x) => [x.id, x.owner]));
    setRows((rs) => (rs || []).map((x) => (m.has(x.id) ? { ...x, owner: m.get(x.id)! } : x)));
    setNote(`${items.length} owner${items.length === 1 ? "" : "s"} filled in from Printavo.`);
  };
  const count = (o: string) => list.filter((r) => (o ? first(r.owner).toLowerCase() === first(o).toLowerCase() : !r.owner)).length;

  return (
    <>
      <BackLink href="/shop/customers" label="Customers" />
      <div className="page-head">
        <div><h1>Account owners</h1><div className="eyebrow">Your biggest customers of the last 12 months: click who owns each one</div></div>
        <div className="row">{blanks.length > 0 && <button type="button" className="btn" disabled={busy === "all"} onClick={() => void fill()} title="Copies Printavo's owner on their latest order into every customer here with no owner yet">{busy === "all" ? "Filling…" : `Fill ${blanks.length} blank${blanks.length === 1 ? "" : "s"} from Printavo`}</button>}</div>
      </div>
      {rows && <div className="stats">
        {owners.map((o) => <button key={o} type="button" className="stat"><span className="v">{count(o)}</span><span className="k">{first(o)}</span></button>)}
        <button type="button" className="stat" onClick={() => setShow("blank")}><span className={"v" + (count("") ? " alert" : "")}>{count("")}</span><span className="k">No owner yet</span></button>
      </div>}
      <div className="toolbar">
        <div className="chips">
          {([["30", "Top 30"], ["100", "Top 200"], ["blank", "No owner yet"]] as [Show, string][]).map(([k, l]) => <button key={k} type="button" className={"chip" + (show === k ? " on" : "")} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        {note && <span className="faint">{note}</span>}
      </div>
      {err && <div className="err">{err}</div>}
      {rows === null ? <p className="faint">Loading…</p> : !list.length ? <p className="faint">Every customer here has an owner.</p> : (
        <div className="tbl-wrap">
          <table className="tbl ao-tbl">
            <thead><tr><th>#</th><th>Customer</th><th className="num">Last 12 months</th><th>Printavo had</th><th>Account owner</th></tr></thead>
            <tbody>{list.map((r, i) => (
              <tr key={r.id}>
                <td className="faint">{i + 1}</td>
                <td><Link href={`/shop/customers/${r.id}`} data-notranslate>{r.name}</Link><div className="sub">{r.orders} order{r.orders === 1 ? "" : "s"}</div></td>
                <td className="num nowrap">{money0(r.sales)}</td>
                <td className="faint nowrap">{r.printavo ? first(r.printavo) : "—"}</td>
                <td><div className="chips ao-pick" role="group" aria-label={`Owner of ${r.name}`}>
                  {owners.map((o) => <button key={o} type="button" className={"chip" + (first(r.owner).toLowerCase() === first(o).toLowerCase() ? " on" : "")} disabled={busy === r.id} onClick={() => void pick(r, o)}>{first(o)}</button>)}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
