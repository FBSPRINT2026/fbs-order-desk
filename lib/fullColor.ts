import type { Imprint } from "@/lib/pricing";

/**
 * Full color art on a screen print (Oct 26, Nick: "one of my admins will have to be able to upload a picture, and then
 * it'll put the picture on the mockup. Then production's got to confirm how many colors it's going to be, and then it
 * comes back"; "production would confirm pricing before it's sent. The customer can see a picture only proof. And yes,
 * full colors things should go to separations"; the seps themselves are made in Separo for now).
 *
 * Picked in the Mockup Creator ("How will it print?": DTF / screen print full color / spot colors). Screen print full
 * color: the picture goes on the mockup as is, the color count is the planner's estimate, production confirms the
 * colors (and so the price) on Production details, the customer's proof is picture only, and the quote waits for it.
 */
export const FULL_WHY = "Full color art: production sets the colors and price before the quote goes out";
export const isFullColorWhy = (why?: string | null) => /^full color art\b/i.test(why || "");
/** a full-color print still waiting on production */
export const fullColorWaiting = (im: Pick<Imprint, "confirm" | "confirmed">) => !im.confirmed && !!im.confirm && (!!im.confirm.ink || !!im.confirm.size) && isFullColorWhy(im.confirm.why);
