/** Extras bought on top of an order's goods (Order goods: + Order extra; Oct 29, Nick). Client-safe: the panel uses it. */
export type GoodsExtra = { reason: string; print: boolean; free: boolean };
/** the reasons an extra is bought; "Other" asks for words */
export const EXTRA_REASONS = ["Shop sample / test print", "Spare for misprints", "Customer's extras", "Other"] as const;
