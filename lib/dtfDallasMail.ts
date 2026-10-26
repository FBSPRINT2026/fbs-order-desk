import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * DTF Dallas's emails, matched to our gang sheets (Oct 26, Nick: "if they don't [have an API]… we're going to monitor
 * the emails. And then when they send us an order confirmation, you will automatically add that order number back into
 * the production notes, like, hey, this gang sheet is coming. It's this order number… what day is expected").
 *
 * Their emails ("Order #180497 confirmed" with "Estimated delivery Tuesday, Oct 20" and "DTF Transfer Gang Sheets × 1
 * 22x100"; "A package from order #180497 is ready for pickup"; "Order #180391 has been canceled") come into a mailbox
 * the portal already copies (mail_cache). A confirmation goes to the gang sheet that was ordered (or downloaded) last
 * before it, of the same length when the email says one; then each job on the sheet gets a line in its production
 * notes. Pickup and cancel emails add their line to the same jobs. Each email is used once (the sheet keeps its ids).
 */
type Sheet = { id: string; name: string; owner: string; status: string; ordered_at: string | null; updated_at: string; supplier_order: string | null; data: { logos?: { job?: string }[]; /** the builder now keeps jobs here */ jobs?: { job?: string }[]; files?: { length: number; at: string }[]; dtfMail?: string[] } };
const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" });

export async function checkDtfDallas(admin: SupabaseClient): Promise<{ matched: number; notes: number }> {
  const since = new Date(Date.now() - 10 * 86400000).toISOString();
  const { data: mails } = await admin.from("mail_cache").select("message_id, subject, sent_at, body_text").ilike("from_email", "%@dtfdallas.com").gte("sent_at", since).order("sent_at", { ascending: true }).limit(60);
  if (!mails?.length) return { matched: 0, notes: 0 };
  const { data: rows } = await admin.from("gang_sheets").select("id, name, owner, status, ordered_at, updated_at, supplier_order, data").is("archived_at", null).gte("updated_at", new Date(Date.now() - 30 * 86400000).toISOString());
  const sheets = (rows || []) as Sheet[];
  let matched = 0, notes = 0;
  const seen = new Set(sheets.flatMap((s) => s.data?.dtfMail || []));
  for (const m of mails as { message_id: string | null; subject: string | null; sent_at: string; body_text: string | null }[]) {
    const id = m.message_id || `${m.subject}|${m.sent_at}`;
    if (seen.has(id)) continue;
    const subj = m.subject || "", body = (m.body_text || "").replace(/\(\s*https?:\/\/[^)]*\)/g, "").replace(/\s+/g, " ");
    const num = (subj.match(/order #?\s*(\d{4,})/i) || body.match(/order #?\s*(\d{4,})/i))?.[1];
    if (!num) continue;
    const at = new Date(m.sent_at);
    let sheet = sheets.find((s) => s.supplier_order === num);
    let line = "";
    if (/confirmed/i.test(subj) && !/^re:/i.test(subj) && !sheet) {
      // the sheet it's for: ordered (or downloaded) in the two days before, the same length when the email says one
      const len = +(body.match(/\b22\s*x\s*(\d{2,4})\b/i)?.[1] || 0);
      const when = (s: Sheet) => new Date(s.ordered_at || s.data?.files?.[s.data.files.length - 1]?.at || s.updated_at).getTime();
      const cands = sheets.filter((s) => !s.supplier_order && (s.status === "ordered" || (s.data?.files || []).length) && when(s) <= at.getTime() + 5 * 60000 && at.getTime() - when(s) < 2 * 86400000);
      const fit = cands.filter((s) => !len || (s.data?.files || []).some((f) => f.length === len) || s.status === "ordered");
      sheet = (fit.length ? fit : cands).sort((a, b) => when(b) - when(a))[0];
      if (!sheet) continue;
      const est = body.match(/estimated delivery\s+([A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2})/i)?.[1] || "";
      const pickup = /ready for pickup/i.test(body) || /pickup\s+\$0/i.test(body);
      await admin.from("gang_sheets").update({ supplier_order: num, expected: est ? `${pickup ? "Pickup" : "Delivery"} ${est}` : null, status: "ordered", ordered_at: sheet.ordered_at || m.sent_at }).eq("id", sheet.id);
      sheet.supplier_order = num;
      line = `DTF transfers coming: DTF Dallas order #${num}${len ? `, gang sheet 22×${len}` : ""} ("${sheet.name}")${est ? `, ${pickup ? "pickup" : "delivery"} ${est}` : ""} (confirmed ${day(at)}).`;
      matched++;
    } else if (sheet && /ready for pickup/i.test(subj)) line = `DTF Dallas order #${num} is ready for pickup (${day(at)}).`;
    else if (sheet && /cancel/i.test(subj)) line = `DTF Dallas order #${num} was canceled (${day(at)}): reorder the gang sheet "${sheet.name}".`;
    else if (sheet && /shipped|on its way|tracking/i.test(subj)) line = `DTF Dallas order #${num} shipped (${day(at)}).`;
    if (!sheet || !line) continue;
    // each job on the sheet: the line in its production notes
    const jobs = [...new Set([...(sheet.data?.jobs || []), ...(sheet.data?.logos || [])].map((l) => String(l.job || "").replace(/\D/g, "")).filter(Boolean))].map(Number);
    if (jobs.length) {
      const { data: os } = await admin.from("orders").select("id, number").in("number", jobs);
      for (const o of (os || []) as { id: string; number: number }[]) {
        const { data: inn } = await admin.from("order_internal").select("production_notes").eq("order_id", o.id).maybeSingle();
        const pn = String(inn?.production_notes || "").trim();
        if (pn.includes(line)) continue;
        await admin.from("order_internal").upsert({ order_id: o.id, production_notes: [pn, line].filter(Boolean).join("\n").slice(-8000) });
        await admin.from("order_events").insert({ order_id: o.id, kind: "note", detail: line.slice(0, 500), actor: "dtf-dallas-mail" });
        notes++;
      }
    }
    // the sheet as it is now (someone may be adding to it), with this email marked used
    const { data: fresh } = await admin.from("gang_sheets").select("data").eq("id", sheet.id).maybeSingle();
    const cur = ((fresh?.data || sheet.data || {}) as Sheet["data"]);
    sheet.data = { ...cur, dtfMail: [...(cur.dtfMail || []), id].slice(-50) };
    await admin.from("gang_sheets").update({ data: sheet.data }).eq("id", sheet.id);
    seen.add(id);
  }
  return { matched, notes };
}
