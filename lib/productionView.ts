import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orderGroups, type Imprint, type Order } from "@/lib/pricing";
import { oldJobText } from "@/lib/ai/oldJobNotes";
import { defaultLayout, mergeProduction, validLayout } from "@/lib/production";
import { autoSetup, type SetupPlate } from "@/lib/pressSetup";
import { colorHex } from "@/lib/inkColors";

/**
 * The production view of one order (Oct 21, Nick: "one big view of the job… the mockup, the color selections, the
 * size, a place for production to confirm, the press setup, the separations in black and white… photos"). For Nick
 * (owner) and Jose (production) only. It follows the order's normal flow, never skips it: each part opens when its
 * step has happened (separations requested → film made → film checked → on press → printed), and at the end
 * "Confirm & save as printed" makes this the record every later reorder copies.
 */
export const PROD_ROLES = ["owner", "production"];
export const STEPS = ["Order", "Mockup", "Separations requested", "Film made", "Film checked", "On press", "Printed"] as const;

export type PvPlate = { name: string; hex: string; mesh: string; coverage: number | null; url: string };
export type PvHead = { what: string; name: string; hex: string; mesh: string };
export type PvPrint = {
  id: string; groupId: string; group: string; location: string; method: string; screen: boolean;
  colors: number; inks: string; size: string; drop: string; underbase: "" | "yes" | "no"; notes: string;
  confirm: Imprint["confirm"] | null; confirmed: Imprint["confirmed"] | null; film: Imprint["film"] | null;
  sep: { id: string; number: number; status: string; plates: PvPlate[] } | null;
  press: { press: string; pressId?: string; heads: PvHead[]; asPrinted: boolean } | null;
  minutes: { setup: number; run: number };
  /** the print's art (the customer design's picture), to compare films against */ art: string; design: string;
  /** the art's own colors (the design's print plan) and how they map to screens (imprint.inkMap) */
  plan: { hex: string; name: string }[]; inkMap: Record<string, { name: string; hex: string; mix?: string }>; sizeFrom: string;
  /** what production confirmed on earlier orders of this design (designs.specs), newest first */
  last: { orderId: string; number: number; at: string; by: string; size: string; drop: string; inks: string; colors: number; underbase?: boolean; garment?: string; notes?: string; job?: string; location: string }[];
};
export type ProductionView = {
  order: { id: string; number: number; nickname: string; status: string; due: string | null; customer: string; customerId: string; qty: number; reorderOf: string };
  groups: { id: string; name: string; lines: string[]; mockups: { title: string; thumb: string; full: string }[] }[];
  prints: PvPrint[];
  step: number; done: boolean[]; why: string[];
  films: { name: string; url: string; path: string }[];
  history: { kind: string; when: string; title: string; text: string }[];
  /** the shop's screen presses, for the press setup */ presses: { id: string; name: string; heads: number }[];
  productionNotes: string;
};

const SIGN = 3600;

