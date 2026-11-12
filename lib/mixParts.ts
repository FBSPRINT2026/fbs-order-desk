import { methodType, type MachineType } from "@/lib/production";
import type { Group } from "@/lib/pricing";

/**
 * A mixed job's parts (Nov 12, Nick, #40313: screen print done, embroidery printing, heat press not scheduled): one per
 * kind of machine the order prints on, with where it stands on the schedule. Shown by components/MixStrip.tsx on the
 * Orders list, the order's header and the schedule's job card; only for an order with more than one kind.
 */
export type MixState = "ok" | "run" | "wt" | "ns";
export type MixPart = { kind: MachineType; state: MixState; /** when and where, for the tooltip */ note: string };
export type MixSlot = { order_id: string | null; kind: string | null; status: string; day: string; machine: string; finished_at?: string | null };

export const MIX_ABBR: Record<MachineType, string> = { screen: "SP", embroidery: "EMB", heat: "HP" };
export const MIX_WORD: Record<MachineType, string> = { screen: "Screen print", embroidery: "Embroidery", heat: "Heat press" };
const ORDER: MachineType[] = ["screen", "embroidery", "heat"];

/** the kinds of machine an order's prints need (printed garments only) */
export function kindsOf(groups: Group[] | null | undefined): MachineType[] {
  const k = new Set<MachineType>();
  for (const g of groups || []) {
    if (!(g.lines || []).some((l) => Object.values(l.sizes || {}).some((n) => +n > 0) && !(l as { ghost?: boolean }).ghost)) continue;
    for (const i of g.imprints || []) if (i.method) k.add(methodType(i.method));
  }
  return ORDER.filter((x) => k.has(x));
}

const dayWord = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
export function mixParts(groups: Group[] | null | undefined, slots: MixSlot[], machName: (id: string) => string = (x) => x): MixPart[] {
  const kinds = kindsOf(groups);
  if (kinds.length < 2) return [];
  return kinds.map((kind) => {
    const mine = slots.filter((s) => (s.kind || "screen") === kind);
    if (!mine.length) return { kind, state: "ns", note: `${MIX_WORD[kind]} not on the schedule yet` };
    if (mine.every((s) => s.status === "done")) {
      const last = mine.map((s) => s.finished_at || "").sort().pop();
      return { kind, state: "ok", note: `${MIX_WORD[kind]} done${last ? ` ${new Date(last).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}` };
    }
    const run = mine.find((s) => s.status === "running" || s.status === "paused");
    if (run) return { kind, state: "run", note: `${MIX_WORD[kind]} ${run.status === "paused" ? "paused" : "printing"} · ${machName(run.machine)}` };
    const next = mine.filter((s) => s.status !== "done").sort((a, b) => a.day.localeCompare(b.day))[0];
    return { kind, state: "wt", note: `${MIX_WORD[kind]} ${dayWord(next.day)} · ${machName(next.machine)}` };
  });
}
