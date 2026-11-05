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

export const SERVICES: { t: string; d: string; icon: "shirt" | "cap" | "swatch" | "sign" | "store" | "box"; tone: "blue" | "salmon" | "orange" }[] = [
  { t: "Screen printing", d: "Full-service, high-quality screen printing and DTF on every kind of apparel and brand.", icon: "shirt", tone: "blue" },
  { t: "Embroidery", d: "Turnkey embroidery on hats, polos, jackets and bags, with 3D puff and patches.", icon: "cap", tone: "salmon" },
  { t: "Printing", d: "Digital, offset and grand-format printing: cards, booklets, coasters and more.", icon: "swatch", tone: "orange" },
  { t: "Signage and promo products", d: "Banners, yard signs, conference displays and promotional products.", icon: "sign", tone: "blue" },
  { t: "Online stores", d: "Web stores and online shops for your team, company or brand to sell your products.", icon: "store", tone: "salmon" },
  { t: "Pick, pack and ship", d: "Full-service daily pick, pack and ship by USPS, UPS and FedEx.", icon: "box", tone: "orange" },
];

export const STEPS = [
  { t: "Tell us what you need", d: "Send the form below with your art, or log in and build the order yourself." },
  { t: "Approve it online", d: "You get a proof and a quote by email. Approve, ask for changes and pay in one place." },
  { t: "We print and deliver", d: "Track it in your portal until it's ready for pickup or shipped to your door." },
];

/** who we print for (in place of job photos; Nov 5, Nick: "the pictures we have are pretty dated") */
export const WHO: { t: string; d: string; tone: "blue" | "salmon" | "orange" }[] = [
  { t: "Breweries and restaurants", d: "Staff shirts, merch, hats and coasters", tone: "salmon" },
  { t: "Schools and teams", d: "Spirit wear, uniforms and events", tone: "blue" },
  { t: "Cities and companies", d: "Departments, onboarding, 5Ks and fundraisers", tone: "orange" },
  { t: "Brands and decorators", d: "Wholesale and contract printing, blind shipped", tone: "blue" },
];

/** what someone can tick on the request form */
export const NEEDS = ["T-shirts", "Hoodies and sweats", "Hats", "Polos and jackets", "Embroidery", "DTF transfers", "Printing", "Signage", "Promo items", "Something else"];

export const sitePhoto = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/site/${path}`;
