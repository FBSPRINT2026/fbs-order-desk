import { Suspense } from "react";
import DesignerStudio from "@/components/DesignerStudio";

/** Idea Lab (staff): build text / clip art / picture designs for a customer. */
export default function DesignerPage() {
  return <Suspense fallback={<div className="empty">Loading…</div>}><DesignerStudio backHref="/shop/artwork" mockupHref="/shop/artwork/mockup" /></Suspense>;
}
