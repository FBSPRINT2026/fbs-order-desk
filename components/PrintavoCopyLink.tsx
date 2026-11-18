"use client";
import { useEffect, useState } from "react";
import { printavoCopyOf } from "@/app/shop/archive/edit-actions";

/** An old Printavo job made editable here: Printavo's copy of it (its files, messages and history as they were). */
export default function PrintavoCopyLink({ orderId }: { orderId: string }) {
  const [id, setId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    void printavoCopyOf(orderId).then(setId);
    // what Edit here found when it made the order (a total that isn't Printavo's), said once
    try { const k = `fbs:pvEditNote:${orderId}`; const n = sessionStorage.getItem(k); if (n) { setNote(n); sessionStorage.removeItem(k); } } catch { /* fine */ }
  }, [orderId]);
  return (
    <>
      {id && <a className="btn" href={`/shop/archive/${id}?copy=1`} title="The job as Printavo had it: its files, messages and history">Printavo&apos;s copy</a>}
      {note && <span className="err" style={{ flexBasis: "100%" }}>{note}</span>}
    </>
  );
}
