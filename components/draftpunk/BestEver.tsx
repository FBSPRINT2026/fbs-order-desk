"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildRecipe, type Proposal } from "@/lib/draftpunk/proposal";
import { createRecipe, myEquipment } from "@/lib/draftpunk/recipeStore";
import { STYLE_GROUPS, styleById, styleLabel } from "@/lib/draftpunk/styles";
import { ProposalView } from "./Assistant";
import { useToast } from "./Shell";
import { F, Win } from "./ui";

type Bfe = { answer: string; proposal: Proposal };
const KINDS = [["competition", "Competition"], ["house", "House"]] as const;

/**
 * Best-ever recipes (Nick, Nov 24 2026): for every style, the club's reference competition recipe and house recipe,
 * written by the assistant from what wins and the club's own results, kept for every member. Make one yours and it
 * becomes a recipe on your equipment, v1.
 */
export default function BestEver({ userId, brewerName }: { userId: string; brewerName: string }) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [styleId, setStyleId] = useState("");
  const [have, setHave] = useState<Set<string>>(new Set());
  const [docs, setDocs] = useState<Partial<Record<string, Bfe>>>({});
  const [busy, setBusy] = useState("");
  useEffect(() => { createClient().from("dp_bfe").select("style_id, kind").then(({ data }) => setHave(new Set((data || []).map((d) => `${d.style_id}|${d.kind}`)))); }, []);
  useEffect(() => {
    if (!styleId) return;
    createClient().from("dp_bfe").select("kind, data").eq("style_id", styleId).then(({ data }) => setDocs(Object.fromEntries((data || []).map((d) => [d.kind as string, d.data as Bfe]))));
  }, [styleId]);
  const write = async (kind: string, refresh = false) => {
    setBusy(kind);
    const res = await fetch("/api/draftpunk/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "bfe", styleId, kind, refresh }) });
    const j = await res.json();
    setBusy("");
    if (!res.ok) { toast(j.error || "Couldn't write it"); return; }
    setDocs((d) => ({ ...d, [kind]: j })); setHave((h) => new Set([...h, `${styleId}|${kind}`]));
  };
  const make = async (b: Bfe, kind: string) => {
    const r = buildRecipe(b.proposal, await myEquipment(userId), {}, brewerName);
    const res = await createRecipe(userId, [{ data: { ...r, name: r.name || `Best-ever ${styleById(styleId)?.name}` }, note: `From the club's best-ever ${kind} recipe` }], { goal: kind });
    if (res.id) router.push(`/draftpunk/r/${res.id}`); else toast(res.error || "Not saved");
  };
  return (
    <>
      <h1 className="dp-h1">Best ever</h1>
      <Win title="Pick a style" note={`${have.size} written so far`}>
        <F label="Style">
          <select value={styleId} onChange={(e) => setStyleId(e.target.value)}>
            <option value="">Choose…</option>
            {STYLE_GROUPS.map((g) => <optgroup key={g.key} label={g.label}>{g.styles.map((s) => <option key={s.id} value={s.id}>{styleLabel(s)}{have.has(`${s.id}|competition`) ? " ★" : ""}</option>)}</optgroup>)}
          </select>
        </F>
        <p className="dp-dim" style={{ marginBottom: 0 }}>Written by the assistant from the style, what wins and the club&apos;s own results. ★ has a competition recipe.</p>
      </Win>
      {styleId && KINDS.map(([k, label]) => {
        const b = docs[k];
        return (
          <Win key={k} title={`${label} recipe`} note={styleById(styleId)?.name}>
            {b ? (
              <>
                <p style={{ whiteSpace: "pre-wrap" }}>{b.answer}</p>
                <ProposalView p={b.proposal} />
                <p className="dp-row"><button className="dp-btn dp-go" onClick={() => make(b, k)}>Make it my recipe</button><button className="dp-btn" disabled={!!busy} onClick={() => write(k, true)}>{busy === k ? "Writing…" : "Write it again"}</button></p>
              </>
            ) : (
              <p className="dp-row" style={{ margin: 0 }}><button className="dp-btn dp-go" disabled={!!busy} onClick={() => write(k)}>{busy === k ? "Writing… (about a minute)" : `Write the ${label.toLowerCase()} recipe`}</button></p>
            )}
          </Win>
        );
      })}
      {node}
    </>
  );
}
