"use client";
import { useState } from "react";
import { setStationPin } from "./actions";

export default function StationPin({ has }: { has: boolean }) {
  const [pin, setPin] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg("");
    const r = await setStationPin(pin.trim());
    setBusy(false); setMsg(r.ok ? "Saved. Shop computers sign in with it now." : r.error || "Couldn't save.");
    if (r.ok) setPin("");
  }
  return (
    <form className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }} onSubmit={save}>
      <label className="fld" style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="faint" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{has ? "New PIN" : "PIN"}</span>
        <input className="input" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="4 to 8 numbers" style={{ width: 170 }} /></label>
      <button type="submit" className="btn primary" disabled={busy || pin.length < 4}>{busy ? "Saving…" : has ? "Change PIN" : "Set PIN"}</button>
      {msg && <span className="faint">{msg}</span>}
    </form>
  );
}
