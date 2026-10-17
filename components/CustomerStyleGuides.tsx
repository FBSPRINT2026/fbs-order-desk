"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/components/RoleContext";
import { fmtStamp } from "@/lib/format";

/**
 * Style guides (Oct 16, Nick: "some brands give us style guides… we can just upload them and they should be on the
 * customer's files"). Kept on the customer (customers.style_guides), the files in storage under
 * proofs/brand-guides/<customer>/guides/. Shown on Brand standards; the brand standards AI reads them too.
 * Taking one off archives it (the file stays), with a way to see and bring back taken-off ones.
 */
export type StyleGuide = { id: string; name: string; path: string; type: string; size: number; at: string; by: string; archived?: boolean };

const kb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const isImg = (g: StyleGuide) => /^image\//.test(g.type) || /\.(png|jpe?g|webp|gif)$/i.test(g.name);

export default function CustomerStyleGuides({ customerId }: { customerId: string }) {
  const sb = useMemo(() => createClient(), []);
  const { email } = useRole();
  const [list, setList] = useState<StyleGuide[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [showOff, setShowOff] = useState(false);
  const [armed, setArmed] = useState("");

  useEffect(() => {
    sb.from("customers").select("style_guides").eq("id", customerId).maybeSingle().then(({ data }) => setList(((data?.style_guides || []) as StyleGuide[]).filter((g) => g?.path)));
  }, [sb, customerId]);
  useEffect(() => {
    const need = (list || []).filter((g) => !urls[g.path]).map((g) => g.path);
    if (need.length) sb.storage.from("proofs").createSignedUrls(need, 3600).then(({ data }) => setUrls((u) => ({ ...u, ...Object.fromEntries((data || []).map((r, i) => [need[i], r.signedUrl || ""])) })));
  }, [sb, list]); // eslint-disable-line react-hooks/exhaustive-deps

  // saved fresh each time, so two people adding at once don't drop each other's files
  async function save(change: (cur: StyleGuide[]) => StyleGuide[]) {
    const { data } = await sb.from("customers").select("style_guides").eq("id", customerId).maybeSingle();
    const next = change(((data?.style_guides || []) as StyleGuide[]).filter((g) => g?.path));
    const { error } = await sb.from("customers").update({ style_guides: next }).eq("id", customerId);
    if (error) { setErr("Couldn't save: " + error.message); return false; }
    setList(next); return true;
  }
  async function add(files: File[]) {
    if (!files.length) return;
    setErr("");
    const added: StyleGuide[] = [];
    for (const f of files) {
      setBusy(`Uploading ${f.name}…`);
      const id = crypto.randomUUID(), path = `brand-guides/${customerId}/guides/${Date.now().toString(36)}-${f.name.replace(/[^\w.\-]+/g, "_").slice(-90)}`;
      const { error } = await sb.storage.from("proofs").upload(path, f, { contentType: f.type || undefined });
      if (error) { setErr(`${f.name}: ${error.message}`); continue; }
      added.push({ id, name: f.name, path, type: f.type || "", size: f.size, at: new Date().toISOString(), by: email || "" });
    }
    if (added.length) await save((cur) => [...added, ...cur]);
    setBusy("");
  }
  const setOff = (g: StyleGuide, off: boolean) => save((cur) => cur.map((x) => (x.id === g.id ? { ...x, archived: off || undefined } : x)));

  if (!list) return null;
  const live = list.filter((g) => !g.archived), off = list.filter((g) => g.archived);
  const row = (g: StyleGuide) => (
    <div key={g.id} className={"sg-row" + (g.archived ? " off" : "")}>
      <a className="sg-pic" href={urls[g.path] || undefined} target="_blank" rel="noreferrer" title={`Open ${g.name}`}>
        {isImg(g) && urls[g.path] ? <img src={urls[g.path]} alt="" /> : <span>{(g.name.split(".").pop() || "file").toUpperCase().slice(0, 4)}</span>}
      </a>
      <div className="sg-t">
        <a href={urls[g.path] || undefined} target="_blank" rel="noreferrer">{g.name}</a>
        <small>{kb(g.size)} · added {fmtStamp(g.at)}{g.by ? ` by ${g.by.split("@")[0]}` : ""}</small>
      </div>
      {g.archived
        ? <button type="button" className="btn sm ghost" onClick={() => setOff(g, false)}>Put back</button>
        : armed === g.id
          ? <button type="button" className="btn sm danger" onClick={() => { setArmed(""); setOff(g, true); }}>Take it off?</button>
          : <button type="button" className="btn icon ghost sm" aria-label={`Take ${g.name} off`} title="Take it off (kept, can be put back)" onClick={() => { setArmed(g.id); setTimeout(() => setArmed((x) => (x === g.id ? "" : x)), 3500); }}>✕</button>}
    </div>
  );
  return (
    <div className="sg" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); add(Array.from(e.dataTransfer.files)); }}>
      <div className="sg-h">
        <b>Style guides</b>
        <span className="faint">{live.length ? "Their brand guides and logo usage sheets. The brand standards AI reads them too." : "None yet. Add the brand or style guide they gave us (PDF or pictures), or drop files here."}</span>
        <label className="btn sm sg-add">{busy ? busy : "+ Add style guide"}<input type="file" hidden multiple accept="application/pdf,image/*,.ai,.eps" disabled={!!busy} onChange={(e) => { add(Array.from(e.target.files || []) as File[]); e.target.value = ""; }} /></label>
      </div>
      {err && <div className="err">{err}</div>}
      {live.length > 0 && <div className="sg-list">{live.map(row)}</div>}
      {off.length > 0 && (
        <div className="sg-offw">
          <button type="button" className="linkbtn" onClick={() => setShowOff((x) => !x)}>{showOff ? "Hide" : "Show"} {off.length} taken off</button>
          {showOff && <div className="sg-list">{off.map(row)}</div>}
        </div>
      )}
    </div>
  );
}
