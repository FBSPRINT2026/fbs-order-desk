"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buildRecipe, type Proposal } from "@/lib/draftpunk/proposal";
import { createRecipe, myEquipment } from "@/lib/draftpunk/recipeStore";
import { STYLE_GROUPS, styleLabel } from "@/lib/draftpunk/styles";
import Assistant from "./Assistant";
import { useToast } from "./Shell";
import { F, Win } from "./ui";

/** the assistant on its own: designing a new beer (its recipe made on the brewer's own equipment with one tap) */
export default function AssistantPage({ userId, brewerName }: { userId: string; brewerName: string }) {
  const router = useRouter();
  const { toast, node } = useToast();
  const [styleId, setStyleId] = useState("");
  const [goal, setGoal] = useState<"house" | "competition">("competition");
  const make = async (p: Proposal) => {
    const r = buildRecipe({ ...p, styleId: p.styleId || styleId || undefined }, await myEquipment(userId), {}, brewerName);
    const res = await createRecipe(userId, [{ data: r, note: "From the assistant" }], { goal });
    if (res.id) router.push(`/draftpunk/r/${res.id}`); else toast(res.error || "Not saved");
  };
  return (
    <>
      <h1 className="dp-h1">Assistant</h1>
      <Win title="Design a beer" note="knows the styles, what wins, and how your beers have scored">
        <div className="dp-row" style={{ marginBottom: 10 }}>
          <F label="Style (optional)" grow="2 1 260px">
            <select value={styleId} onChange={(e) => setStyleId(e.target.value)}>
              <option value="">Say it in the question</option>
              {STYLE_GROUPS.map((g) => <optgroup key={g.key} label={g.label}>{g.styles.map((s) => <option key={s.id} value={s.id}>{styleLabel(s)}</option>)}</optgroup>)}
            </select>
          </F>
          <span className="dp-seg" role="group" aria-label="Brewed for">
            <button type="button" className={goal === "competition" ? "on" : ""} onClick={() => setGoal("competition")}>Competition</button>
            <button type="button" className={goal === "house" ? "on" : ""} onClick={() => setGoal("house")}>House beer</button>
          </span>
        </div>
        <Assistant styleId={styleId || undefined} goal={goal} onApply={make} applyLabel="Make this a recipe"
          prompts={["I'm doing an Oktoberfest (Märzen) for competition", "A West Coast IPA that scores 40+", "What adjunct would help my Witbier's body?"]} />
      </Win>
      {node}
    </>
  );
}
