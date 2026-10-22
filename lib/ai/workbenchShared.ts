import type { EODraft } from "@/lib/emailOrderShared";

/**
 * AI Workbench (Oct 13): a chat with the AI where staff drop in files (logos, spreadsheets, PDFs) and ask for things
 * ("mockups of these two logos on a Gildan 5000 in black, navy and red", "put this spreadsheet in as an order").
 * Shared between the server (lib/ai/workbench.ts) and the page (components/AiWorkbench.tsx).
 * Nothing the AI does changes anything by itself: a quote is made only when someone clicks Create quote on its card.
 */
export type WBFile = {
  id: string; path: string; name: string; type: string; size: number; url?: string;
  /** a PNG picture of a file the browser and the AI can't show as is (Illustrator .ai, EPS, PDF art, HEIC, TIFF),
   *  made in the browser when it was dropped in: the AI looks at it and mockups are drawn with it (Oct 13) */
  preview?: { path: string; url?: string };
};

/** one mockup picture: a garment photo with one or more prints on it (drawn in the browser) */
export type WBMockItem = {
  color: string; view: "front" | "back";
  /** the garment photo, through our image proxy */ photo: string;
  prints: { file: string; artPath: string; art?: string; location: string; widthIn?: number;
    /** printed as this one ink (hex), e.g. "the logo in black" (Oct 22) */ ink?: string; /** the ink's name, for the card */ inkName?: string;
    /** the art is an .ai / EPS / PDF with no picture yet (dropped in before Oct 13's fix): the page makes one first */ doc?: string }[];
  youth?: boolean;
  /** the finished picture, once saved */ saved?: string; savedUrl?: string;
};

export type WBCard =
  | { id: string; kind: "order"; draft: EODraft; customer: { id: string; label: string } | null; choices: { id: string; label: string }[]; created?: { id: string; number: number } }
  | { id: string; kind: "mockups"; garment: string; items: WBMockItem[]; missing: string[]; spec?: MockSpec };

/** what a mockup card was made from, so the Mockup Creator can open set up the same way (Oct 22, Nick: "use our
 *  mockup builder… and auto build some mockups"): the customer, the garment, its colors, and each print */
export type MockSpec = { customer_id: string | null; style: string; brand: string; colors: string[];
  prints: { design_id?: string; file?: string; location: string; ink?: string; widthIn?: number }[] };

export type WBMsg = { role: "user" | "assistant"; text: string; files?: WBFile[]; cards?: WBCard[]; at: string; error?: boolean;
  /** the email a chat started from, handed to the AI first (Inbox Assistant, Oct 22); not shown as a message */ seed?: boolean };

/** what the server streams back while it works, one JSON per line */
export type WBEvent =
  | { t: "chat"; id: string; title: string }
  | { t: "status"; text: string }
  | { t: "text"; text: string }
  | { t: "card"; card: WBCard }
  | { t: "done"; msg: WBMsg }
  | { t: "error"; error: string };

export const WB_PICTURE = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i;
export const isArtPicture = (f: Pick<WBFile, "type" | "name">) => WB_PICTURE.test(f.type) || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name);
/** art files that aren't pictures: Illustrator, EPS, PDF, Photoshop, CorelDRAW */
export const isArtDoc = (f: Pick<WBFile, "type" | "name">) => /\.(ai|eps|pdf|psd|cdr)$/i.test(f.name) || /postscript|illustrator|photoshop|^application\/pdf$/i.test(f.type);
/** what a mockup is drawn with: the picture itself, or the picture made of an .ai / EPS / PDF */
export const drawablePath = (f: WBFile) => (isArtPicture(f) ? f.path : f.preview?.path || "");
