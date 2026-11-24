import Link from "next/link";
import { requireBrewer } from "@/lib/draftpunk/server";
import Shell from "@/components/draftpunk/Shell";
import Icon from "@/components/draftpunk/icons";

export const dynamic = "force-dynamic";

/** a phone's "More": everything the bottom bar has no room for */
export default async function More() {
  const { brewer } = await requireBrewer();
  const items: [string, string, string, string][] = [
    ["/draftpunk/assistant", "Assistant", "spark", "Design a beer, ask anything about brewing it"],
    ["/draftpunk/best", "Best ever", "star", "The club's best recipe for every style"],
    ["/draftpunk/competitions", "Competitions", "medal", "Entries, scoresheets and medals"],
    ["/draftpunk/inventory", "Ingredients", "stock", "What's on the shelf, and shopping lists"],
    ["/draftpunk/equipment", "Equipment", "equip", "Your systems, chambers and Inkbirds"],
    ["/draftpunk/club", "Club", "club", "Shared recipes and members"],
    ["/draftpunk/import", "Import", "import", "BeerSmith, BeerXML, or a photo of a recipe"],
  ];
  return (
    <Shell name={brewer.name}>
      <h1 className="dp-h1">More</h1>
      {items.map(([href, label, icon, sub]) => (
        <Link key={href} href={href} className="dp-card dp-more">
          <Icon name={icon} /><span><b>{label}</b><small>{sub}</small></span>
        </Link>
      ))}
    </Shell>
  );
}
