"use client";
import MenuItem from "@/components/MenuItem";
import { openOrderGoodsForOrder } from "@/components/tools/OrderGoodsTool";
import type { HelperAction, HelperOrder } from "@/lib/orderHelperShared";

/**
 * The ✦ AI menu on the order page. Its first item is THE AI order helper (Nov 1, Nick: "we've created two tools, which
 * is quick ask and order chat… one AI tool for an order… call it AI"): the chat on the right
 * (components/tools/OrderReview.tsx), which builds, checks and changes the order and takes dropped PDFs, snips and
 * Outlook emails. Quick ask (Oct 21: the pop-up that made changes on the page with Undo) is folded into it. Then the
 * other order tools: Order goods, Send for digitizing, Create DTF gang sheet.
 */
export default function OrderHelper({ orderId, onChat, onDigitize }: {
  orderId: string;
  /** the Digitizer (components/tools/DigitizerTool.tsx), when the order has embroidery (Oct 27) */ onDigitize?: () => void;
  /** the AI order helper on the right (components/tools/OrderReview.tsx) */ onChat?: () => void;
  /** kept for the order page's call; the helper works on the saved order now */ snapshot?: () => HelperOrder | null;
  apply?: (a: HelperAction[]) => Promise<string[]>; undo?: () => boolean;
}) {
  return (
    <>
      {onChat ? (
        <details className="ot-more" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.open = false; }}>
          <summary className="btn oh-btn">✦ AI ▾</summary>
          <div className="ot-menu">
            {/* ONE AI tool for an order (Nov 1, Nick: "we've created two tools, which is quick ask and order chat… make them
                all the same… one AI tool for an order… call it AI… AI order helper"): the chat on the right
                (components/tools/OrderReview.tsx) builds, checks and changes the order, and takes dropped PDFs, snips and
                Outlook emails; Quick ask is folded into it */}
            <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; onChat(); }} title="The AI on the right: drop in a PDF, a snip or an email from Outlook, talk or type what to do, or have it check the order; it stays open while you look around, and it's kept with the order"><MenuItem icon="chat" tone="blue" title="AI order helper" sub="Drop a PDF or email, talk, check it" /></button>
            {/* Order goods (Oct 23, Nick: "on the order screen where it says Ask AI, you need to add the order goods tool… it's
                all detailed out perfectly in the order itself"): the one Order Goods tool, filled from this order's garments */}
            <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; openOrderGoodsForOrder(orderId); }} title="Buy this order's garments: the Order goods panel on the right, S&S and SanMar side by side; you place it"><MenuItem icon="shirt" tone="orange" title="Order goods" sub="S&amp;S and SanMar side by side" /></button>
            {/* Create DTF gang sheet (Oct 26, Nick; first "Order DTF transfers"): the one Gang sheet builder, filled from this order's heat press prints */}
            {onDigitize && <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; onDigitize(); }} title="Send an embroidered logo to Volikes to be digitized: the email, the digitizing sheet and the original art; you press Send"><MenuItem icon="needle" tone="violet" title="Send for digitizing" sub="Email the logo to Volikes" /></button>}
            <a href={`/shop/gang-sheet/builder?order=${orderId}`} title="Opens the Gang sheet builder with this order's heat press prints: their art (background off), sizes and how many, saved with the order (or this order's sheet if it already has one); you order it from DTF Dallas"><MenuItem icon="grid" tone="green" title="Create DTF gang sheet" sub="The heat press prints on one sheet" /></a>
          </div>
        </details>
      ) : null}
    </>
  );
}
