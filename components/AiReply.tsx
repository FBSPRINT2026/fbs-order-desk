"use client";
import { replyBlocks } from "@/lib/replyLines";

/** An AI reply laid out to read at a glance: a gap between lines, each garment on its own line with its sizes under it
 *  (a size never split from its count). One piece for every AI chat bubble (Nov 1, Nick: "really easy to read"). */
export default function AiReply({ text }: { text: string }) {
  const bs = replyBlocks(text);
  if (!bs.length) return null;
  return (
    <div className="airp">
      {bs.map((b, i) => b.kind === "text"
        ? <p key={i} className={/\?$/.test(b.text) ? "airp-q" : undefined}>{b.text}</p>
        : <div key={i} className="airp-g">
            {b.name && <b>{b.name}</b>}
            <span className="airp-s">{b.sizes.map((s, j) => <span key={j}>{s}</span>)}</span>
          </div>)}
    </div>
  );
}
