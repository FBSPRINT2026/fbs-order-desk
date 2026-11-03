"use client";
import { useEffect } from "react";
import { myBillAddress } from "@/app/portal/pay-actions";
import { stateFromZip } from "@/lib/zipState";
import type { BillAddr } from "@/lib/billAddress";

/**
 * A card's full billing address (Nov 3, Nick: "put the full address in there… it changes my credit card rate if I have
 * all the details"): street, suite, city, state and ZIP, filled in from the billing address on file and changeable. One
 * piece for every card form in the portal (Pay, Add a card).
 */
export default function BillAddressFields({ v, set, id = "bl" }: { v: BillAddr; set: (b: BillAddr) => void; id?: string }) {
  useEffect(() => {
    let live = true;
    const as = new URLSearchParams(window.location.search).get("as") || undefined;
    myBillAddress(as).then((b) => { if (live && b.street) set(b); }).catch(() => null);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the form opens
  }, []);
  const up = (k: keyof BillAddr) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = { ...v, [k]: e.target.value };
    // the state follows the ZIP until it's typed by hand
    if (k === "zip" && (!v.state || v.state === stateFromZip(v.zip))) n.state = stateFromZip(e.target.value) || v.state;
    set(n);
  };
  return (
    <div className="pbl">
      <div className="field pbl-st"><label htmlFor={`${id}-st`}>Billing address</label><input id={`${id}-st`} autoComplete="address-line1" placeholder="Street address" value={v.street} onChange={up("street")} /></div>
      <div className="field pbl-st2"><label htmlFor={`${id}-st2`}>Suite, unit <span className="faint">(optional)</span></label><input id={`${id}-st2`} autoComplete="address-line2" value={v.street2} onChange={up("street2")} /></div>
      <div className="pbl-row">
        <div className="field"><label htmlFor={`${id}-city`}>City</label><input id={`${id}-city`} autoComplete="address-level2" value={v.city} onChange={up("city")} /></div>
        <div className="field"><label htmlFor={`${id}-state`}>State</label><input id={`${id}-state`} autoComplete="address-level1" maxLength={2} value={v.state} onChange={(e) => set({ ...v, state: e.target.value.toUpperCase() })} /></div>
        <div className="field"><label htmlFor={`${id}-zip`}>ZIP</label><input id={`${id}-zip`} inputMode="numeric" autoComplete="postal-code" maxLength={10} value={v.zip} onChange={up("zip")} /></div>
      </div>
    </div>
  );
}
