import type { JobStep } from "@/lib/portalJobs";

const PATHS: Record<string, string> = {
  check: "M5 12l4 4 10-10",
  placed: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
  art: "M4 20l4-1 11-11-3-3L5 16zM14 7l3 3",
  goods: "M8 3L3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.7-2 3-4 3S8.5 4.7 8 3z",
  print: "M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z",
  ready: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  ship: "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01",
};

/**
 * Where an order is (Nov 2, Nick: "make it a smooth rainbow from start to finish… whichever section it's on gets the
 * symbols that we had before"): one bar, the FBS rainbow filled up to the step it's on, that step's icon sitting on the
 * bar, the step names under it, never cut off. On hold isn't a step: the line keeps showing where the job is, and the page
 * shows the ON HOLD stamp by its button. One piece for the home page's jobs and the order page (steps from
 * lib/portalJobs.ts jobFor), so the two always agree.
 */
export default function OrderRail({ steps, done = false }: { steps: JobStep[]; done?: boolean }) {
  const n = steps.length;
  const cur = done ? n - 1 : Math.max(0, steps.findIndex((s) => s.state === "cur") >= 0 ? steps.findIndex((s) => s.state === "cur") : steps.filter((s) => s.state === "done").length);
  const at = Math.min(cur, n - 1);
  const pct = n > 1 ? (at / (n - 1)) * 100 : 100;
  // the marker takes the rainbow's color where it sits: blue at the start, salmon in the middle, orange at the end
  const mk = pct <= 52 ? `color-mix(in srgb, var(--fbs-salmon) ${Math.round((pct / 52) * 100)}%, var(--fbs-blue))` : `color-mix(in srgb, var(--fbs-orange) ${Math.round(((pct - 52) / 48) * 100)}%, var(--fbs-salmon))`;
  const icon = at === n - 1 ? "check" : steps[at]?.key === "ship" ? "ship" : steps[at]?.key || "placed";
  return (
    <div className="orl" style={{ ["--n" as string]: n, ["--p" as string]: `${pct}%`, ["--mk" as string]: mk }} aria-label={steps.map((s, i) => `${s.label}${i < at || done ? " done" : i === at ? " (now)" : ""}`).join(", ")}>
      <div className="orl-bar" aria-hidden>
        <span className="orl-fill" />
        {/* the quote sign at the start and the check at the end are always there; the step it's on shows its own sign
            where it sits (Nov 2, Nick) */}
        {at > 0 && <span className="orl-end s"><svg viewBox="0 0 24 24"><path d={PATHS.placed} /></svg></span>}
        {at < n - 1 && <span className="orl-end e"><svg viewBox="0 0 24 24"><path d={PATHS.check} /></svg></span>}
        <span className="orl-mk"><svg viewBox="0 0 24 24"><path d={PATHS[icon] || PATHS.placed} /></svg></span>
      </div>
      <ol className="orl-lb">{steps.map((s, i) => <li key={s.key + i} className={i < at || done ? "done" : i === at ? "cur" : ""} title={s.sub ? `${s.label}: ${s.sub}` : s.label}>{s.label}</li>)}</ol>
    </div>
  );
}
