/**
 * Bill third party (Oct 30, Nick: "in the delivery area on shipping… a check mark for bill third party… the FedEx third
 * party or the UPS account number"). The shipment is billed to someone else's carrier account: no shipping charge on our
 * invoice, and the account is named everywhere the ship method is (invoice, work order, labels, shipping).
 */
export type ThirdParty = { carrier: "FedEx" | "UPS" | ""; account: string; zip?: string; name?: string };

/** the carrier a ship method is with ("FedEx Ground" → FedEx) */
export const carrierOf = (method: string | null | undefined): ThirdParty["carrier"] => (/fedex/i.test(method || "") ? "FedEx" : /ups/i.test(method || "") ? "UPS" : "");

/** is the order billed to a third party (ticked and an account typed)? */
export const isThirdParty = (o: { delivery_method?: string | null; third_party?: ThirdParty | null }) => o.delivery_method === "ship" && !!o.third_party && !!(o.third_party.account || "").trim();

/** "bill third party (FedEx acct ••••6789)": the account's last four only, for anything printed or shown to the customer */
export function thirdPartyLabel(tp: ThirdParty | null | undefined, full = false): string {
  if (!tp || !(tp.account || "").trim()) return "";
  const a = tp.account.replace(/\s+/g, "");
  return `bill third party (${tp.carrier ? `${tp.carrier} ` : ""}acct ${full ? a : `••••${a.slice(-4)}`}${tp.name ? `, ${tp.name}` : ""})`;
}
