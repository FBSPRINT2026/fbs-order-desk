"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ArtGate } from "@/lib/artGate";

/**
 * Request Separations for an order, with the art check in front of it (lib/artGate.ts): the order approved, the proofs
 * approved, and each screen-print location's art saved. When it's open, one click sends every location's art to the
 * Separation Center; when it isn't, it says what's holding it up. Used in the production calendar's job panel, on the
 * order page, and by the Mockup Creator's button (same API).
 */
const STAGE: Record<string, { label: string; c: string }> = { working: { label: "Working", c: "#0A8FC0" }, printed: { label: "Films printed", c: "#2E9D5B" }, archived: { label: "Archived", c: "#7C8799" } };
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }) : "");

export function useArtGate(orderId: string) {
  const [gate, setGate] = useState<ArtGate | null>(null), [err, setErr] = useState("");
  const load = useCallback(async () => {
    const r = await fetch(`/api/separations/request?order=${orderId}`, { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline" };
    if (!r?.ok) setErr(j.error || "Couldn't check the art."); else { setErr(""); setGate(j.gate); }
  }, [orderId]);
  useEffect(() => { load(); }, [load]);
  return { gate, setGate, err, load };
}

export default function SepRequest({ orderId, onChange }: { orderId: string; onChange?: () => void }) {
  const { gate, setGate, err, load } = useArtGate(orderId);
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, setAsking] = useState(false), [note, setNote] = useState("");

  async function post(body: Record<string, unknown>, what: string) {
    setBusy(what); setMsg(null);
    const r = await fetch("/api/separations/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: orderId, ...body }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Offline. Try again." };
    setBusy("");
    if (j.gate) setGate(j.gate);
    if (!r?.ok) { setMsg({ ok: false, text: j.error || "Couldn't do that." }); return null; }
    onChange?.();
    return j;
  }
  async function request(only?: string[]) {
    const j = await post(only ? { only } : {}, only ? only[0] : "all");
    if (j?.ok) setMsg({ ok: true, text: `Sent ${j.made} location${j.made === 1 ? "" : "s"} to the Separation Center.${j.skipped?.length ? ` Not sent: ${j.skipped.join("; ")}` : ""}` });
  }

  if (err) return <div className="srq"><div className="pv-err">{err} <button type="button" className="linkbtn" onClick={load}>Try again</button></div></div>;
  if (!gate) return <div className="srq"><span className="faint">Checking the art…</span></div>;
  const g = gate;
  return (
    <div className="srq">
      {g.ok ? (
        <div className="srq-ok">✓ Art approved{g.approved ? (g.approved.via === "proof" ? ` by ${g.approved.by}${g.approved.at ? ` on ${day(g.approved.at)}` : ""}` : ` (${g.approved.by}: “${g.approved.note}”)`) : ""}</div>
      ) : (
        <div className="srq-block" role="status">
          <b>Not ready for separations</b>
          <ul>{g.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {!g.approved && !g.reasons.some((r) => /quote|no screen-print/i.test(r)) && (asking ? (
            <div className="srq-ask">
              <label>How did the customer approve the art?<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Amanda approved the proof by phone, Oct 6" autoFocus /></label>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn sm primary" disabled={note.trim().length < 4 || !!busy} onClick={async () => { const j = await post({ approve: { note } }, "approve"); if (j) { setAsking(false); setNote(""); } }}>{busy === "approve" ? "Saving…" : "Mark Art Approved"}</button>
                <button type="button" className="btn sm ghost" onClick={() => setAsking(false)}>Cancel</button>
              </div>
              <small className="faint">Saved on the order with your name. A new proof sent after this needs approving again.</small>
            </div>
          ) : <button type="button" className="linkbtn" onClick={() => setAsking(true)}>Customer approved it another way?</button>)}
        </div>
      )}
      {g.items.length > 0 && (
        <ul className="srq-l">{g.items.map((x) => {
          const st = x.sep ? STAGE[x.sep.stage] : null;
          return (
            <li key={x.imprintId}>
              <span className="srq-what"><b>{x.location}</b><small>{[x.colors ? `${x.colors} color${x.colors === 1 ? "" : "s"}` : "", x.design, x.garments.join(", ")].filter(Boolean).join(" · ")}</small>{!x.sep && x.problem && <small className="srq-prob">{x.problem}</small>}</span>
              {x.sep ? <><span className="pill" style={{ ["--sc" as string]: st!.c }}>S-{x.sep.number} · {st!.label}</span><Link className="btn sm" href={`/shop/separations/${x.sep.id}`}>Open</Link></>
                : g.ok && !x.problem ? <button type="button" className="btn sm" disabled={!!busy} onClick={() => request([x.imprintId])}>{busy === x.imprintId ? "Sending…" : "Request"}</button> : null}
            </li>
          );
        })}</ul>
      )}
      {msg && <div className={msg.ok ? "srq-msg ok" : "pv-err"} role="status">{msg.text}</div>}
      {g.ok && g.ready > 0 && <button type="button" className="btn primary srq-go" disabled={!!busy} onClick={() => request()}>{busy === "all" ? "Sending…" : `Request Separations${g.ready > 1 ? ` (${g.ready})` : ""}`}</button>}
      {g.ok && g.ready === 0 && g.items.length > 0 && g.items.every((x) => x.sep) && <div className="faint srq-done">Every location is in the Separation Center.</div>}
    </div>
  );
}
