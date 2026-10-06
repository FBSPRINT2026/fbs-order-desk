"use client";
import { useEffect, useRef } from "react";
import { shortSize, isYouthSize, storeImg } from "@/lib/merch";
import { money, Stepper, type Bag } from "./kit";

/** The bag, sliding in from the side: change how many, remove, then check out. */
export default function BagDrawer({ bag, canBuy, preorder, onClose, onCheckout }: { bag: Bag; canBuy: boolean; preorder: string; onClose: () => void; onCheckout: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    box.current?.focus();
    return () => { removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="sf-drawer-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sf-drawer" role="dialog" aria-modal="true" aria-label="Your bag" tabIndex={-1} ref={box}>
        <div className="sf-drawer-h">
          <h2>Your bag{bag.count ? <span> · {bag.count} item{bag.count === 1 ? "" : "s"}</span> : null}</h2>
          <button type="button" className="sf-x" aria-label="Close the bag" onClick={onClose}>✕</button>
        </div>
        <div className="sf-drawer-b">
          {!bag.lines.length && <div className="sf-empty"><p>Your bag is empty.</p><button type="button" className="sf-btn ghost" onClick={onClose}>Shop the store</button></div>}
          {bag.lines.map((l) => (
            <div key={l.key} className={"sf-bline" + (l.ok ? "" : " gone")}>
              <div className="sf-bline-img">{l.image ? <img src={storeImg(l.image)} alt="" /> : null}</div>
              <div className="sf-bline-t">
                <b data-notranslate>{l.name}</b>
                <span>{l.ok ? <>{l.color} · {isYouthSize(l.size) ? "Youth" : "Adult"} {shortSize(l.size)}</> : "This isn't in the store anymore."}</span>
                {Object.values(l.personalization || {}).length > 0 && <span className="sf-bline-p">“{Object.values(l.personalization || {}).join(" · ")}”</span>}
                <div className="sf-bline-row">
                  {l.ok ? <Stepper size="sm" value={l.qty} min={0} onChange={(v) => bag.setQty(l.key, v)} label={`${l.name} ${l.color} ${l.size}`} /> : <span />}
                  <button type="button" className="sf-link" onClick={() => bag.remove(l.key)}>Remove</button>
                </div>
              </div>
              <b className="sf-bline-price">{l.ok ? money(l.total) : ""}</b>
            </div>
          ))}
        </div>
        {bag.live.length > 0 && (
          <div className="sf-drawer-f">
            <div className="sf-sumrow"><span>Subtotal</span><b>{money(bag.subtotal)}</b></div>
            <p className="sf-fine">Tax{preorder ? " and delivery" : ""} are figured at checkout. {preorder}</p>
            <button type="button" className="sf-btn big" disabled={!canBuy} onClick={onCheckout}>{canBuy ? "Check out" : "The store isn't taking orders"}</button>
            <button type="button" className="sf-btn ghost big" onClick={onClose}>Keep shopping</button>
          </div>
        )}
      </div>
    </div>
  );
}
