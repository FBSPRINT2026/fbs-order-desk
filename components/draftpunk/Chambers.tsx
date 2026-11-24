"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tiltUrl } from "@/app/draftpunk/actions";
import { F, Win } from "./ui";

type Row = { id: string; name: string; device_id: string; notes: string; kind: "upright" | "chest" };

/**
 * Fermentation chambers: each controlled space with its Inkbird. With the Inkbird's Tuya device id, autopilot reads it
 * every 15 minutes and sets it on each fermentation step; without one, anything that can post JSON (Home Assistant)
 * can log it to the brewer's address.
 */
export default function Chambers({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const load = () => createClient().from("dp_chambers").select("id, name, device_id, notes, kind").eq("owner_id", userId).order("name").then(({ data }) => setRows((data || []) as Row[]));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const up = async (r: Row, patch: Partial<Row>) => { setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, ...patch } : x))); await createClient().from("dp_chambers").update(patch).eq("id", r.id); };
  const add = async () => { if (!name.trim()) return; await createClient().from("dp_chambers").insert({ owner_id: userId, name: name.trim() }); setName(""); load(); };
  const del = async (r: Row) => { if (confirm(`Remove ${r.name}? Its logged temperatures stay.`)) { await createClient().from("dp_chambers").delete().eq("id", r.id); load(); } };
  return (
    <Win title="Fermentation chambers">
      <table className="dp-tbl" data-nofit>
        <thead><tr><th>Chamber</th><th>Kind</th><th>Inkbird device id (Tuya)</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><input value={r.name} onChange={(e) => setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))} onBlur={(e) => up(r, { name: e.target.value })} /></td>
              <td><select value={r.kind || "upright"} onChange={(e) => up(r, { kind: e.target.value as Row["kind"] })}><option value="upright">Upright fridge</option><option value="chest">Chest freezer</option></select></td>
              <td><input value={r.device_id} placeholder="from the Tuya IoT console" onChange={(e) => setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, device_id: e.target.value } : x)))} onBlur={(e) => up(r, { device_id: e.target.value.trim() })} /></td>
              <td className="dp-num"><button className="dp-btn dp-x" aria-label={`Remove ${r.name}`} onClick={() => del(r)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dp-row" style={{ marginTop: 12 }}>
        <F label="New chamber" grow="1 1 220px"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Chamber 1, the keezer…" onKeyDown={(e) => e.key === "Enter" && add()} /></F>
        <button className="dp-btn" onClick={add}>Add chamber</button>
      </div>
      <details style={{ marginTop: 12 }}>
        <summary className="dp-dim" style={{ cursor: "pointer" }}>Log a chamber from Home Assistant or a script instead</summary>
        <p>POST JSON to your address: <code>{"{\"chamber\":\"Chamber 1\",\"temp\":66.2,\"setpoint\":66,\"unit\":\"F\"}"}</code></p>
        {url ? <input readOnly value={url.replace("/tilt?", "/log?")} onFocus={(e) => e.currentTarget.select()} /> : <button className="dp-btn" onClick={() => tiltUrl().then(setUrl)}>Show my address</button>}
      </details>
    </Win>
  );
}
