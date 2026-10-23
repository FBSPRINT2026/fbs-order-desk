/**
 * The site's AI tools, each ONE tool used in many places (Oct 23, Nick: "start thinking of each of these as an
 * individual tool that just gets applied multiple places in the site… the create order is in email, it's in the
 * ClickUp thing, it's in the projects area… one uniform tool that works throughout the site"). The AI Workbench's
 * Tools tab lists them, with a button to use each one from there; every other button for a tool opens the same one.
 *
 * When a tool changes, it changes once (its component), never in one of the places it shows up. When adding a button
 * for a tool somewhere new, open its component (`component`), don't copy it, and add the place to `places`.
 */
export type AiToolId = "create-order" | "mockup-helper" | "reply" | "assistant" | "order-helper" | "reorder-check" | "art-resolution" | "design-ai" | "brand" | "catalog-review" | "sep-coach" | "when-print" | "schedule" | "file-guess" | "goods-match" | "order-goods" | "ask-shop";

export type AiTool = {
  id: AiToolId; group: "Orders" | "Art & mockups" | "Email" | "Production" | "Goods" | "Search";
  name: string;
  /** one line: what it does */ what: string;
  /** the places on the site it opens from (all the same tool) */ places: string[];
  /** the component (or module) that IS the tool */ component: string;
  /** opening it from the Workbench: "here" = in a pop-up on the Workbench, else the page it works on */
  open: { here: true } | { href: string; label: string };
};

export const AI_TOOLS: AiTool[] = [
  { id: "create-order", group: "Orders", name: "Create order / reorder", what: "Reads an email, a ClickUp job or files (POs, work orders, art) and makes the order or the reorder: asks what doesn't add up, checks shirt colors, pulls art off mockups, brings in a Printavo job's art.",
    places: ["Inbox and folder emails: Create order", "Conversations: Create order", "ClickUp jobs: Create order", "AI Workbench: Tools"], component: "components/tools/CreateOrderTool.tsx", open: { here: true } },
  { id: "mockup-helper", group: "Art & mockups", name: "Mockup Helper", what: "Pulls the art off a mockup (ours, the customer's, a person wearing it, shirts drawn in their software): front and back, size, drop, inks.",
    places: ["Mockup Creator: Helper panel", "Create order: art that came on a shirt", "Printavo reorders: the old mockup"], component: "lib/mockupPull.ts + MockupBuilder Helper", open: { href: "/shop/artwork/mockup?helper=1", label: "Open the Helper" } },
  { id: "reply", group: "Email", name: "Reply writer", what: "Writes the reply to a customer's email from what you tell it (typed or spoken). Never sends it.", places: ["Every email's reply box: Tell the AI what to say"], component: "app/shop/ai-actions.ts (reply)", open: { href: "/shop/inbox", label: "Open the Inbox" } },
  { id: "assistant", group: "Email", name: "Email assistant", what: "Talks through an email with you: what they want, past orders, what to do next; remembers what you teach it about the customer.", places: ["Inbox: Assistant"], component: "components/EmailChat.tsx", open: { href: "/shop/inbox", label: "Open the Inbox" } },
  { id: "order-helper", group: "Orders", name: "Order helper", what: "Ask AI on an order: change garments, sizes, prints by asking; it shows the changes for you to make.", places: ["Order page: Ask AI"], component: "components/OrderAssist.tsx", open: { href: "/shop/orders", label: "Pick an order" } },
  { id: "reorder-check", group: "Orders", name: "Reorder check", what: "Checks a reorder against the old job's art and specs before it's printed.", places: ["Order page (reorders)", "Reorder Details"], component: "app/api/orders/reorder-check", open: { href: "/shop/details", label: "Open Reorder Details" } },
  { id: "art-resolution", group: "Orders", name: "Printavo Art Resolution Center", what: "Talks through an old Printavo job's files: which is the art, the barcodes, the mockup; searches the film folder.", places: ["Create order: Printavo reorders"], component: "components/QuickOrder.tsx (Resolution Center)", open: { href: "/shop/archive", label: "Open the Printavo archive" } },
  { id: "design-ai", group: "Art & mockups", name: "Create with AI", what: "Four designs from an idea, as clean vector art.", places: ["Mockup Creator: Create with AI", "Design Lab", "Customer portal"], component: "app/api/ai/design-art", open: { href: "/shop/artwork/mockup", label: "Open the Mockup Creator" } },
  { id: "brand", group: "Art & mockups", name: "Brand standards chat", what: "Sets up a customer's brand colors, fonts and print rules from their files and what you tell it.", places: ["Customer page: Brand standards"], component: "app/api/ai/brand", open: { href: "/shop/customers", label: "Pick a customer" } },
  { id: "catalog-review", group: "Art & mockups", name: "Design catalog review", what: "Looks over a customer's designs and mockups and says which go together and which are versions.", places: ["Customer page: Designs"], component: "app/api/designs/ai", open: { href: "/shop/customers", label: "Pick a customer" } },
  { id: "sep-coach", group: "Production", name: "Separations coach", what: "You say how a separation came out; it says what to change and keeps the lesson.", places: ["Separation Studio: Make separations better"], component: "app/api/separations/coach", open: { href: "/shop/separations", label: "Open Separations" } },
  { id: "when-print", group: "Production", name: "When can we print it?", what: "Three dates for a job from the live schedule, and which to promise.", places: ["Order page", "Production calendar"], component: "app/api/production/when", open: { href: "/shop/board", label: "Open Production" } },
  { id: "schedule", group: "Production", name: "Schedule recommendations", what: "When the schedule is too tight: splits, overtime, a Saturday, with what each costs.", places: ["Production calendar: Get recommendations"], component: "app/api/production/advise", open: { href: "/shop/board", label: "Open Production" } },
  { id: "file-guess", group: "Production", name: "What's this file?", what: "Guesses what each production file is (barcodes, digitizing, art) for you to confirm.", places: ["Order page: Production files"], component: "app/api/production/guess", open: { href: "/shop/orders", label: "Pick an order" } },
  { id: "order-goods", group: "Goods", name: "Order goods", what: "Fills in the blanks to buy from S&S from what an email or order asks for (styles, colors, sizes) and checks them with S&S; you place the order.",
    places: ["Email: Order goods", "Shop Tools: Order Goods"], component: "app/shop/order-goods", open: { href: "/shop/order-goods", label: "Open Order Goods" } },
  { id: "goods-match", group: "Goods", name: "Match goods to orders", what: "Links incoming boxes and shipments to the jobs they're for; recommends the close ones for you to OK.", places: ["Receiving: Attempt to relink orders"], component: "app/api/goods/ai-match", open: { href: "/shop/receiving", label: "Open Receiving" } },
  { id: "ask-shop", group: "Search", name: "Ask the shop", what: "A question in plain words answered from the shop's live data: what's due, who owes, did it arrive.", places: ["The search bar (top left)"], component: "app/api/ai/search", open: { href: "#ask", label: "Ask in the search bar" } },
];
