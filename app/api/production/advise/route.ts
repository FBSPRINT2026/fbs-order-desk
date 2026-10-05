import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { viewerPerms } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";

/**
 * "Schedule too tight → Get Recommendations". The calendar works out the what-ifs itself (split jobs, an hour or two
 * of overtime a night, a Saturday shift, combinations) by re-running the planner, with the labor each costs. Claude
 * reads those numbers and the late jobs and says which to do and why, plus anything else worth trying. It only
 * recommends: nothing changes until someone clicks Apply on an option.
 */
export const maxDuration = 60;
type Opt = { id: string; title: string; detail: string; lateAfter: number; stillLate: string[]; addedHours: number; cost: number; splits: number };
type Late = { job: string; customer: string; inHands: string; why: string; value?: number };

export async function POST(req: Request) {
  const { user, isStaff, role, email, supabase } = await getViewer();
  const crew = !!user && isStaff && !(await viewerPerms(supabase, email, role)).money;
  if (!user || !isStaff) return NextResponse.json({ error: "Staff only." }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { now?: string; lateBefore?: number; late?: Late[]; options?: Opt[]; labor?: { crewSize: number; wage: number; otMultiplier: number }; machines?: string; overtime?: string };
  const opts = (body.options || []).slice(0, 14), late = (body.late || []).slice(0, 40);
  if (!opts.length) return NextResponse.json({ error: "Nothing to compare." }, { status: 400 });
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ off: true, reason: st.reason });
  const lb = body.labor;
  const prompt = [
    `Now: ${body.now || ""}. Machines in view: ${body.machines || "all"}.`,
    `Jobs that won't make their in-hands date on the current plan: ${body.lateBefore ?? late.length}.`,
    ...late.map((l) => `- ${l.job} ${l.customer} · in-hands ${l.inHands} · ${l.why}${l.value ? ` · order $${Math.round(l.value)}` : ""}`),
    "",
    body.overtime ? `Overtime already on the schedule this pay week (Friday–Thursday, past 40 paid hours): ${String(body.overtime).slice(0, 800)}. Extra hours for a crew already in overtime are all overtime; prefer adding time to crews that aren't.` : "No crew is in overtime yet this pay week (Friday–Thursday).",
    lb ? `Labor: crews of ${lb.crewSize} at about $${lb.wage}/hr; extra hours (overtime, Saturday) cost ${lb.otMultiplier}× that. A split job costs roughly 15 minutes of extra setup per extra run, done on regular time.` : "",
    "",
    "Options the planner simulated (each is a full re-plan with that change):",
    ...opts.map((o) => `[${o.id}] ${o.title}: ${o.detail}. Late after: ${o.lateAfter}${o.stillLate.length ? ` (${o.stillLate.join(", ")})` : ""}. Extra paid hours: ${o.addedHours}. Est. extra labor: $${Math.round(o.cost)}. Split jobs: ${o.splits}.`),
  ].join("\n");
  const r = await askClaude<{ headline: string; pick: string; why: string; runnersUp?: { id: string; why: string }[]; ideas?: string[] }>({
    task: "production_advise",
    model: st.settings.assistant.ai.model || "claude-sonnet-5",
    maxTokens: 1500,
    ctx: { by: user.email || "staff" },
    system: [
      "You are the production planner at FBS Print, a screen printing and embroidery shop. The schedule is too tight: some jobs won't be done by their in-hands dates.",
      "You get the late jobs and a set of options the scheduling software already simulated, each with how many jobs would still be late and what it costs in extra labor.",
      "Recommend the option that gets everything (or the most important jobs) done for the least money and disruption. Prefer: splitting when it clears the late jobs cheaply; a little overtime over a Saturday when it's enough; a Saturday when several nights of overtime would be needed. Missing an in-hands date is usually worse than a few hundred dollars of overtime. If nothing clears everything, say which jobs are still at risk and what to do about them (call the customer about a new date, partial ship, outsource, move a flexible job).",
      "Use only the numbers given; don't invent jobs or costs. Refer to options by their plain title, not their id, in the text. Be short and direct, like a note to the owner.",
      crew ? "This note goes to the production manager, who doesn't see money: weigh the costs, but never write dollar amounts, wages or order values; say 'cheapest' or 'about N extra hours' instead." : "",
    ].join("\n"),
    prompt,
    tool: {
      name: "recommendation",
      description: "Which option to take and why.",
      input_schema: {
        type: "object",
        properties: {
          headline: { type: "string", description: "One sentence: what to do, e.g. 'Run Miguel and Ana an hour late Wed–Fri (~$460): everything ships on time.'" },
          pick: { type: "string", description: "The id of the recommended option." },
          why: { type: "string", description: "2–3 sentences on why this over the others (cost, how many jobs saved, risk)." },
          runnersUp: { type: "array", items: { type: "object", properties: { id: { type: "string" }, why: { type: "string" } }, required: ["id", "why"] }, description: "Up to 2 good alternatives and when to pick them." },
          ideas: { type: "array", items: { type: "string" }, description: "Up to 3 other things worth doing that the options don't cover (call a customer, partial ship, move a job, outsource)." },
        },
        required: ["headline", "pick", "why"],
      },
    },
  });
  if (!r.ok) return NextResponse.json({ error: r.error, off: r.off });
  return NextResponse.json({ ...r.data, model: r.model });
}
