"use client";
import { useEffect, useState, type ReactNode } from "react";

/**
 * A job's emails and texts in one timeline (Oct 15, Nick, on Printavo invoice 27166: "a shop-side tab that shows the
 * emails and texts that correspond to this order"). Owners only: nothing shows for anyone else. Read only: nothing
 * goes to Printavo or to the customer. Data: /api/jobs/talk.
 */
type Item =
  | { kind: "text"; id: string; date: string; from_me: boolean; who: string; body: string; files: { name: string; type: string; url: string }[]; how: string }
  | { kind: "email"; id: string; date: string; incoming: boolean; from: string; subject: string; text: string; pics?: string[]; src: string };
type Talk = { customer: string; number: string; name: string; items: Item[]; summary: string; approvals: { id: string; what: string }[] };

const day = (s: string) => new Date(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const time = (s: string) => new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export default function JobTalk({ jobRef, printavo, printavoCount = 0 }: { jobRef: string; /** a Printavo job's own messages & approvals (Oct 15, Nick: "add messages and approval to Emails & Texts… call them Printavo Messages") */ printavo?: ReactNode; printavoCount?: number }) {
  const [d, setD] = useState<Talk | null>(null), [no, setNo] = useState(false), [err, setErr] = useState("");
  const [show, setShow] = useState<"all" | "text" | "email" | "pv">("all"), [big, setBig] = useState(""), [open, setOpen] = useState<Record<string, boolean>>({});
  const load = () => fetch(`/api/jobs/talk?ref=${encodeURIComponent(jobRef)}`).then(async (r) => { if (r.status === 403) { setNo(true); return; } const j = await r.json(); if (j.error) setErr(j.error); else setD(j); }).catch((e) => setErr(String(e)));
  useEffect(() => { void load(); }, [jobRef]); // eslint-disable-line react-hooks/exhaustive-deps
  if (no) return null;
  const notThis = async (id: string) => {
    if (!confirm("Take these texts off this job? They'll be filed to another job if one fits.")) return;
    await fetch("/api/jobs/talk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: jobRef, not: id }) });
    setD(null); void load();
  };
  const fromPv = (i: Item) => i.kind === "email" && i.src === "Printavo";
  const all = (d?.items || []).filter((i) => !(printavo && fromPv(i))); // with the Printavo panel, its messages show there
  const items = all.filter((i) => show === "all" || i.kind === show);
  const nT = all.filter((i) => i.kind === "text").length, nE = all.length - nT;
  const ok = new Map((d?.approvals || []).map((a) => [a.id, a.what]));
  let last = "";
  return (
    <section className="panel jt">
      <div className="panel-h"><h2>{printavo ? "Printavo Messages, Emails, & Texts" : "Emails & Texts"}</h2><span className="faint" style={{ fontSize: 12.5 }}>{d ? `everything with ${d.customer} about #${d.number}${d.name ? ` ${d.name}` : ""}` : "Looking through texts and email…"}</span><span className="spacer" /><span className="jt-lock">Shop only · owners</span></div>
      {err && <div className="pv-err">{err}</div>}
      {d && !all.length && !printavoCount && <div className="panel-b faint">No emails or texts found for this job.</div>}
      {d && (all.length > 0 || printavoCount > 0) && <>
        <div className="jt-chips" role="group" aria-label="Show">
          {([["all", "All", all.length], ["text", "Texts", nT], ["email", "Emails", nE], ...(printavo ? [["pv", "Printavo messages", printavoCount] as const] : [])] as const).map(([k, t, n]) => <button key={k} type="button" className={show === k ? "on" : ""} onClick={() => setShow(k as typeof show)} disabled={!n && k !== "all"}>{t} <small>{n}</small></button>)}
        </div>
        {d.summary && show !== "pv" && <div className="jt-ai"><b>✦ What happened</b>{d.summary}</div>}
        {show === "pv" ? <div className="panel-b jt-pv">{printavo}</div> : <div className="panel-b jt-tl">
          {items.map((i, k) => {
            const dd = day(i.date), sep = dd !== last; last = dd;
            const next = items[k + 1];
            return (
              <div key={i.id}>
                {sep && <div className="jt-day">{dd}</div>}
                {i.kind === "email" ? (
                  <button type="button" className={"jt-em" + (open[i.id] ? " open" : "")} onClick={() => setOpen((o) => ({ ...o, [i.id]: !o[i.id] }))}>
                    <span className="jt-ic" aria-hidden>✉</span>
                    <span className="jt-emb"><b>{i.subject || "(no subject)"}</b><span className="faint">{i.incoming ? i.from : `${i.from} (us)`} · {time(i.date)} · {i.src}</span>
                      {open[i.id] ? <span className="jt-emt">{i.text}</span> : <span className="jt-em1">{i.text.replace(/\s+/g, " ").slice(0, 160)}</span>}
                      {i.pics && i.pics.length > 0 && <span className="jt-pics">{i.pics.map((u) => <img key={u} src={u} alt="" onClick={(e) => { e.stopPropagation(); setBig(u); }} />)}</span>}</span>
                  </button>
                ) : (
                  <div className={"jt-tx " + (i.from_me ? "me" : "them")}>
                    {i.files.filter((f) => f.url).length > 0 && <div className="jt-pics">{i.files.filter((f) => f.url).map((f) => /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp)$/i.test(f.name) ? <img key={f.url} src={f.url} alt={f.name} onClick={() => setBig(f.url)} /> : <a key={f.url} href={f.url} target="_blank" rel="noreferrer">{f.name}</a>)}</div>}
                    {i.body && <div className="jt-bb">{i.body}</div>}
                    {(!next || next.kind !== "text" || next.from_me !== i.from_me || day(next.date) !== dd || ok.has(i.id)) && <span className="jt-who">{i.who} · {time(i.date)}{ok.has(i.id) && <span className="jt-ok">✓ Approved {ok.get(i.id)}</span>}</span>}
                    {(!next || next.kind !== "text" || day(next.date) !== dd) && i.how && <span className="jt-why">On this job: {i.how} · <button type="button" className="linkbtn" onClick={() => void notThis(i.id)}>Not this job</button></span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>}
      </>}
      {big && <div className="ctx-big" onClick={() => setBig("")}><img src={big} alt="" /></div>}
    </section>
  );
}
