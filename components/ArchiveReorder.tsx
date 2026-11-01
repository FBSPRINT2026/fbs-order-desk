"use client";
import { useState } from "react";
import CreateOrderTool from "@/components/tools/CreateOrderTool";

/**
 * Reorder on an archived Printavo job: opens THE Create order tool on the right, as a reorder of this job (Nov 1, Nick:
 * "when you click a reorder, you should pop up the create, just like you do in ClickUp and everywhere else"): the old
 * job's goods and everything attached to it, each file sorted by you, then the order (components/tools/ReorderPick.tsx).
 */
export default function ArchiveReorder({ archivedId, small }: { archivedId: string; small?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={"btn primary" + (small ? " sm" : "")} onClick={() => setOpen(true)} title="Opens Create order as a reorder of this job: its garments, and every file on it for you to sort">Reorder</button>
      {open && <CreateOrderTool archivedId={archivedId} onClose={() => setOpen(false)} />}
    </>
  );
}
