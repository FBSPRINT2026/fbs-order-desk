/** Extras bought on top of an order's goods (Order goods: + Order extra; Oct 29, Nick). Client-safe: the panel uses it. */
/** `shop`: the shop's own pieces, never shown or charged to the customer (Oct 29, Nick: "if we ordered extras and it's a
 *  shop sample, we shouldn't show it on the invoice for the client… Or spare for misprints, that should also be hidden.
 *  Customer extras is a different thing") */
export type GoodsExtra = { reason: string; print: boolean; free: boolean; shop?: boolean };
/** the reasons an extra is bought; "Other" asks for words and who it's for */
export const EXTRA_REASONS = ["Shop sample / test print", "Spare for misprints", "Customer's extras", "Other"] as const;
/** the reasons that are the shop's own pieces (hidden from the customer, no charge) */
export const SHOP_REASONS: readonly string[] = ["Shop sample / test print", "Spare for misprints"];
export const shopReason = (reason: string) => SHOP_REASONS.includes(reason);
