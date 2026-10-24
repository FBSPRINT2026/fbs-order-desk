/**
 * "Need help picking garments?" in the Mockup Creator (Oct 24, Nick: "a lot of people don't know, especially the retail
 * client… it pops up and it shows our most popular garments"). The list lives in Settings → Garments → Popular garments;
 * until it's set there, this starting list (what our customers order most, plus the usual staples) is used.
 * Never prices: a rough $ / $$ / $$$ only, so it's safe for retail customers.
 */
export type PopKind = "tees" | "fleece" | "polos" | "hats" | "youth";
export type PopUse = "event" | "merch" | "staff" | "kids";
export type PopularPick = { style: string; brand: string; kind: PopKind; tag: string; why: string; tier: 1 | 2 | 3; uses: PopUse[] };

export const POP_KINDS: { k: PopKind; label: string }[] = [
  { k: "tees", label: "T-shirts" }, { k: "fleece", label: "Hoodies and crews" }, { k: "polos", label: "Polos" }, { k: "hats", label: "Hats" }, { k: "youth", label: "Youth and baby" },
];
export const POP_USES: { k: PopUse; label: string }[] = [
  { k: "event", label: "Event or giveaway" }, { k: "merch", label: "Merch to sell" }, { k: "staff", label: "Staff and uniforms" }, { k: "kids", label: "Kids" },
];

export const DEFAULT_POPULAR: PopularPick[] = [
  { style: "6210", brand: "Next Level", kind: "tees", tag: "Most ordered", why: "Soft, modern fit. Our go-to tee.", tier: 2, uses: ["event", "merch", "staff"] },
  { style: "5000", brand: "Gildan", kind: "tees", tag: "Best value", why: "Classic heavy cotton. Great for events.", tier: 1, uses: ["event", "staff"] },
  { style: "3001CVC", brand: "BELLA + CANVAS", kind: "tees", tag: "Retail feel", why: "Light, soft heather. Sells well as merch.", tier: 2, uses: ["merch", "event"] },
  { style: "1717", brand: "Comfort Colors", kind: "tees", tag: "Vintage look", why: "Heavyweight, garment-dyed, broken in.", tier: 3, uses: ["merch"] },
  { style: "64000", brand: "Gildan", kind: "tees", tag: "Soft for less", why: "Softer than a basic tee, still easy on the budget.", tier: 1, uses: ["event", "staff"] },
  { style: "A4N3142", brand: "A4", kind: "tees", tag: "Cooling", why: "Lightweight performance tee for sports and heat.", tier: 2, uses: ["event", "staff"] },
  { style: "18500", brand: "Gildan", kind: "fleece", tag: "Best value", why: "The classic pullover hoodie.", tier: 1, uses: ["event", "staff", "merch"] },
  { style: "3719", brand: "BELLA + CANVAS", kind: "fleece", tag: "Retail feel", why: "Sponge fleece, soft and modern.", tier: 3, uses: ["merch"] },
  { style: "18000", brand: "Gildan", kind: "fleece", tag: "Crewneck", why: "Everyday crew sweatshirt.", tier: 1, uses: ["event", "staff", "merch"] },
  { style: "K500", brand: "Port Authority", kind: "polos", tag: "Staff favorite", why: "Silk Touch polo: holds its shape, wrinkle resistant.", tier: 2, uses: ["staff"] },
  { style: "112", brand: "Richardson", kind: "hats", tag: "Most popular hat", why: "The snapback trucker everyone knows.", tier: 2, uses: ["merch", "staff", "event"] },
  { style: "5000B", brand: "Gildan", kind: "youth", tag: "Youth tee", why: "Classic cotton tee in kids' sizes.", tier: 1, uses: ["kids", "event"] },
  { style: "18500B", brand: "Gildan", kind: "youth", tag: "Youth hoodie", why: "The classic hoodie in kids' sizes.", tier: 1, uses: ["kids"] },
  { style: "100B", brand: "BELLA + CANVAS", kind: "youth", tag: "Baby", why: "Soft infant one piece.", tier: 2, uses: ["kids", "merch"] },
];
