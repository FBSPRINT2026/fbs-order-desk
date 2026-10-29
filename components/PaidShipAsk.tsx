"use client";
/**
 * The question before buying goods on paid shipping (lib/goodsShip.ts). Every place that buys goods opens this when
 * `paidShipLines` isn't empty: "Use the free shipping" switches back, "Yes, pay for it" goes ahead with paidShipOk.
 */
export function PaidShipAsk({ lines, pcs, onFree, onPay, onClose }: { lines: string[]; pcs: number; onFree: () => void; onPay: () => void; onClose: () => void }) {
  return (
    <div className="dla-bg" role="dialog" aria-modal="true" aria-label="Paid shipping" onClick={onClose}>
      <div className="dla" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <h3>Pay for shipping?</h3>
        <p className="dla-sub">You picked shipping that isn&apos;t free, so the supplier adds the freight to the bill:</p>
        <ul className="og-paid">{lines.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="dla-sub">{pcs.toLocaleString()} pcs. The supplier doesn&apos;t give the freight before ordering: it&apos;s on their confirmation, and air on a big order can run hundreds of dollars.</p>
        <div className="dla-acts">
          <button type="button" className="btn primary" autoFocus onClick={onFree}>Use the free shipping</button>
          <button type="button" className="btn" onClick={onPay}>Yes, pay for it</button>
        </div>
      </div>
    </div>
  );
}
