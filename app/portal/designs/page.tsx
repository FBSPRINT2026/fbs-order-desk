import { redirect } from "next/navigation";

/** Designs now live in the portal's Artwork area. */
export default async function MyDesigns({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const { as } = await searchParams;
  redirect(`/portal?area=artwork${as ? `&as=${as}` : ""}`);
}
