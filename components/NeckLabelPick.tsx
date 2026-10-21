"use client";
import Link from "next/link";
import { guessHex } from "@/lib/mockup";
import type { Group } from "@/lib/pricing";
import { mainSize, type NeckLabelSet } from "@/lib/neckLabels";
export { isRelabel, mainSize } from "@/lib/neckLabels";
import NeckLabelView from "@/components/NeckLabelView";

/**
 * Which of the customer's neck label sets this print uses, shown when Private Label is ticked, with the inside of the
 * neck for the main size (Oct 20, Nick).
 */
export default function NeckLabelPick({ sets, value, onChange, groups, customerId }: { sets: NeckLabelSet[]; value?: string; onChange: (id: string) => void; groups: Group[]; customerId?: string }) {
  const live = sets.filter((s) => !s.archived);
  const cur = live.find((s) => s.id === value) || (live.length === 1 ? live[0] : undefined);
  const color = groups.flatMap((g) => g.lines).find((l) => l.color)?.color || "";
  return (
    <div className="nlp">
      <div className="nlp-row">
        <span className="nlp-l">Neck label</span>
        {live.length ? (
          <select value={cur?.id || ""} onChange={(e) => onChange(e.target.value)} aria-label="Which neck label">
            {!cur && <option value="">Pick their label…</option>}
            {live.map((s) => <option key={s.id} value={s.id}>{s.name || "Label"}{s.content ? ` · ${s.content}` : ""}</option>)}
          </select>
        ) : (
          <span className="faint">No neck labels on file. {customerId ? <Link href={`/shop/customers/${customerId}`}>Add their label art</Link> : "Add their label art on the customer"} (Brand standards → Neck labels).</span>
        )}
      </div>
      {cur && <NeckLabelView set={cur} size={mainSize(groups)} shirtHex={guessHex(color || "Black")} width={180} />}
    </div>
  );
}