export async function productionView(admin: SupabaseClient, orderId: string): Promise<ProductionView | null> {
  const { data: o } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!o) return null;
  const order = o as Order & { number: number; nickname: string; status: string; due_date: string | null; customer_id: string };
  const groups = orderGroups(order);
  const [{ data: cust }, { data: mks }, { data: seps }, { data: acts }, { data: slots }, { data: times }, { data: inn }, { data: ev }, { data: files }] = await Promise.all([
    admin.from("customers").select("company, name").eq("id", order.customer_id).maybeSingle(),
    admin.from("mockups").select("title, file_path, group_id, created_at").eq("order_id", orderId).is("archived_at", null).order("created_at"),
    admin.from("separations").select("id, number, imprint_id, location, status, channels, settings").eq("order_id", orderId).neq("status", "cancelled"),
    admin.from("press_actuals").select("separation_id, location, press_id, press_name, heads, created_at").eq("order_id", orderId).order("created_at", { ascending: false }),
    admin.from("production_slots").select("status, machine").eq("order_id", orderId),
    admin.from("job_time").select("task, started_at, ended_at, voided").eq("order_id", orderId).eq("voided", false),
    admin.from("order_internal").select("production_notes").eq("order_id", orderId).maybeSingle(),
    admin.from("order_events").select("kind, detail, created_at").eq("order_id", orderId).order("created_at"),
    admin.from("art_files").select("name, file_path, category").eq("order_id", orderId).order("created_at"),
  ]);
  const dIds = [...new Set(groups.flatMap((g) => g.imprints.map((i) => i.design_id || "")).filter(Boolean))];
  const { data: dsgs } = dIds.length ? await admin.from("designs").select("id, name, preview_path, file_path, print_plan, specs").in("id", dIds) : { data: [] as { id: string; name: string; preview_path: string | null; file_path: string; print_plan: unknown; specs: unknown }[] };
  const artPath = (d?: { preview_path: string | null; file_path: string }) => (d ? (d.preview_path || (/\.(png|jpe?g|webp|gif)$/i.test(d.file_path) ? d.file_path : "")) : "");

  // pictures: one signing call
  const paths = new Set<string>();
  for (const m of mks || []) { paths.add(m.file_path); paths.add(String(m.file_path).replace(/\.png$/, "-thumb.png")); }
  for (const s of seps || []) for (const c of ((s.channels || []) as { file?: string }[])) if (c.file) paths.add(c.file);
  const filmFiles = (files || []).filter((f) => f.category === "film" || /^Film:/i.test(String(f.name || "")));
  for (const f of filmFiles) paths.add(f.file_path);
  for (const d of dsgs || []) { const p = artPath(d); if (p) paths.add(p); }
  for (const g of groups) for (const im of g.imprints) for (const f of im.film?.files || []) paths.add(f.path);
  const signed = new Map<string, string>();
  const list = [...paths].filter(Boolean);
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    const { data } = await admin.storage.from("proofs").createSignedUrls(part, SIGN);
    (data || []).forEach((d, j) => { if (d.signedUrl) signed.set(part[j], d.signedUrl); });
  }

  const { data: stRow } = await admin.from("settings").select("data").eq("id", 1).maybeSingle();
  const machines = mergeProduction((stRow?.data as { production?: unknown } | null)?.production).machines.filter((x) => x.type === "screen" && x.active !== false);
  const nHeads = (x: (typeof machines)[number]) => x.colors || x.heads || 0;
  const slotMachine = ((slots || []) as { machine?: string }[]).map((x) => String(x.machine || "")).find(Boolean) || "";
  // press time per location (the phone's timer: "Setup · Full Front" / "Run · Full Front")
  const mins = new Map<string, { setup: number; run: number }>();
  for (const t of (times || []) as { task: string; started_at: string; ended_at: string | null }[]) {
    const [phase, ...rest] = String(t.task || "").split(" · ");
    const loc = rest.join(" · ") || "Whole job";
    const m = Math.max(0, ((t.ended_at ? new Date(t.ended_at) : new Date()).getTime() - new Date(t.started_at).getTime()) / 60000);
    const cur = mins.get(loc) || { setup: 0, run: 0 };
    if (/^setup/i.test(phase)) cur.setup += m; else if (/^run/i.test(phase)) cur.run += m;
    mins.set(loc, cur);
  }

  const prints: PvPrint[] = [];
  for (const g of groups) for (const im of g.imprints) {
    const screen = (im.method || "screen") === "screen";
    const s = (seps || []).find((x) => x.imprint_id === im.id);
    const chans = ((s?.channels || []) as { name?: string; hex?: string; mesh?: number | string; coverage?: number; file?: string; order?: number }[]).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const act = (acts || []).find((a) => (s && a.separation_id === s.id) || (!s && a.location === im.location));
    const setup = (s?.settings as { pressSetup?: { heads?: string[] } } | null)?.pressSetup;
    let press: PvPrint["press"] = null;
    if (act) press = { press: String(act.press_name || ""), pressId: String(act.press_id || ""), heads: ((act.heads || []) as PvHead[]).map((h) => ({ what: h.what, name: h.name || "", hex: h.hex || "", mesh: String(h.mesh || "") })), asPrinted: true };
    else if (!setup?.heads?.length && screen && (im.inks || "").trim()) {
      // no separation (film on file or in the drawer, Oct 21: The Bottles): laid out from the print's own screens, on the
      // press it's scheduled on, else the smallest press that fits
      const names = (im.inks || "").split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
      const hexOf = (n: string) => (im.inkMap?.design === im.design_id ? Object.values(im.inkMap?.map || {}).find((x) => x.name === n)?.hex : "") || colorHex(n) || "#999999";
      const plates: SetupPlate[] = [...(im.underbase ? [{ key: "ub", name: "White underbase", hex: "#FFFFFF", kind: "underbase" }] : []), ...names.map((n, i) => ({ key: `c${i}`, name: n, hex: hexOf(n), kind: "color" }))];
      const mach = machines.find((x) => x.id === slotMachine || x.name === slotMachine) || [...machines].filter((x) => nHeads(x) >= plates.length + (im.underbase ? 1 : 0)).sort((a, b) => nHeads(a) - nHeads(b))[0] || [...machines].sort((a, b) => nHeads(b) - nHeads(a))[0];
      if (mach) {
        const lay = validLayout(mach.layout, nHeads(mach)) ? mach.layout! : defaultLayout(nHeads(mach), mach.flashes ?? 2);
        const laid = autoSetup(lay, plates);
        press = { press: mach.name, pressId: mach.id, asPrinted: false, heads: laid.map((slot) => {
          if (slot.startsWith("p:")) { const c = plates.find((x) => x.key === slot.slice(2)); return { what: "screen", name: c?.name || "Screen", hex: c?.hex || "#999999", mesh: "" }; }
          return { what: slot === "flash" ? "flash" : slot === "cool" ? "cool" : slot === "roller" ? "roller" : "empty", name: "", hex: "", mesh: "" };
        }) };
      }
    }
    else if (setup?.heads?.length) {
      press = { press: "", asPrinted: false, heads: setup.heads.map((slot) => {
        if (slot.startsWith("p:")) { const c = chans.find((x) => (x as { key?: string }).key === slot.slice(2)); return { what: "screen", name: c?.name || "Screen", hex: c?.hex || "#999999", mesh: String(c?.mesh || "") }; }
        return { what: slot === "flash" ? "flash" : slot === "cool" ? "cool" : slot === "roller" ? "roller" : "empty", name: "", hex: "", mesh: "" };
      }) };
    }
    const m = mins.get(im.location) || mins.get("Whole job") || { setup: 0, run: 0 };
    prints.push({
      id: im.id, groupId: g.id, group: g.name || "", location: im.location, method: im.method, screen,
      colors: im.colors, inks: im.inks || "", size: im.size || "", drop: im.drop || "", underbase: im.underbase === true ? "yes" : im.underbase === false ? "no" : "",
      notes: im.notes || "", confirm: im.confirm || null, confirmed: im.confirmed || null,
      film: im.film ? { ...im.film, files: (im.film.files || []).map((f) => ({ ...f, url: signed.get(f.path) || "" })) as never } : null,
      sep: s ? { id: s.id, number: s.number, status: s.status, plates: chans.map((c) => ({ name: c.name || "", hex: c.hex || "#000000", mesh: String(c.mesh || ""), coverage: typeof c.coverage === "number" ? c.coverage : null, url: c.file ? signed.get(c.file) || "" : "" })) } : null,
      press, minutes: { setup: Math.round(m.setup), run: Math.round(m.run) },
      ...(() => {
        const d = (dsgs || []).find((x) => x.id === im.design_id);
        const plan = (((d?.print_plan || {}) as { inks?: { hex?: string; name?: string }[] }).inks || []).filter((k) => k.hex).map((k) => ({ hex: String(k.hex).toUpperCase(), name: String(k.name || "") }));
        const inkMap = im.inkMap && im.inkMap.design === im.design_id ? Object.fromEntries(Object.entries(im.inkMap.map).map(([h, v]) => [h.toUpperCase(), { name: v.name, hex: v.hex, ...(v.mix ? { mix: v.mix } : {}) }])) : {};
        const hist = (((d?.specs || {}) as { history?: { order_id: string; order_number: number; at: string; by: string; size: string; drop: string; inks: string; colors: number; underbase?: boolean; garment?: string; notes?: string; job?: string; location: string }[] }).history || []);
        const last = hist.filter((h) => h.order_id !== orderId).sort((a, b) => String(b.at).localeCompare(String(a.at))).sort((a, b) => Number(b.location === im.location) - Number(a.location === im.location)).slice(0, 4)
          .map((h) => ({ orderId: h.order_id, number: h.order_number, at: h.at, by: h.by, size: h.size, drop: h.drop, inks: h.inks, colors: h.colors, underbase: h.underbase, garment: h.garment, notes: h.notes, job: h.job, location: h.location }));
        return { art: signed.get(artPath(d)) || "", design: d?.name || "", plan, inkMap, sizeFrom: im.sizeFrom || "", last };
      })(),
    });
  }

  // where the job is: each step needs the one before; prints that aren't screen printed have no film steps
  const scr = prints.filter((p) => p.screen);
  const st = order.status;
  const anyMockup = (mks || []).length > 0 || groups.some((g) => (g.mockupThumbs || []).length);
  const requested = scr.every((p) => p.sep || p.film);
  const filmMade = scr.every((p) => p.sep?.status === "films" || (p.film && (p.film.state === "physical" || (p.film.files || []).length > 0)));
  const checked = scr.every((p) => p.film?.checked);
  const slotList = (slots || []) as { status: string }[];
  const onPress = slotList.some((x) => x.status === "running" || x.status === "done") || (times || []).length > 0 || st === "ready" || st === "completed";
  const printed = st === "ready" || st === "completed" || (slotList.length > 0 && slotList.every((x) => x.status === "done"));
  const done = [true, anyMockup, requested, filmMade, checked, onPress, printed];
  let step = 0; while (step < done.length && done[step]) step++;
  const why = [
    "", anyMockup ? "" : "No mockup yet: make it in the Mockup Creator.",
    requested ? "" : "Separations haven't been requested for every screen print.",
    filmMade ? "" : "Film isn't made yet for every screen print (Print Films in Separations, or the film from the Dropbox film folder).",
    checked ? "" : "Production hasn't checked the film yet.",
    onPress ? "" : "Not on press yet (the phone's press timer or the schedule starts it).",
    printed ? "" : "Not printed yet: the schedule marks it done, or the order moves to Ready.",
  ];

  // what the job's history says: the old Printavo job (a reorder), the order's production notes, its events
  const history: ProductionView["history"] = [];
  const re = (ev || []).find((e) => e.kind === "reorder");
  const pv = String(re?.detail || order.notes || "").match(/Printavo #(\d+)/);
  if (pv) {
    const { data: a } = await admin.from("archived_orders").select("visual_id, nickname, order_date, data").eq("visual_id", pv[1]).maybeSingle();
    if (a) for (const line of oldJobText(a).split("\n").filter(Boolean)) {
      const [k, ...r] = line.split(": ");
      history.push({ kind: k, when: `Printavo #${a.visual_id}`, title: "", text: r.join(": ") });
    }
  }
  for (const e of (ev || []).filter((x) => ["details", "press_actual", "seps_requested", "art_approved", "proof_approved", "reorder"].includes(x.kind))) {
    history.push({ kind: e.kind === "details" ? "Details confirmed" : e.kind === "press_actual" ? "As printed" : e.kind === "seps_requested" ? "Separations requested" : e.kind === "reorder" ? "Reorder" : "Approved", when: String(e.created_at).slice(0, 10), title: "", text: String(e.detail || "") });
  }

  return {
    order: { id: order.id, number: order.number, nickname: order.nickname || "", status: st, due: order.due_date, customer: cust?.company || cust?.name || "", customerId: order.customer_id,
      qty: groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + Object.values(l.sizes || {}).reduce((a, b) => a + (+b || 0), 0), 0), 0), reorderOf: pv ? `Printavo #${pv[1]}` : "" },
    groups: groups.map((g) => ({
      id: g.id, name: g.name || "",
      lines: g.lines.map((l) => [l.brand, l.style, l.color].filter(Boolean).join(" ") + ` · ${Object.entries(l.sizes || {}).filter(([, q]) => +q > 0).map(([z, q]) => `${z} ${q}`).join(" ")}`),
      mockups: (mks || []).filter((m) => m.group_id === g.id || (!m.group_id && groups.length === 1)).map((m) => ({ title: String(m.title || ""), full: signed.get(m.file_path) || "", thumb: signed.get(String(m.file_path).replace(/\.png$/, "-thumb.png")) || signed.get(m.file_path) || "" })),
    })),
    prints, step, done, why,
    films: filmFiles.map((f) => ({ name: String(f.name || "").replace(/^Film:\s*/i, ""), path: f.file_path, url: signed.get(f.file_path) || "" })),
    history, productionNotes: String(inn?.production_notes || ""),
    presses: machines.map((x) => ({ id: x.id, name: x.name, heads: nHeads(x) })),
  };
}
