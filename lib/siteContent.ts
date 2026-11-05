import { SUPABASE_URL } from "@/lib/config";

/**
 * The public website, fbsprint.com (Nov 5, Nick: "redesign our website so it looks like it matches our portal… the
 * portal login there… a basic contact us form that goes into… customer request"). Its words live here; the page is
 * app/site/page.tsx, its form components/site/SiteRequestForm.tsx, and what the form does app/site/actions.ts.
 * Photos are in the public "site" storage bucket (work/<slug>.jpg), added by staff (app/api/site/photo).
 */
export const SITE = {
  phone: "972-487-7858",
  email: "info@fbsprint.com",
  address: ["811 Alpha Dr., Suite 343", "Richardson, TX 75081"],
  since: 2004,
};

export const SERVICES: { t: string; d: string; tone: "blue" | "salmon" | "orange" }[] = [
  { t: "Screen printing", d: "Plastisol, water-based, discharge, puff and simulated process. Short runs to thousands.", tone: "blue" },
  { t: "Embroidery", d: "Hats, polos, jackets and bags, with 3D puff and sewn or embroidered patches.", tone: "salmon" },
  { t: "DTF transfers", d: "Full-color prints with no color limits, pressed here or sent as gang sheets.", tone: "orange" },
  { t: "Printing and signage", d: "Business cards, booklets, coasters, banners and large-format signs.", tone: "blue" },
  { t: "Promotional products", d: "Drinkware, bags, stickers and giveaways with your logo on them.", tone: "salmon" },
  { t: "Stores and fulfillment", d: "Online team and company stores, then pick, pack and ship.", tone: "orange" },
];

export const STEPS = [
  { t: "Tell us what you need", d: "Send the form below with your art, or log in and build the order yourself." },
  { t: "Approve it online", d: "You get a proof and a quote by email. Approve, ask for changes and pay in one place." },
  { t: "We print and deliver", d: "Track it in your portal until it's ready for pickup or shipped to your door." },
];

export const WORK: { slug: string; t: string; who: string }[] = [
  { slug: "four-corners", t: "Simulated full-color screen print", who: "Four Corners Brewing" },
  { slug: "patches", t: "Custom patches", who: "Peticolas, St Bernard and OHB" },
  { slug: "tie-dye", t: "Tie-dye shirts", who: "Cedar Creek Brewery" },
  { slug: "booklet", t: "Multi-page booklet with UV coating", who: "YourCause" },
  { slug: "sewn-patches", t: "Custom sewn patches", who: "Oak Highlands Brewery" },
  { slug: "tech-shirt", t: "Printed tech shirt", who: "On Your Left! Marketing" },
  { slug: "custom-tag", t: "Screen print with custom tag", who: "St Bernard Sports" },
  { slug: "sleeve", t: "Screen print with sleeve", who: "Dallas Fire Department" },
  { slug: "coaster", t: "Die-cut coaster", who: "Full Clip Distributing" },
];

/** what someone can tick on the request form */
export const NEEDS = ["T-shirts", "Hoodies and sweats", "Hats", "Polos and jackets", "Embroidery", "DTF transfers", "Printing", "Signage", "Promo items", "Something else"];

export const sitePhoto = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/site/${path}`;
