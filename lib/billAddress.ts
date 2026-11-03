import { stateFromZip } from "@/lib/zipState";

/** a card's billing address, as the payment processor takes it */
export type BillAddr = { street: string; street2: string; city: string; state: string; zip: string };
export const emptyBill = (): BillAddr => ({ street: "", street2: "", city: "", state: "", zip: "" });

/**
 * The billing address on file (customers.address, typed as lines: "On Your Left!\n3824 Cedar Springs Road\nPMB #116\nDallas
 * TX 75219") split into its parts: the street is the first line starting with a number, a suite / PMB line after it is the
 * second line, the last line has the city, state and ZIP (the state worked out from the ZIP when it isn't there).
 */
export function parseBill(text: string | null | undefined): BillAddr {
  const lines = String(text || "").split(/\n|·/).map((x) => x.trim()).filter(Boolean);
  const out = emptyBill();
  if (!lines.length) return out;
  const last = lines[lines.length - 1];
  const m = /^(.*?)[,\s]+([A-Za-z]{2})?\.?[,\s]*(\d{5})(?:-\d{4})?$/.exec(last);
  let rest = lines;
  if (m) { out.city = m[1].replace(/,\s*$/, "").trim(); out.zip = m[3]; out.state = (m[2] || stateFromZip(m[3])).toUpperCase(); rest = lines.slice(0, -1); }
  const si = rest.findIndex((l) => /^\d/.test(l));
  if (si >= 0) { out.street = rest[si]; out.street2 = rest.slice(si + 1).join(", "); }
  else if (rest.length) out.street = rest[rest.length - 1];
  return out;
}

/** the processor's fields for a billing address (Stax.js tokenize): a full address can lower the card rate */
export const staxAddress = (b: BillAddr) => ({
  address_1: b.street.trim(), address_2: b.street2.trim(), address_city: b.city.trim(),
  address_state: (b.state.trim() || stateFromZip(b.zip)).toUpperCase(), address_zip: b.zip.trim(), address_country: "USA",
});

/** what's missing from it, in words ("" when it's all there) */
export function billMissing(b: BillAddr): string {
  if (!b.street.trim()) return "Enter the card's billing street address.";
  if (!b.city.trim()) return "Enter the billing city.";
  if (!/^\d{5}/.test(b.zip.trim())) return "Enter the card's 5-digit billing ZIP code.";
  if (!(b.state.trim() || stateFromZip(b.zip))) return "Enter the billing state.";
  return "";
}
