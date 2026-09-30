import { NextResponse } from "next/server";
import { getViewer } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiState, askClaude } from "@/lib/ai/claude";

/**
 * "When can we print it?": the calendar works out three dates for a job that isn't booked yet (absolute soonest by
 * jumping the line, the next opening where nothing moves, and the regular turn) from the live schedule. Claude says
 * which one to promise and gives a line to tell the customer. It only advises: nothing is booked.
 */
export const maxDuration = 60;

export async function POST(req: Request) {
  const { user, isStaff } = await getViewer();
  if (!user || !isStaff) return NextResponse.json({ error: "Staff only." }, { status: 401 });
  const b = await req.json().catch(() => ({})) as Record<string, string>;
  const admin = createAdminClient();
  const st = await aiState(admin);
  if (!st.ready) return NextResponse.json({ off: true, reason: st.reason });
  const clip = (x: unknown) => String(x || "").slice(0, 600);
  const r = await askClaude<{ headline: string; pick: "soonest" | "aggressive" | "regular"; why: string; customerLine: string }>({
    task: "production_when",
    model: st.settings.assistant.ai.model || "claude-sonnet-5",
    maxTokens: 800,
    ctx: { by: user.email || "staff" },
    system: [
      "You are the production planner at FBS Print (screen printing, embroidery, heat press). Someone asks when a new job could be done.",
      "The scheduling software already worked out three options from the live schedule: absolute soonest (jumps the line, other jobs get pushed), aggressive (next opening, nothing moves), and regular turn.",
      "Recommend which date to promise. Default to the regular turn; recommend aggressive when the customer needs it sooner and it makes their date; recommend absolute soonest only when nothing else makes their date and no other job would miss its date (or say what it costs if some would). Never promise a date the options don't support.",
      "Be brief and concrete, like a note to a salesperson. The customer line is one friendly sentence they can say or send, with the date.",
    ].join("\n"),
    prompt: [`Now: ${clip(b.now)}`, `Job: ${clip(b.job)} (about ${clip(b.runTime)} of press time)`, b.needBy ? `Customer needs it by: ${clip(b.needBy)}` : "Customer didn't give a date.", `Absolute soonest: ${clip(b.soonest)}`, `Aggressive: ${clip(b.aggressive)}`, `Regular: ${clip(b.regular)}`].join("\n"),
    tool: {
      name: "promise",
      description: "Which date to promise and why.",
      input_schema: {
        type: "object",
        properties: {
          headline: { type: "string", description: "One sentence: the date to promise and the option, e.g. 'Promise Tue Oct 13 (regular turn).'" },
          pick: { type: "string", enum: ["soonest", "aggressive", "regular"] },
          why: { type: "string", description: "1-2 sentences: why this one, and what the faster options would cost." },
          customerLine: { type: "string", description: "One sentence for the customer with the date." },
        },
        required: ["headline", "pick", "why", "customerLine"],
      },
    },
  });
  if (!r.ok) return NextResponse.json({ error: r.error, off: r.off });
  return NextResponse.json(r.data);
}
