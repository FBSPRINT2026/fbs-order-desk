"use client";
import { useState } from "react";
import SewoutCapture from "@/components/SewoutCapture";

/** the phone side of the computer's sew-out QR code: the one sew-out tool, uploading with the link (components/SewoutCapture.tsx) */
export default function SnapSewout({ id, orderId, imprintId }: { id: string; orderId: string; imprintId: string }) {
  const [msg, setMsg] = useState("");
  return (
    <div className="snap-acts">
      {msg && <div className="pv-err sow-msg">{msg} You can close this page, or take another.</div>}
      <SewoutCapture orderId={orderId} imprintId={imprintId} snapId={id} label={msg ? "Take another photo" : "Take the photo"} onDone={setMsg} />
    </div>
  );
}
