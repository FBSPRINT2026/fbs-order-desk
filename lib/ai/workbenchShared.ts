import type { EODraft } from "@/lib/emailOrderShared";

/**
 * AI Workbench (Oct 13): a chat with the AI where staff drop in files (logos, spreadsheets, PDFs) and ask for things
 * ("mockups of these two logos on a Gildan 5000 in black, navy and red", "put this spreadsheet in as an order").
 * Shared between the server (lib/ai/workbench.ts) and the page (components/AiWorkbench.tsx).
 * Nothing the AI does changes anything by itself: a quote is made only when someone clicks Create quote on its card.
 */
export type WBFile = { id: string; path: string; name: string; type: string; size: number; url?: string };

/** one mockup picture: a garment photo with one or more prints on it (drawn in the browser) */
export type WBMockItem = {
  color: string; view: "front" | "back";
  /** the garment photo, through our image proxy */ photo: string;
  prints: { file: string; artPath: string; art?: string; location: string; widthIn?: number }[];
  youth?: boolean;
  /** the finished picture, once saved */ saved?: string; savedUrl?: string;
};

export type WBCard =
  | { id: string; kind: "order"; draft: EODraft; customer: { id: string; label: string } | null; choices: { id: string; label: string }[]; created?: { id: string; number: number } }
  | { id: string; kind: "mockups"; garment: string; items: WBMockItem[]; missing: string[] };

export type WBMsg = { role: "user" | "assistant"; text: string; files?: WBFile[]; cards?: WBCard[]; at: string; error?: boolean };

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
