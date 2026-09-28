/** Program pricing: items a customer orders often, at a flat price per piece (any quantity), with a quick order form. */
export type ProgramImprint = { location: string; method: "screen" | "embroidery" | "dtf"; colors: number; inks: string; size: string; notes: string };
export type ProgramItem = {
  id: string; program_id: string; name: string; style: string; brand: string; garment: string; colors: string[]; sizes: string[];
  price: number; min_qty: number; imprints: ProgramImprint[]; design_id: string | null; image_path: string; notes: string; active: boolean; position: number;
};
export type Program = { id: string; customer_id: string; name: string; notes: string; active: boolean };
export const PROGRAM_SIZES = ["YXS", "YS", "YM", "YL", "YXL", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "OS"];
