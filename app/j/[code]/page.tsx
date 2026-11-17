import { mergeProduction } from "@/lib/production";
import { createAdminClient } from "@/lib/supabase/admin";
import { groupPictures } from "@/lib/mockupFresh";
import type { Group } from "@/lib/pricing";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { jobGate } from "@/lib/jobAccess";
import { loadJobCard, parseJobCode } from "@/lib/jobCard";
import { mergeSettings, type Customer } from "@/lib/pricing";
import { addressFromText, emptyAddress, type BillTo, type Shipment } from "@/lib/shipping";
import { addressLines, type PvOrder } from "@/lib/archive";
import { checkinJobFor } from "@/lib/checkin";
import { printSettings, printerReady } from "@/lib/printQueue";
import JobMobile from "@/components/job/JobMobile";
import { pressSheets, screenPressesNow } from "@/lib/pressActualServer";
import { phoneInks } from "@/lib/jobInksServer";
import JobSignIn from "@/components/job/JobSignIn";
import { LangProvider, LANG_COOKIE, type Lang } from "@/components/job/lang";
import type { ShipTarget } from "@/components/ShipWindow";

export const dynamic = "force-dynamic";

/**
 * The job's phone menu: what opens when someone scans the QR code on a work order or box label ("/j/34110" or
 * "/j/34110-2" for box 2). Press setup, notes, photos, box labels, shipping, check-in and time, for whoever is signed in.
 */
