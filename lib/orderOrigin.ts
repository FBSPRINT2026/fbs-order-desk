import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where an order came from, word for word (Nick, Nov 16 2026, option A: "I can't see where he originally submitted the
 * order"): every way the customer sent it in, oldest first: the job they made on their ClickUp board (its description,
 * files and comments), their portal order, and the emails and texts they wrote about it (activities linked to the order).
 * Shown on the order's "Where it came from" tab beside the Job Center's own view of the job.
 */
export type OriginFile = { name: string; href: string; size: number };
export type OriginItem = {
  kind: "clickup" | "portal" | "email" | "text" | "other";
  /** "ClickUp job · Cart Orders", "Email", "Portal order" */ label: string;
  who: string; whoEmail: string; at: string; subject: string; text: string;
  files: OriginFile[];
  /** where the original lives (the ClickUp job) */ link: string | null;
  notes: { who: string; at: string; text: string }[];
};

const fileHref = (f: { path?: string; url?: string; name?: string }) => f.path ? `/api/files/open?${new URLSearchParams({ p: f.path, n: f.name || "file" })}` : String(f.url || "");

/** an email's own words: the quoted reply under it and the signature's sign-off lines left out */
export function ownWords(body: string) {
  const lines = String(body || "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l) || /^--\s*$/.test(l)) break;
    // a picture they pasted in shows as a file under the text
    if (/^\s*\[image:[^\]]*\]\s*$/i.test(l)) continue;
    if (/^\s*On .{6,200}wrote:\s*$/i.test(l) || /^\s*-{2,}\s*Original Message/i.test(l) || (/^\s*From:\s.+/i.test(l) && out.length > 1)) break;
    // "On Tue, Nov 3, 2026 at 4:03 PM Matthew … <x@y>" with "wrote:" on the next line
    if (/^\s*(\S+\s+)?wrote:\s*$/i.test(l) && out.length && /^\s*On\s/i.test(out[out.length - 1])) { out.pop(); break; }
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function orderOrigin(admin: SupabaseClient, orderId: string, number: number): Promise<OriginItem[]> {
  const [{ data: cu }, { data: acts }] = await Promise.all([
    admin.from("clickup_tasks").select("id, name, url, where_text, creator_name, creator_email, created_at_cu, description, attachments, comments, team_id")
      .or(`order_id.eq.${orderId}${number > 0 ? `,order_number.eq.${Math.floor(number)}` : ""}`).limit(5),
    admin.from("activities").select("id, kind, direction, subject, body, from_email, occurred_at, meta")
      .eq("order_id", orderId).eq("direction", "in").order("occurred_at").order("id").limit(40),
  ]);
  const items: OriginItem[] = [];
  const shown = new Set<string>();
  for (const t of (cu || []) as { id: string; name: string; url: string; where_text: string | null; creator_name: string | null; creator_email: string | null; created_at_cu: string | null; description: string | null; attachments: { name: string; path?: string; url?: string; size?: number }[] | null; comments: { who: string; email: string; at: string; text: string }[] | null }[]) {
    const files = (t.attachments || []).map((f) => { if (f.path) shown.add(f.path); return { name: f.name, href: fileHref(f), size: Number(f.size || 0) }; }).filter((f) => f.href);
    items.push({
      kind: "clickup", label: `ClickUp job${t.where_text ? ` · ${t.where_text}` : ""}`, who: t.creator_name || "", whoEmail: t.creator_email || "",
      at: t.created_at_cu || "", subject: t.name || "", text: String(t.description || "").trim(), files, link: t.url || null,
      notes: (t.comments || []).filter((c) => c.text?.trim()).map((c) => ({ who: c.who || c.email || "", at: c.at, text: c.text.trim() })),
    });
  }
  for (const a of (acts || []) as { id: string; kind: string; subject: string | null; body: string | null; from_email: string | null; occurred_at: string; meta: Record<string, unknown> | null }[]) {
    const m = a.meta || {};
    const att = (Array.isArray(m.attachments) ? m.attachments : []) as { name?: string; path?: string; url?: string; size?: number; type?: string }[];
    // pictures pasted into an email's signature: not something they sent
    const real = att.filter((f) => !(f.type || "").startsWith("image/") || Number(f.size || 0) > 40_000 || !/^image\d+\./i.test(f.name || ""));
    const fresh = real.filter((f) => !f.path || !shown.has(f.path));
    const kind: OriginItem["kind"] = a.kind === "email" ? "email" : a.kind === "portal" ? "portal" : a.kind === "sms" || a.kind === "text" ? "text" : "other";
    const text = kind === "email" ? ownWords(a.body || "") : String(a.body || "").trim();
    // the portal's note for a job brought in from ClickUp says nothing the ClickUp job doesn't (same files, made then)
    if (kind === "portal" && real.length && !fresh.length && items.some((x) => x.kind === "clickup")) continue;
    for (const f of fresh) if (f.path) shown.add(f.path);
    items.push({
      kind, label: kind === "email" ? "Email" : kind === "portal" ? "Portal order" : kind === "text" ? "Text" : a.kind,
      who: String(m.from_name || "") || (a.from_email || "").split("@")[0], whoEmail: a.from_email || "", at: a.occurred_at,
      subject: a.subject || "", text, files: fresh.map((f) => ({ name: f.name || "file", href: fileHref(f), size: Number(f.size || 0) })).filter((f) => f.href), link: null, notes: [],
    });
  }
  return items.sort((x, y) => (x.at || "").localeCompare(y.at || ""));
}
