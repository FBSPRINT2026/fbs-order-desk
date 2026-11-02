import type { JobStep } from "@/lib/portalJobs";

/**
 * Where an order is, as a segmented line with the words under it (Nov 2, Nick: option C-2 "make it match our rainbow"):
 * each finished step fills with its slice of the FBS rainbow, so a completed order shows the whole bar; the step it's on
 * is a little thicker with an outline; on hold, that step is red and says so. One piece for the home page's jobs and the
 * order page (lib/portalJobs.ts jobFor makes the steps), so the two always agree.
 */
export default function OrderRail({ steps, hold = false, done = false }: { steps: JobStep[]; hold?: boolean; done?: boolean }) {
  const n = steps.length;
  return (
    <ol className={"orl" + (hold ? " held" : "") + (done ? " all" : "")} aria-label={steps.map((s) => `${s.label}${s.state === "done" || done ? " done" : s.state === "cur" ? hold ? " (on hold)" : " (now)" : ""}`).join(", ")}>
      {steps.map((s, i) => {
        const st = done ? "done" : s.state;
        return (
          <li key={s.key + i} className={"orl-s " + st} style={{ ["--n" as string]: n, ["--i" as string]: i }} title={s.sub ? `${s.label}: ${s.sub}` : s.label}>
            <i aria-hidden />
            <span>{st === "cur" && hold ? "On hold" : s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
