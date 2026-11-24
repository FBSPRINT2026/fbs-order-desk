"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { atSize, fromPercents, r1, scaleRecipe, sgFmt } from "@/lib/draftpunk/calc";
import { fmtDate, normalize } from "@/lib/draftpunk/defaults";
import { applySubs, planLabel, quickNums, shoppingList, shoppingText, starterDay, subText, type BrewPlan, type ShelfItem, type Sub } from "@/lib/draftpunk/brewPlan";
import { versionsOf, type Version } from "@/lib/draftpunk/recipeStore";
import type { Equipment, Recipe } from "@/lib/draftpunk/types";
import { Win } from "./ui";

type PastBrew = { id: string; brewed_on: string; version_id: string | null; status: string; plan: BrewPlan; tasting: { rating?: number } };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const nextDow = (dow: number) => { const d = new Date(); d.setDate(d.getDate() + (((dow - d.getDay() + 7) % 7) || 7)); return d; };
const dayName = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Brew it (Nick, Nov 24 2026): "hey, what are you making? I'm gonna make the 3 gallon batch… any minor substitutions…
 * version one sub A… when are you gonna make it, today, Friday… I gotta go to the store". Picks the day, the size, the
 * version (or a past brew's substitutions to make again) and any swaps for this brew, then shows the shopping list
 * against the shelf. Brewing today opens the brew log; another day saves a planned brew. Every way to start a brew
 * opens this (the overview's Brew it, the toolbar, Brew day's Start a brew log).
 */
export default function BrewIt({ recipeId, userId, r, equip, shelf, gal0, when0, onClose, onChangeFirst }: { recipeId: string; userId: string; r: Recipe; equip: { e: Equipment }[]; shelf: ShelfItem[]; gal0?: number; when0?: string; onClose: () => void;
  /** "Make changes first": the recipe opens for editing; saved as the next version, this planner comes back with it */ onChangeFirst: (when: string, gal: number) => void }) {
  const router = useRouter();
  const sys = equip.find((q) => q.e.name === r.equipment.name && q.e.sizes?.length) || equip.find((q) => q.e.sizes?.length);
  const today = iso(new Date());
  const [when, setWhen] = useState(when0 && when0 >= today ? when0 : today);
  const [gal, setGal] = useState(gal0 ?? r.equipment.batchGal);
  const [vers, setVers] = useState<Version[]>([]);
  const [past, setPast] = useState<PastBrew[]>([]);
  const [base, setBase] = useState("");
  const [subs, setSubs] = useState<Sub[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const [vs, { data: bs }] = await Promise.all([versionsOf(recipeId), createClient().from("dp_brews").select("id, brewed_on, version_id, status, plan, tasting").eq("recipe_id", recipeId).order("brewed_on")]);
      setVers(vs); setPast((bs || []) as PastBrew[]);
      setBase(vs.length ? `v:${vs[vs.length - 1].id}` : "");
    })();
  }, [recipeId]);

  const last = vers[vers.length - 1];
  const subBrews = past.filter((b) => b.plan?.subs?.length);
  const picked = base.startsWith("v:") ? vers.find((v) => `v:${v.id}` === base) : base.startsWith("b:") ? vers.find((v) => v.id === past.find((b) => `b:${b.id}` === base)?.version_id) : undefined;
  // a past brew's substitutions come with it, to make again
  const pickBase = (k: string) => { setBase(k); const b = past.find((x) => `b:${x.id}` === k); setSubs(b?.plan?.subs ? structuredClone(b.plan.subs) : []); };

  const scaled = useMemo(() => {
    const src = !picked ? r : normalize(picked.data);
    if (!sys) return src;
    if (src.equipment.name === sys.e.name && Math.abs(src.equipment.batchGal - gal) < 0.05) return src;
    return scaleRecipe(src, atSize(sys.e, gal));
  }, [base, picked, r, sys, gal]);
  const final = useMemo(() => fromPercents(applySubs(scaled, subs, shelf)), [scaled, subs, shelf]);
  const n0 = useMemo(() => quickNums(scaled), [scaled]), n1 = useMemo(() => quickNums(final), [final]);
  const shop = useMemo(() => shoppingList(final, shelf), [final, shelf]);
  const sizeLabel = sys?.e.sizes?.find((s) => Math.abs(s.batchGal - gal) < 0.05)?.label || `${r1(gal, 2)} gal`;
  const verNum = picked?.num;
  const label = planLabel(verNum, subs, subBrews.filter((b) => b.version_id === picked?.id).length);
  const starter = starterDay(final, when);

  const go = async () => {
    setBusy(true); setMsg("");
    const versionId = picked?.id || null, num = verNum;
    const plan: BrewPlan = { label: planLabel(num, subs, subBrews.filter((b) => b.version_id === versionId).length), versionNum: num, sizeLabel, subs, base: { ...scaled, name: r.name } };
    const now = when <= today;
    const { data, error } = await createClient().from("dp_brews").insert({ owner_id: userId, recipe_id: recipeId, version_id: versionId, brewed_on: now ? today : when, status: now ? "brewed" : "planned", plan, recipe_snapshot: { ...final, name: r.name }, measured: {}, notes: "" }).select("id").single();
    setBusy(false);
    if (error || !data) { setMsg(error?.message || "Couldn't save the brew"); return; }
    router.push(`/draftpunk/brews/${data.id}`);
  };
  const share = async () => {
    const text = shoppingText(r.name, dayName(when), shop);
    try { if (navigator.share) { await navigator.share({ title: `${r.name} shopping list`, text }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(text); setMsg("Shopping list copied"); } catch { setMsg(text); }
  };

  const fri = iso(nextDow(5)), sat = iso(nextDow(6)), tom = iso(new Date(Date.now() + 86400000));
  const days: [string, string][] = [[today, "Today"], [tom, "Tomorrow"], ...([[fri, dayName(fri)], [sat, dayName(sat)]] as [string, string][]).filter(([d]) => d !== tom)];
  return (
    <Win title="Brew it" note="what are you making?" className="dp-bi">
      <div className="dp-bi-sec">
        <div className="dp-bi-l">When</div>
        <div className="dp-row" style={{ gap: 8 }}>
          <span className="dp-seg">{days.map(([d, l]) => <button key={d} type="button" className={when === d ? "on" : ""} onClick={() => setWhen(d)}>{l}</button>)}</span>
          <input type="date" value={when} min={today} onChange={(e) => setWhen(e.target.value || today)} aria-label="Brew day" />
        </div>
      </div>
      {sys?.e.sizes && (
        <div className="dp-bi-sec">
          <div className="dp-bi-l">Size</div>
          <span className="dp-seg">{sys.e.sizes.map((s) => <button key={s.label} type="button" className={Math.abs(gal - s.batchGal) < 0.05 ? "on" : ""} onClick={() => setGal(s.batchGal)}>{s.label}</button>)}</span>
        </div>
      )}
      <div className="dp-bi-sec">
        <div className="dp-bi-l">Version</div>
        <div className="dp-bi-vers">
          {[...vers].reverse().map((v) => {
            const bs = past.filter((b) => b.version_id === v.id && b.status === "brewed" && !b.plan?.subs?.length), lastB = bs[bs.length - 1];
            return <label key={v.id} className={`dp-bi-ver${base === `v:${v.id}` ? " on" : ""}`}><input type="radio" name="bi-ver" checked={base === `v:${v.id}`} onChange={() => pickBase(`v:${v.id}`)} />
              <b>v{v.num}{v.id === last?.id ? " · current" : ""}</b><span className="dp-dim">{v.note}{lastB ? ` · brewed ${fmtDate(lastB.brewed_on)}` : ""}{lastB?.tasting?.rating ? ` · ${"★".repeat(Math.round(lastB.tasting.rating))}` : ""}</span></label>;
          })}
          {subBrews.filter((b) => b.status === "brewed").reverse().map((b) => (
            <label key={b.id} className={`dp-bi-ver${base === `b:${b.id}` ? " on" : ""}`}><input type="radio" name="bi-ver" checked={base === `b:${b.id}`} onChange={() => pickBase(`b:${b.id}`)} />
              <b>{b.plan.label || "A past brew"}</b><span className="dp-dim">brewed {fmtDate(b.brewed_on)}{b.tasting?.rating ? ` · ${"★".repeat(Math.round(b.tasting.rating))}` : ""} · {(b.plan.subs || []).map(subText).join("; ")}{b.plan.kept === "version" ? ` · became v${b.plan.keptNum}` : ""}</span></label>
          ))}
        </div>
      </div>
      {subs.length > 0 && <p className="dp-dim" style={{ margin: "-6px 0 14px" }}>Made again with its swaps: {subs.map(subText).join("; ")} · {sgFmt(n0.og)} → {sgFmt(n1.og)} OG · {r1(n0.ibu, 0)} → {r1(n1.ibu, 0)} IBU</p>}
      <div className="dp-bi-sec">
        <div className="dp-bi-l">Shopping list · checked against your shelf (swaps for the store are made on the planned brew)</div>
        <table className="dp-tbl"><tbody>
          {shop.map((l) => <tr key={l.kind + l.name}><td>{l.name}</td><td className="dp-num dp-dim">{l.want} {l.unit}</td><td className={`dp-num ${l.buy > 0 ? "dp-bi-buy" : "dp-grn"}`}>{l.buy > 0 ? (l.have > 0 ? `buy ${l.buy} ${l.unit}` : "buy") : "have it"}</td></tr>)}
        </tbody></table>
        {starter && <p className="dp-note">Make a yeast starter {starter <= today ? "today" : `by ${dayName(starter)}`}.</p>}
      </div>
      <div className="dp-row" style={{ gap: 8 }}>
        <button type="button" className="dp-btn dp-go" disabled={busy || !base} onClick={go}>Make it as is · {when <= today ? `brew ${label} today` : `${dayName(when)}`}</button>
        <button type="button" className="dp-btn" onClick={() => onChangeFirst(when, gal)} title="Change the recipe first: it's saved as the next version, then you plan the brew">Make changes first</button>
        <button type="button" className="dp-btn" onClick={share}>Send the shopping list</button>
        <button type="button" className="dp-btn" onClick={onClose}>Cancel</button>
        {msg && <span className="dp-dim" style={{ whiteSpace: "pre-wrap" }}>{msg}</span>}
      </div>
    </Win>
  );
}
