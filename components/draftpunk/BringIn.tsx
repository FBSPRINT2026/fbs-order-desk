"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { r1 } from "@/lib/draftpunk/calc";
import { createRecipe, saveVersion } from "@/lib/draftpunk/recipeStore";
import type { Recipe } from "@/lib/draftpunk/types";
import { groupKey } from "@/lib/draftpunk/versions";
import { F, Win } from "./ui";

/**
 * A BeerSmith recipe into DraftPunk (Nick, Nov 24 2026: "bring in each recipe into the new system… Witstanbul… the real
 * version made for my three different brew systems, 3, 5 and 10 gallon"): as a new recipe, or as the next version of
 * one already here. The version keeps its own equipment and batch, so each brew system's real version sits in the
 * recipe and brewing on that system uses it. The BeerSmith copy remembers where it went.
 */
export default function BringIn({ archiveId, r, folder, date, userId, onDone }: { archiveId: string; r: Recipe; folder: string; date?: string | null; userId: string; onDone: () => void }) {
  const router = useRouter();
  const [mine, setMine] = useState<{ id: string; name: string }[]>([]);
  const [how, setHow] = useState<"new" | "version">("new");
  const [name, setName] = useState(r.name);
  const [into, setInto] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    createClient().from("dp_recipes").select("id, name").eq("owner_id", userId).order("name").then(({ data }) => {
      const list = (data || []) as { id: string; name: string }[];
      setMine(list);
      // a recipe of the same name is most likely where it goes (Witstanbul for "Witstanbul (NHC 2022)")
      const match = list.find((x) => groupKey(x.name) === groupKey(r.name));
      if (match) { setHow("version"); setInto(match.id); }
    });
  }, [userId, r.name]);
  const label = `${r.name}${folder ? ` · ${folder}` : ""} · ${r1(r.equipment.batchGal, 2)} gal ${r.equipment.name}`;
  const go = async () => {
    setBusy(true); setErr("");
    let id = into;
    if (how === "new") {
      const res = await createRecipe(userId, [{ data: { ...r, name: name.trim() || r.name, imported: r.imported || r.equipment }, date: date || undefined, note: note || `From BeerSmith: ${label}` }]);
      if (!res.id) { setErr(res.error || "Not saved"); setBusy(false); return; }
      id = res.id;
    } else {
      if (!into) { setErr("Pick the recipe it's a version of"); setBusy(false); return; }
      const target = mine.find((m) => m.id === into);
      const res = await saveVersion(into, userId, { ...r, name: target?.name || r.name, imported: r.imported || r.equipment }, note || `From BeerSmith: ${label}`);
      if (!res.version) { setErr(res.error || "Not saved"); setBusy(false); return; }
    }
    await createClient().from("dp_archive").update({ brought_to: id }).eq("id", archiveId);
    onDone();
    router.push(`/draftpunk/r/${id}`);
  };
  return (
    <Win title="Bring into DraftPunk" note={`${r1(r.equipment.batchGal, 2)} gal · ${r.equipment.name}`}>
      <span className="dp-seg" role="group" aria-label="How">
        <button type="button" className={how === "new" ? "on" : ""} onClick={() => setHow("new")}>As a new recipe</button>
        <button type="button" className={how === "version" ? "on" : ""} onClick={() => setHow("version")}>As a version of…</button>
      </span>
      <div className="dp-row" style={{ marginTop: 12 }}>
        {how === "new"
          ? <F label="Name" grow="2 1 240px"><input value={name} onChange={(e) => setName(e.target.value)} /></F>
          : <F label="Version of" grow="2 1 240px"><select value={into} onChange={(e) => setInto(e.target.value)}><option value="">Pick a recipe…</option>{mine.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></F>}
        <F label="Note" grow="2 1 240px"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={`From BeerSmith: ${r.name}`} /></F>
        <button className="dp-btn dp-go" disabled={busy} onClick={go}>{busy ? "Bringing it in…" : "Bring it in"}</button>
      </div>
      <p className="dp-dim" style={{ marginBottom: 0 }}>It keeps its own equipment and batch size: bring in each brew system&apos;s real version (3, 5, 10 gal) and the recipe holds all of them.</p>
      {err && <p className="dp-red">{err}</p>}
    </Win>
  );
}
