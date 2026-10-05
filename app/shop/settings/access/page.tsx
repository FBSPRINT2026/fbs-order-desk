"use client";
import { useEffect, useMemo, useState } from "react";
import SettingsTabs from "@/components/SettingsTabs";
import { createClient } from "@/lib/supabase/client";
import { accessOf, PERMS, permsFor, roleDefaults, ROLES, type Perms, type Role } from "@/lib/roles";
import { useRole } from "@/components/RoleContext";
import { saveAccess } from "@/app/shop/settings/access-actions";

type Person = { email: string; name: string; role: Role };

/**
 * Settings → User Access: what each person on the shop staff can see and do, like Printavo's user settings. Each
 * card starts from the person's role; switch single permissions on or off for that person, then Save.
 */
export default function AccessPage() {
  const sb = useMemo(() => createClient(), []);
  const { realRole } = useRole();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [edits, setEdits] = useState<Record<string, { role: Role; perms: Perms }>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  useEffect(() => {
    (async () => {
      const [{ data: st }, { data: sf }] = await Promise.all([sb.from("settings").select("data").eq("id", 1).maybeSingle(), sb.from("staff").select("email, name, role").order("name")]);
      const access = accessOf(st?.data);
      const ps = ((sf || []) as Person[]).map((p) => ({ ...p, email: p.email.toLowerCase(), role: (p.role || "admin") as Role }));
      ps.sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : (a.name || a.email).localeCompare(b.name || b.email)));
      setPeople(ps);
      setEdits(Object.fromEntries(ps.map((p) => [p.email, { role: p.role, perms: permsFor(p.role, access[p.email]) }])));
    })();
  }, [sb]);
  const canEdit = realRole === "owner" || realRole === "admin";
  const groups = [...new Set(PERMS.map((p) => p.group))];
  const initials = (p: Person) => ((p.name || p.email).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
  const hue = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  async function save(p: Person) {
    const e = edits[p.email]; if (!e) return;
    setBusy(p.email); setMsg((m) => ({ ...m, [p.email]: "" }));
    const r = await saveAccess(p.email, e.role, e.perms);
    setBusy("");
    setMsg((m) => ({ ...m, [p.email]: r.ok ? "Saved. Takes effect the next time they open a page." : r.error || "Couldn't save." }));
    if (r.ok) setPeople((ps) => (ps || []).map((x) => (x.email === p.email ? { ...x, role: e.role } : x)));
  }
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Settings</div><h1>User Access</h1></div></div>
      <SettingsTabs />
      <p className="faint" style={{ margin: "0 0 14px", maxWidth: 820 }}>What each person on the shop staff can see and do. Each person starts from their role (Owner and Admin: everything; Production, Receiving, Shipping: the work, no money); switch single things on or off for that person and Save. Owners always have everything. To see it the way they do, use View as on the Sign out line.</p>
      {!people ? <div className="empty">Loading…</div> : (
        <div className="ua-grid">
          {people.map((p) => {
            const e = edits[p.email]; if (!e) return null;
            const owner = e.role === "owner", def = roleDefaults(e.role), lock = !canEdit || owner || (p.role === "owner" && realRole !== "owner");
            const changed = PERMS.filter((x) => e.perms[x.k] !== def[x.k]).length;
            return (
              <section key={p.email} className="ua-card">
                <div className="ua-head">
                  <span className="ua-av" style={{ background: `hsl(${hue(p.email)} 55% 45%)` }}>{initials(p)}</span>
                  <span className="ua-who"><b>{p.name || p.email.split("@")[0]}</b><small>{p.email}</small></span>
                  <select value={e.role} disabled={!canEdit || (p.role === "owner" && realRole !== "owner")} aria-label={`Role for ${p.email}`}
                    onChange={(ev) => { const role = ev.target.value as Role; setEdits((m) => ({ ...m, [p.email]: { role, perms: permsFor(role) } })); }}>
                    {ROLES.filter((r) => r.v !== "owner" || realRole === "owner" || p.role === "owner").map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
                  </select>
                </div>
                {owner && <div className="ua-note">Owners always have everything.</div>}
                {groups.map((g) => (
                  <div key={g} className="ua-group">
                    <div className="ua-gh">{g}</div>
                    {PERMS.filter((x) => x.group === g).map((x) => (
                      <label key={x.k} className={"ua-perm" + (e.perms[x.k] !== def[x.k] ? " changed" : "")} title={e.perms[x.k] !== def[x.k] ? `Changed from the ${ROLES.find((r) => r.v === e.role)?.label} default` : undefined}>
                        <input type="checkbox" checked={e.perms[x.k]} disabled={lock} onChange={(ev) => setEdits((m) => ({ ...m, [p.email]: { ...e, perms: { ...e.perms, [x.k]: ev.target.checked } } }))} />
                        <span>{x.label}</span>
                      </label>
                    ))}
                  </div>
                ))}
                <div className="ua-foot">
                  {!lock && <button type="button" className="btn sm primary" disabled={busy === p.email} onClick={() => save(p)}>{busy === p.email ? "Saving…" : "Save"}</button>}
                  {!lock && changed > 0 && <button type="button" className="linkbtn" onClick={() => setEdits((m) => ({ ...m, [p.email]: { ...e, perms: roleDefaults(e.role) } }))}>Back to {ROLES.find((r) => r.v === e.role)?.label} defaults</button>}
                  {changed > 0 && <span className="faint">{changed} changed from the role</span>}
                  {msg[p.email] && <span className={msg[p.email].startsWith("Saved") ? "ok-note" : "pv-err"}>{msg[p.email]}</span>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
