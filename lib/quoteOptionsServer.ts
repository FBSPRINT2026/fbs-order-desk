import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcOrder, mergeSettings, type Group, type Order, type Payment } from "@/lib/pricing";
import { applyPicks, choicesOf, optionName, type OptionPick } from "@/lib/quoteOptions";

/**
 * Pick the options on a quote (lib/quoteOptions.ts): the customer approving (their order page, the portal) or staff
 * approving by hand. Each choice keeps its picked option; the others come off the order, kept whole in its log
 * (`options_dropped`, to bring back by hand if they change their mind), and the order's total is what's left.
 * No choices on the order: nothing to do.
 */
export async function pickQuoteOptions(admin: SupabaseClient, orderId: string, picks: OptionPick | null | undefined, actor: string) {
  const [{ data: o }, { data: st }, { data: pays }] = await Promise.all([
    admin.from("orders").select("*").eq("id", orderId).maybeSingle(),
    admin.from("settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("payments").select("amount").eq("order_id", orderId),
  ]);
  if (!o) return { ok: false as const, error: "This order isn't here any more." };
  const groups = ((o as Order).groups || []) as Group[];
  const cs = choicesOf(groups);
  if (!cs.length) return { ok: true as const, picked: "", groups };
  const r = applyPicks(groups, picks || {});
  if (!r.ok) return { ok: false as const, error: `Pick one first: ${r.missing}.` };
  const names = (gs: Group[]) => gs.map((g) => { for (const c of cs) { const x = c.options.find((y) => y.g.id === g.id); if (x) return optionName(x); } return g.name || "an option"; });
  const picked = names(r.kept).join(", "), dropped = names(r.dropped).join(", ");
  const total = calcOrder({ ...(o as Order), groups: r.groups }, mergeSettings(st?.data), (pays || []) as Pick<Payment, "amount">[]).total;
  const { error } = await admin.from("orders").update({ groups: r.groups, total }).eq("id", orderId);
  if (error) return { ok: false as const, error: error.message };
  await admin.from("order_events").insert([
    { order_id: orderId, kind: "options_picked", detail: `Picked ${picked}${dropped ? `. Off the order: ${dropped}` : ""}`, actor },
    { order_id: orderId, kind: "options_dropped", detail: JSON.stringify(r.dropped).slice(0, 200000), actor },
  ]);
  return { ok: true as const, picked, groups: r.groups };
}

/** the order's choices still to pick, for a check before approving ("" when there are none) */
export function optionsToPick(groups: Group[] | null | undefined) {
  return choicesOf(groups).map((c) => c.options.map(optionName).join(" or ")).join("; ");
}
