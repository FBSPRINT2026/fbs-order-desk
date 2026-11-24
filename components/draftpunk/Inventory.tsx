"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { r1 } from "@/lib/draftpunk/calc";
import { FERMENTABLES, HOPS, MISCS, YEASTS } from "@/lib/draftpunk/library";
import type { Recipe } from "@/lib/draftpunk/types";
import { useToast } from "./Shell";
import { F, Num, Picker, Win } from "./ui";
import LibraryBrowser from "./LibraryBrowser";

type Item = { id: string; kind: "fermentable" | "hop" | "yeast" | "misc"; name: string; data: Record<string, unknown>; in_stock: number | null };
const UNIT = { fermentable: "lb", hop: "oz", yeast: "pk", misc: "" } as const;
const LIB = { fermentable: FERMENTABLES, hop: HOPS, yeast: YEASTS, misc: MISCS } as const;

/**
 * What's on the shelf, and the shopping list for a recipe: what it calls for minus what's in stock. Brewing a recipe
 * can take its amounts out of stock.
 */
export default function Inventory({ userId }: { userId: string }) {
  const { toast, node } = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [pick, setPick] = useState<"" | Item["kind"]>("");
  const [recipes, setRecipes] = useState<{ id: string; name: string; data: Recipe }[]>([]);
  const [rid, setRid] = useState("");
  const load = async () => {
    const sb = createClient();
    const [{ data: inv }, { data: rec }] = await Promise.all([
      sb.from("dp_ingredients").select("id, kind, name, data, in_stock").eq("owner_id", userId).order("kind").order("name"),
      sb.from("dp_recipes").select("id, name, data").eq("owner_id", userId).order("updated_at", { ascending: false }),
    ]);
    setItems(((inv || []) as Item[]).filter((i) => i.kind !== ("water" as string)));
    setRecipes((rec || []) as { id: string; name: string; data: Recipe }[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const setStock = async (it: Item, n: number) => {
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, in_stock: n } : x)));
    await createClient().from("dp_ingredients").update({ in_stock: n }).eq("id", it.id);
  };
  // the alpha on the package of hops on the shelf: brew day's "Adjust for my hops" fills it in
  const setLot = async (it: Item, n: number) => {
    const data = { ...it.data, lotAlpha: n || undefined };
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, data } : x)));
    await createClient().from("dp_ingredients").update({ data }).eq("id", it.id);
  };
  const add = async (kind: Item["kind"], key: string, custom?: string) => {
    const lib = (LIB[kind] as unknown as { id: string; name: string }[]).find((x) => x.id === key);
    const name = custom || lib?.name || "Item";
    if (items.some((i) => i.kind === kind && i.name.toLowerCase() === name.toLowerCase())) { toast("Already on the shelf"); setPick(""); return; }
    const { id: _id, ...data } = (lib || { name }) as { id?: string; name: string };
    await createClient().from("dp_ingredients").insert({ owner_id: userId, kind, name, data: { ...data, ref: lib?.id }, in_stock: 0 });
    setPick(""); load();
  };
  // from the club's library: the item as its maker lists it
  const addFrom = async (kind: Item["kind"], name: string, data: Record<string, unknown>) => {
    if (items.some((i) => i.kind === kind && i.name.toLowerCase() === name.toLowerCase())) { toast("Already on the shelf"); return; }
    await createClient().from("dp_ingredients").insert({ owner_id: userId, kind, name, data, in_stock: 0 });
    toast(`${name} is on the shelf`); load();
  };
  const remove = async (it: Item) => { await createClient().from("dp_ingredients").delete().eq("id", it.id); load(); };

  // the shopping list for the chosen recipe
  const recipe = recipes.find((x) => x.id === rid)?.data;
  const need = useMemo(() => {
    if (!recipe) return [];
    const have = (kind: Item["kind"], name: string) => items.find((i) => i.kind === kind && i.name.toLowerCase() === name.toLowerCase())?.in_stock || 0;
    const lines: { kind: Item["kind"]; name: string; want: number; have: number }[] = [];
    const push = (kind: Item["kind"], name: string, want: number) => { const l = lines.find((x) => x.kind === kind && x.name === name); if (l) l.want += want; else lines.push({ kind, name, want, have: have(kind, name) }); };
    recipe.ferms.forEach((f) => push("fermentable", f.name, f.lb));
    recipe.hops.forEach((h) => push("hop", h.name, h.oz));
    recipe.yeasts.forEach((y) => push("yeast", y.name, y.packs));
    recipe.miscs.forEach((m) => push("misc", m.name, m.amount));
    return lines;
  }, [recipe, items]);
  const useUp = async () => {
    const sb = createClient();
    for (const l of need) {
      const it = items.find((i) => i.kind === l.kind && i.name.toLowerCase() === l.name.toLowerCase());
      if (it) await sb.from("dp_ingredients").update({ in_stock: Math.max(0, r1((it.in_stock || 0) - l.want, 3)) }).eq("id", it.id);
    }
    toast("Taken out of stock"); load();
  };
  const pickItems = pick ? (LIB[pick] as unknown as { id: string; name: string; origin?: string; lab?: string }[]).map((x) => ({ key: x.id, name: x.name, sub: x.origin || x.lab })) : [];

  return (
    <>
      <h1 className="dp-h1">Stock</h1>
      <div className="dp-grid">
        <Win title="On the shelf">
          <table className="dp-tbl" data-nofit>
            <thead><tr><th>Item</th><th>Kind</th><th className="dp-num">Have</th><th className="dp-num">Lot AA%</th><th /></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td><div className="dp-namecell">{i.name}{(i.data.supplier || i.data.lab || i.data.origin) ? <span className="dp-sub">{String(i.data.supplier || i.data.lab || i.data.origin)}</span> : null}</div></td><td className="dp-dim">{i.kind}</td>
                  <td className="dp-num"><Num value={i.in_stock ?? 0} onChange={(n) => setStock(i, n)} /> {UNIT[i.kind]}</td>
                  <td className="dp-num">{i.kind === "hop" ? <Num value={(i.data as { lotAlpha?: number }).lotAlpha} title="Alpha acid % on this package (recipes adjust to it on brew day)" onChange={(n) => setLot(i, n)} /> : null}</td>
                  <td className="dp-num"><button className="dp-btn dp-x" onClick={() => remove(i)}>X</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <p className="dp-dim">Nothing on the shelf yet.</p>}
          <p className="dp-row">
            <button className="dp-btn" onClick={() => setPick("fermentable")}>+ Grain</button>
            <button className="dp-btn" onClick={() => setPick("hop")}>+ Hops</button>
            <button className="dp-btn" onClick={() => setPick("yeast")}>+ Yeast</button>
            <button className="dp-btn" onClick={() => setPick("misc")}>+ Misc</button>
          </p>
        </Win>
        <Win title="Shopping list">
          <F label="For recipe">
            <select value={rid} onChange={(e) => setRid(e.target.value)}>
              <option value="">(pick a recipe)</option>
              {recipes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </F>
          {recipe && (
            <>
              <table className="dp-tbl" data-nofit style={{ marginTop: 8 }}>
                <thead><tr><th>Item</th><th className="dp-num">Need</th><th className="dp-num">Have</th><th className="dp-num">Buy</th></tr></thead>
                <tbody>
                  {need.map((l) => (
                    <tr key={l.kind + l.name}>
                      <td>{l.name}</td>
                      <td className="dp-num">{r1(l.want, 2)} {UNIT[l.kind]}</td>
                      <td className="dp-num">{r1(l.have, 2)}</td>
                      <td className="dp-num" style={{ color: l.want > l.have ? "var(--dp-red)" : "var(--dp-grn)" }}>{l.want > l.have ? `${r1(l.want - l.have, 2)} ${UNIT[l.kind]}` : "OK"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="dp-row"><button className="dp-btn" onClick={useUp}>I brewed it: Take it out of stock</button></p>
            </>
          )}
        </Win>
      </div>
      <LibraryBrowser onAdd={addFrom} />
      {pick && <Picker title={`Add ${pick} to the shelf`} items={pickItems} onPick={(k) => add(pick, k)} onCustom={(n) => add(pick, "", n)} onClose={() => setPick("")} />}
      {node}
    </>
  );
}
