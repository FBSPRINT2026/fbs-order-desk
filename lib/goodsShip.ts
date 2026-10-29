/**
 * THE shipping choices for buying goods, and which ones are free (Oct 29, Nick: "S&S… as part of their… contract
 * decorator network, we get free UPS ground… with SanMar, we get free PSST… if you select any of the other options… a
 * pop-up… you've selected a non-free option… if you accidentally shipped 500 shirts… next day air, that would be like a
 * $1,000 mistake"). Client-safe: every place that buys goods shows these lists, asks with `components/PaidShipAsk.tsx`
 * before a paid one, and the server refuses a paid one that wasn't confirmed (`paidShipBlock`), so a new way to buy can't
 * skip the question.
 *   - S&S: UPS Ground is free (contract decorator network); will call is free (we pick up); the rest we pay freight.
 *   - SanMar: PSST is free (SanMar picks the carrier); will call is free; UPS air we pay freight.
 *   - One Stop: UPS Ground is free on orders of $175 or more (Oct 29, Nick); under that, or anything faster, asks first.
 */
export type GoodsSup = "ss" | "sm" | "os";

export const SS_SHIP: [string, string][] = [["40", "UPS Ground (free: decorator network)"], ["14", "FedEx Ground (we pay freight)"], ["16", "UPS 3 Day Select (we pay freight)"], ["3", "UPS 2nd Day Air (we pay freight)"], ["2", "UPS Next Day Air (we pay freight)"], ["6", "Will call (we pick up)"]];
export const SM_SHIP_OPTS: [string, string][] = [["psst", "PSST program (SanMar picks the carrier, free)"], ["6", "Will call: we pick up at SanMar Dallas"], ["3", "UPS 2nd Day Air (we pay freight)"], ["2", "UPS Next Day Air (we pay freight)"]];

/** One Stop (their ship-via numbers for our account): Ground is free at $175 and up (Oct 29, Nick: "we get free ground
 *  shipping at $175"); ships from Grand Rapids, MI 49544 */
export const OS_FREE_AT = 175;
export const OS_SHIP_OPTS: [string, string][] = [["1", "UPS Ground (free at $175)"], ["3", "UPS 3 Day Select (we pay more freight)"], ["2", "UPS 2nd Day Air (we pay more freight)"], ["4", "UPS Next Day Air (we pay more freight)"], ["10", "Customer pickup (Michigan)"]];

const FREE: Record<GoodsSup, string[]> = { ss: ["40", "6", "1", ""], sm: ["psst", "6", ""], os: ["10", ""] };
export const FREE_NAME: Record<GoodsSup, string> = { ss: "UPS Ground (contract decorator network)", sm: "PSST", os: `UPS Ground on $${OS_FREE_AT} or more` };
export const FREE_CODE: Record<GoodsSup, string> = { ss: "40", sm: "psst", os: "1" };
const SUP: Record<GoodsSup, string> = { ss: "S&S", sm: "SanMar", os: "One Stop" };

/** `amount`: the goods on that supplier's order, for a supplier whose free shipping starts at an amount (One Stop) */
export const shipFree = (sup: GoodsSup, code: string | null | undefined, amount?: number) => FREE[sup].includes(String(code ?? "")) || (sup === "os" && code === "1" && (amount ?? 0) >= OS_FREE_AT);
export const shipName = (sup: GoodsSup, code: string) => ((sup === "ss" ? SS_SHIP : sup === "os" ? OS_SHIP_OPTS : SM_SHIP_OPTS).find(([k]) => k === code)?.[1] || code).replace(/ \((we pay (more )?freight|free[^)]*)\)$/, "");

/** one line per supplier that's set to paid shipping, for the question */
export function paidShipLines(picks: { sup: GoodsSup; code: string; amount?: number }[]): string[] {
  return picks.filter((p) => !shipFree(p.sup, p.code, p.amount)).map((p) => `${SUP[p.sup]}: ${shipName(p.sup, p.code)}${p.sup === "os" && p.code === "1" ? ` on a $${Math.round(p.amount || 0)} order (free from $${OS_FREE_AT})` : ""}. Our free way is ${FREE_NAME[p.sup]}.`);
}

/** the server's check: a real order on paid shipping needs the person to have said yes to paying for it */
export function paidShipBlock(sup: GoodsSup, code: string, test: boolean, ok?: boolean, amount?: number): string | null {
  if (test || ok || shipFree(sup, code, amount)) return null;
  return `${SUP[sup]} ${shipName(sup, code)} isn't free shipping. Confirm paying for shipping, or pick ${FREE_NAME[sup]}.`;
}
