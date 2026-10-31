import { createAdminClient } from "@/lib/supabase/admin";
import { allRows } from "@/lib/readAll";

export const dynamic = "force-dynamic";

/**
 * A person's private calendar (My Day → Calendar → Add to your phone): their appointments only. Jobs stay in the
 * portal (Oct 26, Nick: "I have… thousands of jobs due every year. I don't need a reminder on my phone for that"). Phones and Outlook subscribe to this link and check it for changes every so often.
 * The token in the link is the only key, so it's long and random; a new one can be made if it's ever shared.
 */
const esc = (s: string) => (s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dayStr = (d: string) => d.replace(/-/g, "");
const nextDay = (d: string) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10).replace(/-/g, ""); };
// lines over 75 octets are folded (RFC 5545)
const fold = (l: string) => { const out: string[] = []; let s = l; while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); } out.push(s); return out.join("\r\n"); };

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: f } = await admin.from("cal_feeds").select("owner, shop").eq("token", String(token || "")).maybeSingle();
  if (!f) return new Response("Not found", { status: 404 });
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const [{ data: evs }, { data: who }, shop] = await Promise.all([
    allRows((r0, r1) => admin.from("events").select("id, title, notes, place, starts_at, ends_at, day, all_day, created_at").eq("owner", f.owner).eq("status", "added").gte("day", since).order("id").range(r0, r1), 2000),
    admin.from("staff").select("name").eq("email", f.owner).maybeSingle(),
    false ? allRows((r0, r1) => admin.from("orders").select("id, number, nickname, due_date, status, customers(company, name)").gte("due_date", since).not("status", "in", "(quote,quote_sent,request)").order("id").range(r0, r1), 2000) : Promise.resolve({ data: [] }),
  ]);
  const stamp = utc(new Date().toISOString());
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://portal.fbsprint.com").replace(/\/$/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FBS Print//My Day//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(`FBS · ${who?.name || f.owner.split("@")[0]}`)}`, "X-WR-TIMEZONE:America/Chicago", "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"];
  for (const e of (evs || []) as { id: string; title: string; notes: string; place: string; starts_at: string | null; ends_at: string | null; day: string | null; all_day: boolean }[]) {
    if (!e.day && !e.starts_at) continue;
    lines.push("BEGIN:VEVENT", `UID:${e.id}@fbsprint.com`, `DTSTAMP:${stamp}`);
    if (e.all_day || !e.starts_at) lines.push(`DTSTART;VALUE=DATE:${dayStr(e.day!)}`, `DTEND;VALUE=DATE:${nextDay(e.day!)}`);
    else lines.push(`DTSTART:${utc(e.starts_at)}`, `DTEND:${utc(e.ends_at || new Date(Date.parse(e.starts_at) + 3600e3).toISOString())}`, "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, "TRIGGER:-PT1H", "END:VALARM");
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.place) lines.push(`LOCATION:${esc(e.place)}`);
    if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
    lines.push("END:VEVENT");
  }
  for (const o of ((shop as { data: unknown[] | null }).data || []) as { id: string; number: number; nickname: string; due_date: string; status: string; customers: { company: string | null; name: string | null } | null }[]) {
    if (!o.due_date) continue;
    const c = o.customers?.company || o.customers?.name || "";
    lines.push("BEGIN:VEVENT", `UID:order-${o.id}@fbsprint.com`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${dayStr(o.due_date)}`, `DTEND;VALUE=DATE:${nextDay(o.due_date)}`,
      `SUMMARY:${esc(`${o.status === "completed" ? "✓ " : ""}Due #${o.number} ${c}${o.nickname ? ` – ${o.nickname}` : ""}`)}`, `URL:${site}/shop/orders/${o.id}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.map(fold).join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": 'inline; filename="fbs.ics"' } });
}
