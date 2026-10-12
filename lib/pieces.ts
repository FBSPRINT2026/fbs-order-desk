/**
 * A garment count in an email's words ("700 shirts", "150 tees/sweatshirts", "~20–25 navy shirts") (Oct 12, Nick: "any
 * time we see a shirt count displayed, have a button to order goods"): the number of pieces it mentions, or 0.
 */
const ITEMS = "shirts?|t-?shirts?|tees?|tops|hoodies?|sweatshirts?|crewnecks?|polos?|jackets?|hats?|caps?|beanies?|bags?|totes?|aprons?|jerseys?|pieces|pcs|garments?|blanks|uniforms?|tanks?|long ?sleeves?";
const BRANDS = "gildan|next level|bella|canvas|comfort colors|port (?:&|and) company|port authority|district|sport-?tek|hanes|jerzees|independent|champion|nike|richardson|augusta|badger|a4|holloway";
// a count, then up to 4 words (colors, brand, style number), then what it is: "700 shirts", "1,200 Gildan 18500 hoodies"
const RE = new RegExp(`(?:^|[^\\d,])(?:~|about |around )?(\\d{1,3}(?:,\\d{3})+|\\d{1,5})(?:\\s*[–-]\\s*\\d{1,5})?\\+?\\s+(?:(?:${ITEMS})\\b|(?:[\\w/&.-]+\\s+){0,4}?(?:${ITEMS})\\b|(?:${BRANDS})\\b)`, "gi");
export function pieceCount(...texts: (string | null | undefined)[]) {
  for (const t of texts) for (const m of String(t || "").matchAll(RE)) { const n = Number(m[1].replace(/,/g, "")); if (n >= 6 && n <= 20000) return n; }
  return 0;
}
export const orderGoodsHref = (activityId: string) => `/shop/order-goods?email=${activityId}`;
