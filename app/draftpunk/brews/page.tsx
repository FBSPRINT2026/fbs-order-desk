import Link from "next/link";
import { requireBrewer } from "@/lib/draftpunk/server";
import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/draftpunk/Shell";
import { fmtDate } from "@/lib/draftpunk/defaults";

export const dynamic = "force-dynamic";

/** every brew session the brewer has logged, newest first */
export default async function Brews() {
  const { brewer, userId } = await requireBrewer();
  const sb = await createClient();
  const { data } = await sb.from("dp_brews").select("id, brewed_on, recipe_snapshot->name, measured, tasting").eq("owner_id", userId).order("brewed_on", { ascending: false });
  const rows = (data || []) as unknown as { id: string; brewed_on: string; name: string; measured: { og?: number; fg?: number }; tasting: { rating?: number } }[];
  return (
    <Shell name={brewer.name}>
      <h1 className="dp-h1">C:\DRAFTPUNK\BREWLOG&gt;<span className="dp-blink">_</span></h1>
      <div className="dp-win">
        <span className="dp-wt">BREW SESSIONS ({rows.length})</span>
        {!rows.length ? <p>NO BREWS LOGGED YET. OPEN A RECIPE, GO TO BREW DAY, AND PRESS START A BREW LOG.</p> : (
          <table className="dp-tbl">
            <thead><tr><th>DATE</th><th>RECIPE</th><th className="dp-num">OG</th><th className="dp-num">FG</th><th className="dp-num">ABV</th><th>RATING</th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td><Link href={`/draftpunk/brews/${b.id}`}>{fmtDate(b.brewed_on)}</Link></td>
                  <td><Link href={`/draftpunk/brews/${b.id}`}>{b.name || "(recipe)"}</Link></td>
                  <td className="dp-num">{b.measured?.og?.toFixed(3) || "-"}</td>
                  <td className="dp-num">{b.measured?.fg?.toFixed(3) || "-"}</td>
                  <td className="dp-num">{b.measured?.og && b.measured?.fg ? `${((b.measured.og - b.measured.fg) * 131.25).toFixed(1)}%` : "-"}</td>
                  <td>{b.tasting?.rating ? "★".repeat(Math.round(b.tasting.rating)) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
