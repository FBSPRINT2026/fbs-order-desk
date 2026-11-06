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

export const SERVICES: { t: string; d: string; icon: "shirt" | "cap" | "press" | "swatch" | "sign" | "store" | "box"; tone: "blue" | "salmon" | "orange" }[] = [
  { t: "Screen printing", d: "Full-service, high-quality screen printing on every kind of apparel and brand.", icon: "shirt", tone: "blue" },
  { t: "Embroidery", d: "Turnkey embroidery on hats, polos, jackets and bags, with 3D puff and patches.", icon: "cap", tone: "salmon" },
  { t: "DTF and heat press", d: "Full-color DTF transfers with no color limits, pressed here or sent to you as gang sheets.", icon: "press", tone: "orange" },
  { t: "Printing", d: "Digital, offset and grand-format printing: cards, booklets, coasters and more.", icon: "swatch", tone: "blue" },
  { t: "Signage and promo products", d: "Banners, yard signs, conference displays and promotional products.", icon: "sign", tone: "salmon" },
  { t: "Online stores", d: "Web stores and online shops for your team, company or brand to sell your products.", icon: "store", tone: "orange" },
  { t: "Pick, pack and ship", d: "Full-service daily pick, pack and ship by USPS, UPS and FedEx.", icon: "box", tone: "blue" },
];

/** what clients do in their portal (the website's portal section) */
export const PORTAL_FEATS: [string, string][] = [["Approve proofs", "See it, approve it, done"], ["Reorder in clicks", "Past jobs, ready to run"], ["Track goods", "From the supplier to your door"], ["Pay invoices", "Card or ACH, any time"]];

export const STEPS = [
  { t: "Reach out", d: "Send the new client form below with your art, or log in and build the order yourself." },
  { t: "Approve it online", d: "You get a proof and a quote by email. Approve, ask for changes and pay in one place." },
  { t: "We print and deliver", d: "Track it in your portal until it's ready for pickup or shipped to your door." },
];

/** who we print for (in place of job photos; Nov 5, Nick: "the pictures we have are pretty dated"). The last card names
 *  everyone else in a short list (Nov 5, Nick: "wholesalers and contract resellers… private brands… schools and
 *  churches… the other ones can be like breweries, business, team events"). */
export const WHO: { t: string; d: string; /** the one line under its name on a phone */ short?: string; icon?: "warehouse" | "tag" | "swap" | "school"; points: string[]; /** a list of names, not points */ list?: boolean; tone: "blue" | "salmon" | "orange" | "navy" }[] = [
  { t: "Wholesalers and contract resellers", icon: "warehouse", short: "Wholesale pricing, blind shipped", d: "A contract decorating partner for wholesalers and promo distributors, run after run.", points: ["Your goods or ours, at wholesale pricing", "Blind shipped under your name, or straight to your client", "Proofs and quotes you can pass along"], tone: "blue" },
  { t: "Private brands", icon: "tag", short: "Tags, labels, retail-ready packing", d: "Retail-ready product for brands and designers selling their own line.", points: ["Custom neck tags, labels and hang tags", "Fold, bag and pack for retail", "Consistent color from drop to drop"], tone: "salmon" },
  { t: "Schools and churches", icon: "school", short: "Spirit wear, ministries, events", d: "Spirit wear, teams, ministries and events, on your calendar.", points: ["Billing by department or booster club", "Online stores for families and members", "Rush jobs for game day and events"], tone: "orange" },
  { t: "And everyone else", short: "Breweries, businesses, cities, teams", d: "Whatever you're putting your name on.", points: ["Breweries", "Businesses", "Cities", "Teams and events", "Designers selling product"], list: true, tone: "navy" },
];
/** names we've printed for, shown as their logos once the files are in public/site/clients (Nov 5, Nick: "we also work
 *  with these major retailers… and then local businesses"). Without a file the name shows in plain type. */
export const CLIENT_LOGOS: { t: string; names: { name: string; img?: string }[] }[] = [
  { t: "We also work with major retailers and brands", names: [{ name: "Walmart", img: "/site/clients/walmart.svg" }, { name: "Target", img: "/site/clients/target.png" }, { name: "Academy Sports + Outdoors", img: "/site/clients/academy.png" }, { name: "Fanatics", img: "/site/clients/fanatics.png" }, { name: "Keurig Dr Pepper", img: "/site/clients/keurig-dr-pepper.png" }] },
  { t: "And names you know around here", names: [{ name: "On Your Left" }, { name: "Plano Balloon Festival", img: "/site/clients/plano-balloon.png" }, { name: "Saint Arnold Brewing", img: "/site/clients/saint-arnold.png" }, { name: "Cowboy Cool", img: "/site/clients/cowboy-cool.png" }, { name: "Dallas Fire-Rescue", img: "/site/clients/dallas-fire-rescue.png" }] },
];
/** the About box's three facts (Nov 5, Nick) */
export const FACTS: [string, string][] = [["Experience", "22 years in business"], ["Garments decorated", "Millions"], ["Based in", "North Texas"]];

/** the inquiry form's "You are a…" (Nov 5, Nick: "who am I, what my company, what am I needing") */
export const CLIENT_KINDS = ["Wholesaler", "Contract reseller", "Private brand", "School", "Church", "Brewery", "City", "Business", "Something else"];
/** a new account's "About how many a month" */
export const MONTHLY = ["Under 250", "250 to 1,000", "1,000 to 5,000", "5,000 or more", "Not sure yet"];
/** what someone can tick on the request form */
export const NEEDS = ["Screen printing", "Embroidery", "DTF", "Printing", "Signage", "Promo items", "Online store", "Fulfillment"];
export const NEEDS_OLD = ["T-shirts", "Hoodies and sweats", "Hats", "Polos and jackets", "Embroidery", "DTF transfers", "Printing", "Signage", "Promo items", "Something else"];

export const sitePhoto = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/site/${path}`;
