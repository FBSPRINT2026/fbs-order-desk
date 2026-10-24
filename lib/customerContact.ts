/**
 * Automated contact with customers is OFF (Oct 20, Nick: "for now, turn off all automated emails or automated contacts
 * to any customers. We're going to set up automations later"). After a goods tracking reminder went to Little Groupies
 * by itself (#40079).
 *
 * Off means nothing reaches a customer unless a person clicks to send it: no emails, no messages posted on their portal,
 * by the system on its own. What those automations would have said goes to the shop instead (the shop email and the
 * order's history), so nothing is missed. Sending a quote, a proof, a message or a statement by hand is unchanged.
 *
 * Covered: goods tracking alerts (lib/goodsTrack.ts), supplier manifest "your goods shipped" (lib/manifest.ts), the
 * goods note when staff record a supplier (app/shop/goods-actions.ts staffGoodsInfo), merch store order confirmations
 * (lib/merchServer.ts sendConfirmation). Any new automation must check this first.
 */
export const AUTO_CUSTOMER_CONTACT = false;

/**
 * Sew-out approval emails (lib/sewouts.ts). Oct 24, Nick: "we're not gonna send any emails right now". Saving a sew-out
 * photo keeps it and makes its approval page and PDF, but emails no one; Remind is off too. Turn this on to have saving
 * the photo email the customer right away (what Nick described for later).
 */
export const SEWOUT_EMAILS = false;