export default async function JobPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ customer?: string }> }) {
  const { code } = await params;
  const ref = parseJobCode(code);
  const gate = await jobGate();
  const who = gate.who;
  const admin = createAdminClient();
  // English or Español: this phone's choice, else the language on the crew member's profile (the time app's setting)
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  let lang: Lang = saved === "es" || saved === "en" ? saved : "en";
  if (!saved && who?.employeeId) { const { data: e } = await admin.from("employees").select("lang").eq("id", who.employeeId).maybeSingle(); if (e?.lang === "es") lang = "es"; }
  const wrap = (el: React.ReactNode) => <LangProvider initial={lang} employee={who?.kind === "employee"}>{el}</LangProvider>;
  if (!who) {
    // the crew on the shop's Wi-Fi sign in here; anyone else (a customer at home) goes to their own order in the
    // customer portal, which only shows it to that customer's login
    // anyone not signed in gets the crew sign-in, on any network (Nick, Nov 16 2026: the press crew on cellular were sent
    // to the customer portal); a customer taps "Customer? See your order" on it, and a signed-in customer goes straight there
    if (!(await searchParams).customer && !gate.customer) return wrap(<JobSignIn code={code} offNetwork={gate.offNetwork} ip={gate.ip} />);
    const job = ref ? await admin.from("orders").select("id").eq("number", +ref.number).maybeSingle() : null;
    if (job?.data) redirect(`/portal/orders/${job.data.id}`);
    const pv = ref ? await admin.from("archived_orders").select("id").is("removed_at", null).eq("visual_id", ref.number).maybeSingle() : null;
    redirect(pv?.data ? `/portal/archive/${pv.data.id}` : "/portal");
  }
  const card = ref ? await loadJobCard(admin, { number: ref.number }) : null;
  if (!card) return wrap(<JobMobile missing={ref?.number || code} who={who} />);

  const [{ data: st }, ps] = await Promise.all([admin.from("settings").select("data").eq("id", 1).maybeSingle(), printSettings(admin)]);
  const settings = mergeSettings(st?.data);

  // design previews (portal jobs) for the press crew
  const dIds = [...new Set(card.groups.flatMap((g) => g.prints.map((p) => p.designId).filter(Boolean) as string[]))];
  const { data: ds } = dIds.length ? await admin.from("designs").select("id, number, name, preview_path").in("id", dIds) : { data: [] };
  const dRows = (ds || []) as { id: string; number: number; name: string; preview_path: string }[];
  const signed = dRows.filter((d) => d.preview_path).length ? (await admin.storage.from("proofs").createSignedUrls(dRows.filter((d) => d.preview_path).map((d) => d.preview_path), 3600)).data || [] : [];
  const designs: Record<string, { number: number; name: string; url: string }> = {};
  dRows.filter((d) => d.preview_path).forEach((d, i) => { designs[d.id] = { number: d.number, name: d.name, url: signed[i]?.signedUrl || "" }; });

  // the press the timer starts on and the press setup is laid on (Nick, Nov 16 2026: "the press should be automatically
  // like press one"): the press this person crews (they're standing at it), else where the job is booked, else none
  const presses0 = await screenPressesNow(admin, st?.data);
  const myPressId = await (async () => {
    const empId = who?.employeeId;
    if (empId) {
      const pr = mergeProduction((st?.data as { production?: unknown } | null)?.production);
      const crews = pr.crews.filter((c) => c.members && Object.values(c.members).includes(empId)).map((c) => c.id);
      const m = pr.machines.find((x) => x.crew && crews.includes(x.crew) && presses0.some((y) => y.id === x.id));
      if (m) return m.id;
    }
    const { data: sl } = await admin.from("production_slots").select("machine, day").eq(card.kind === "o" ? "order_id" : "archived_order_id", card.id).is("finished_at", null).order("day").limit(1);
    return presses0.find((x) => x.id === (sl?.[0] as { machine?: string } | undefined)?.machine)?.id || "";
  })().catch(() => "");
  const myPress = presses0.find((x) => x.id === myPressId)?.name || "";
  // press setups: the suggestion (the separations, laid on that press) and what really ran; the inks to pull or mix
  const [{ sheets: press, presses }, inks] = await Promise.all([pressSheets(admin, card, st?.data, myPressId), phoneInks(admin, card, st?.data).catch(() => null)]);

  // shipping (staff with the Shipping Center)
  let ship: { t: ShipTarget; existing: Shipment | null } | null = null;
  if (who.can.ship && card.delivery !== "pickup") {
    const { data: cu } = card.customerId ? await admin.from("customers").select("*").eq("id", card.customerId).maybeSingle() : { data: null };
    const c = (cu || undefined) as Customer | undefined;
    const bill = ((c?.ship_bill || "fbs") as BillTo);
    let to = emptyAddress();
    if (card.kind === "o") {
      const { data: o } = await admin.from("orders").select("ship_to").eq("id", card.id).single();
      to = addressFromText((o?.ship_to as string) || c?.ship_address || c?.address || "", c?.name || "", c?.company || "");
    } else {
      const { data: a } = await admin.from("archived_orders").select("data").is("removed_at", null).eq("id", card.id).single();
      const d = (a?.data || {}) as PvOrder, sa = d.shippingAddress;
      to = { ...emptyAddress(), company: sa?.companyName || c?.company || "", name: sa?.customerName || d.contact?.fullName || "", street1: sa?.address1 || "", street2: sa?.address2 || "", city: sa?.city || "", state: sa?.state || "", zip: sa?.zipCode || "", country: !sa?.country || /^(us|usa|united states)$/i.test(sa.country) ? "US" : sa.country, phone: d.contact?.phone || "", email: d.contact?.email || "" };
      if (!to.street1 && addressLines(sa).length === 0 && c) to = addressFromText(c.ship_address || c.address || "", c.name || "", c.company || "");
    }
    const { data: sh } = await admin.from("shipments").select("*").eq(card.kind === "o" ? "order_id" : "archived_order_id", card.id).neq("status", "void").order("updated_at", { ascending: false }).limit(1);
    ship = {
      t: { kind: card.kind === "o" ? "order" : "archived", id: card.id, number: card.number, job: card.name, customerId: card.customerId, customer: card.customer, pieces: card.qty, due: card.due, to, service: card.shipMethod, bill, account: bill === "ups" ? c?.ship_ups_account || "" : bill === "fedex" ? c?.ship_fedex_account || "" : "", zip: c?.ship_bill_zip || "" },
      existing: ((sh || [])[0] as Shipment) || null,
    };
  }

  // the proof: each group's saved mockup pictures, big (the full picture where it was kept, else the small one)
  let mockups: { name: string; urls: string[]; thumb?: string }[] = [];
  if (card.kind === "o") {
    const { data: og } = await admin.from("orders").select("groups").eq("id", card.id).maybeSingle();
    // every kind of mockup the group has, ours or the customer's (groupPictures; #40380's was Tiger Blue's own)
    const gs = ((og?.groups || []) as Group[]).map((g, i) => ({ name: g.name?.trim() || `Group ${i + 1}`, paths: groupPictures(g, false, Object.fromEntries(dRows.map((d) => [d.id, d.preview_path]))) }));
    const all = gs.flatMap((g) => g.paths.flatMap((x) => [x.replace(/-thumb\.png$/, ".png"), x]));
    const signed = all.length ? (await admin.storage.from("proofs").createSignedUrls(all, 3600)).data || [] : [];
    const url = new Map(signed.filter((x) => x.signedUrl && !x.error).map((x) => [x.path, x.signedUrl]));
    mockups = gs.map((g) => ({ name: g.name, urls: g.paths.map((x) => url.get(x.replace(/-thumb\.png$/, ".png")) || url.get(x) || "").filter(Boolean), thumb: g.paths.map((x) => url.get(x) || "").find(Boolean) || "" }));
  }

  // check-in (staff with Goods & Receiving)
  const checkin = who.can.checkin ? await checkinJobFor(admin, { kind: card.kind, id: card.id }).catch(() => null) : null;

  return wrap(
    <JobMobile who={who} card={card} mockups={mockups} box={ref?.box || null} designs={designs} press={press} presses={presses} myPress={myPress} inks={inks} ship={ship} shipSettings={settings.ship} checkin={checkin}
      printer={{ ready: printerReady(ps), dpi: ps.dpi }} />
  );
}
