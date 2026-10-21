"use client";
import { carryOf, type CarryKey, type PastJob } from "@/lib/emailOrderShared";

/**
 * A reorder of a Printavo job: carry its customer / production notes over to the new order's production notes
 * (Oct 21, Nick: "sometimes customer notes will be like a shipping address and that's not important. But sometimes
 * like this one, it's actual color information"). Each note is shown; the ones about the print are ticked to start.
 */
export default function CarryNotes({ job, carry, onChange }: { job: PastJob | null | undefined; carry?: CarryKey[]; onChange: (c: CarryKey[]) => void }) {
  const n = job?.oldNotes;
  if (!n || (!n.customer && !n.production)) return null;
  const on = carryOf({ carry }, n);
  const keys = (["customer", "production"] as CarryKey[]).filter((k) => n[k]);
  return (
    <div className="carry">
      <div className="carry-h"><b>Notes on {job!.label.replace(/\s*\(Printavo\)$/, "")}</b> <span className="faint">tick the ones to carry over to this order&apos;s production notes</span></div>
      {keys.map((k) => (
        <label key={k} className="carry-i">
          <input type="checkbox" checked={on.includes(k)} onChange={(e) => onChange(e.target.checked ? [...new Set([...on, k])] : on.filter((x) => x !== k))} />
          <span><b>{k === "customer" ? "Customer note" : "Production note"}</b><span className="carry-t">{n[k]}</span></span>
        </label>
      ))}
    </div>
  );
}
