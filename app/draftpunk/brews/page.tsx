import Link from "next/link";
import { requireBrewer } from "@/lib/draftpunk/server";
import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/draftpunk/Shell";
import { fmtDate } from "@/lib/draftpunk/defaults";

export const dynamic = "force-dynamic";

type Row = { id: string; brewed_on: string; name: string; color?: string; ferment?: { name: string }[];
  measured: { og?: number; fg?: number; autopilot?: { on: boolean; stage: number }; alarms?: { text: string }[] }; tasting: { rating?: number } };

/** every brew session, newest first: what's fermenting now (with its step and any alarm) on top */
export default async function Brews() {
  const { brewer, userId } = await requireBrewer();
  const sb = await createClient();
  const { data } = await sb.from("dp_brews").select("id, brewed_on, recipe_snapshot->name, recipe_snapshot->ferment, measured, tasting").eq("owner_id", userId).order("brewed_on", { ascending: false });
  const rows = (data || []) as unknown as Row[];
  const live = rows.filter((b) => b.measured?.autopilot?.on || (!b.measured?.fg && Date.now() - new Date(b.brewed_on).getTime() < 30 * 86400000));
  const done = rows.filter((b) => !live.includes(b));
  const card = (b: Row) => {
    const step = b.measured?.autopilot?.on ? b.ferment?.[b.measured.autopilot.stage]?.name : undefined;
    const abv = b.measured?.og && b.measured?.fg ? ((b.measured.og - b.measured.fg) * 131.25).toFixed(1) : null;
    return (
      <Link key={b.id} href={`/draftpunk/brews/${b.id}`} className="dp-card dp-bcard">
        <div>
          <h3>{b.name || "Brew"}</h3>
          <div className="dp-dim" style={{ fontSize: 13 }}>Brewed {fmtDate(b.brewed_on)}{step ? ` · ${step}` : ""}</div>
          {!!b.measured?.alarms?.length && <div className="dp-note">{b.measured.alarms[0].text}</div>}
        </div>
        <div className="dp-rnums">
          <span><b>{b.measured?.og?.toFixed(3) || "–"}</b>OG</span>
          <span><b>{b.measured?.fg?.toFixed(3) || "–"}</b>FG</span>
          <span><b>{abv ? `${abv}%` : "–"}</b>ABV</span>
          {!!b.tasting?.rating && <span><b>{"★".repeat(Math.round(b.tasting.rating))}</b>Rating</span>}
        </div>
      </Link>
    );
  };
  return (
    <Shell name={brewer.name}>
      <h1 className="dp-h1">Brew log</h1>
      {!rows.length && <section className="dp-card dp-empty"><h2 className="dp-card-t">No brews logged yet</h2><p className="dp-dim" style={{ margin: 0 }}>Open a recipe, go to Brew day, and press Start a brew log.</p></section>}
      {!!live.length && <><h2 className="dp-h2">Fermenting now</h2><div className="dp-cards" style={{ marginBottom: 22 }}>{live.map(card)}</div></>}
      {!!done.length && <><h2 className="dp-h2">Earlier</h2><div className="dp-cards">{done.map(card)}</div></>}
    </Shell>
  );
}
