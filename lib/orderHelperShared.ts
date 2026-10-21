/**
 * The order helper (Oct 21, Nick: "an AI helper on the order page… just do whatever I ask… I've got this snip… fill in
 * this order… or create it, and you'd ask me: what's the black? what's the gray soft? what's the red? and I tell you
 * and you go for it"). Shared by the API (lib/ai/orderHelper.ts) and the order page, which applies the changes to the
 * order as it stands on screen (unsaved edits included), with Undo.
 */
export type HelperMsg = { role: "staff" | "ai"; text: string; images?: number; done?: string[] };

/** a group: its index on the order, or a new group's name (made on first use; later actions with the name reuse it) */
export type GroupRef = number | string;
export type HelperAction =
  | { kind: "set_sizes"; group: number; line: number; sizes: Record<string, number>; mode?: "replace" | "add" }
  | { kind: "add_line"; group: GroupRef; style: string; brand?: string; color: string; sizes: Record<string, number> }
  | { kind: "set_line"; group: number; line: number; style?: string; color?: string }
  | { kind: "remove_line"; group: number; line: number }
  | { kind: "set_imprint"; group: GroupRef; location: string; method?: string; colors?: number; inks?: string; size?: string }
  /** a 2XL+ charge each, typed by hand ("make all the 2XLs $2"); null = back to automatic. group/line left out = every line */
  | { kind: "set_size_charge"; sizes: Record<string, number | null>; group?: number; line?: number }
  /** a garment's price each (the whole price per piece, prints included); null = back to the price list. left out = every line */
  | { kind: "set_price"; each: number | null; group?: number; line?: number }
  | { kind: "add_fee"; label: string; amount: number }
  | { kind: "set_discount"; type: "pct" | "amt"; value: number }
  | { kind: "set_order"; nickname?: string; due_date?: string; po_number?: string; notes_append?: string; group_name?: { group: number; name: string } };

/** the order as the helper sees it */
export type HelperOrder = {
  number: number; nickname: string; customer: string; due_date: string | null; po_number: string; notes: string;
  price_type: string; fees: { label: string; amount: number }[]; discount: string; total: number;
  groups: { name: string; lines: { style: string; brand: string; color: string; description: string; sizes: Record<string, number>; colors?: string[]; /** the sizes it comes in (youth / adult) */ run?: string[]; each?: number; priceSetByHand?: boolean; sizeCharges?: Record<string, number> }[]; imprints: { location: string; method: string; colors: number; inks: string; size: string }[] }[];
};
