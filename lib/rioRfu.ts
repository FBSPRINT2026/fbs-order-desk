/**
 * Wilflex™ Rio RFU (ready-for-use) standard colors, the shop's stock inks: no mixing. The approximate PMS for each comes
 * from Avient's interactive color card (Wilflex Rio RFU Standard Colors, MC90000894WE, Aug 2026: the value shown when
 * hovering a swatch). Product numbers are from IMS 3.0 ("80108 EPIC RIO RFU YELLOW"); blank where IMS doesn't list one.
 * Swatch colors are sampled from the card (screen simulations, like Avient says).
 */
export type RfuInk = { name: string; product: string; pms: string; hex: string };
export const RIO_RFU: RfuInk[] = [
  { name: "Lemon Yellow", product: "80550", pms: "108 C", hex: "#FEDF25" },
  { name: "Yellow", product: "80108", pms: "123 C", hex: "#FEC900" },
  { name: "Light Gold", product: "80100", pms: "2010 C", hex: "#FEB217" },
  { name: "Gold", product: "80000", pms: "137 C", hex: "#FEAC36" },
  { name: "Dolphin Orange", product: "30400", pms: "1585 C", hex: "#F46725" },
  { name: "Bright Orange", product: "30200", pms: "1665 C", hex: "#E84B2A" },
  { name: "Scarlet", product: "40000", pms: "485 C", hex: "#D53A36" },
  { name: "National Red", product: "43000", pms: "2034 C", hex: "#CC3539" },
  { name: "Drake Red", product: "42270", pms: "1805 C", hex: "#CD2A36" },
  { name: "Dallas Scarlet", product: "42000", pms: "7621 C", hex: "#A4303D" },
  { name: "Maroon", product: "45400", pms: "504 C", hex: "#55343C" },
  { name: "Brandywine", product: "47600", pms: "219 C", hex: "#C23878" },
  { name: "Russell Purple", product: "50400", pms: "7680 C", hex: "#50386B" },
  { name: "Aqua", product: "75300", pms: "2397 C", hex: "#00A6AF" },
  { name: "Contact Blue", product: "60650", pms: "2193 C", hex: "#008CC9" },
  { name: "Light Royal", product: "62100", pms: "2145 C", hex: "#00539C" },
  { name: "Royal", product: "67050", pms: "2131 C", hex: "#284998" },
  { name: "Bears Navy", product: "66100", pms: "2768 C", hex: "#323657" },
  { name: "Navy", product: "60000", pms: "533 C", hex: "#2F374C" },
  { name: "Black Diamond", product: "", pms: "Black 3 C", hex: "#1D2722" },
  { name: "Black Light Green", product: "75900", pms: "802 C", hex: "#5BD740" },
  { name: "Kelly Green", product: "70550", pms: "3522 C", hex: "#008346" },
  { name: "Dark Green", product: "74550", pms: "626 C", hex: "#305346" },
  { name: "Russell Gray", product: "13300", pms: "427 C", hex: "#BABCBD" },
  { name: "Dark Gray", product: "14600", pms: "430 C", hex: "#868E93" },
  { name: "Tan", product: "12600", pms: "148 C", hex: "#ECBD83" },
  { name: "Electric Yellow", product: "", pms: "923 C", hex: "#EDFE00" },
  { name: "Electric Orange", product: "", pms: "811 C", hex: "#FE6424" },
  { name: "Electric Red", product: "", pms: "805 C", hex: "#FE2928" },
  { name: "Electric Pink", product: "", pms: "812 C", hex: "#FE3788" },
  { name: "Electric Purple", product: "90810", pms: "254 C", hex: "#A8358D" },
  { name: "Electric Blue", product: "90110", pms: "3005 C", hex: "#0075BD" },
  { name: "Electric Green", product: "90210", pms: "354 C", hex: "#00B03C" },
];
const norm = (s: string) => s.toUpperCase().replace(/^(PMS|PANTONE)\s*/, "").replace(/\s+/g, " ").trim();
/** the stock ink whose approximate PMS is this one ("123 C" → Rio RFU Yellow), if any */
export const rfuForPms = (pms: string) => RIO_RFU.find((r) => norm(r.pms) === norm(pms)) || null;
