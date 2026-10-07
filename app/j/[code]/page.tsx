import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { jobGate } from "@/lib/jobAccess";
import { loadJobCard, parseJobCode } from "@/lib/jobCard";
import { mergeSettings, type Customer } from "@/lib/pricing";
import { addressFromText, emptyAddress, type BillTo, type Shipment } from "@/lib/shipping";
import { addressLines, type PvOrder } from "@/lib/archive";
import { checkinJobFor } from "@/lib/checkin";
import { printSettings } from "@/lib/printQueue";
import JobMobile from "@/components/job/JobMobile";
import { pressSheets } from "@/lib/pressActualServer";
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
    if ((gate.onShopNet || !gate.netConfigured) && !(await searchParams).customer && !gate.customer) return wrap(<JobSignIn code={code} />);
    if (gate.offNetwork && !(await searchParams).customer) return wrap(<JobSignIn code={code} offNetwork />);
    const job = ref ? await admin.from("orders").select("id").eq("number", +ref.number).maybeSingle() : null;
    if (job?.data) redirect(`/portal/orders/${job.data.id}`);
    const pv = ref ? await admin.from("archived_orders").select("id").eq("visual_id", ref.number).maybeSingle() : null;
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

  // press setups: the suggestion (the separations) and what really ran (press_actuals); the inks to pull or mix
  const [{ sheets: press, presses }, inks] = await Promise.all([pressSheets(admin, card, st?.data), phoneInks(admin, card, st?.data).catch(() => null)]);

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
      const { data: a } = await admin.from("archived_orders").select("data").eq("id", card.id).single();
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

  // check-in (staff with Goods & Receiving)
  const checkin = who.can.checkin ? await checkinJobFor(admin, { kind: card.kind, id: card.id }).catch(() => null) : null;

  return wrap(
    <JobMobile who={who} card={card} box={ref?.box || null} designs={designs} press={press} presses={presses} inks={inks} ship={ship} shipSettings={settings.ship} checkin={checkin}
      printer={{ ready: ps.mode === "printnode" ? !!ps.printnodeId : !!ps.host, dpi: ps.dpi }} />
  );
}
