/** The round Printavo "P" (the same one as on ClickUp Jobs): this order came from Printavo, our old system, and is read-only.
 *  Used instead of the word "Archived" on order lists (Oct 26, Nick). */
export default function PrintavoMark({ className = "" }: { className?: string }) {
  return <span className={"cu-sys pv pv-mark " + className} title="From Printavo, our old system (read-only)" aria-label="From Printavo"><img src="/brand/printavo-p.png" alt="" /></span>;
}
