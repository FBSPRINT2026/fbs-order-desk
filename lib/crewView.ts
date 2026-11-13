/**
 * What each person sees on their phone (Nick, Nov 13 2026: "depending on whose code is put in… you have different views").
 * Set per employee on Employees → Phone logins (`employees.phone_view`); when it isn't set, their place on a press crew
 * says it (Production settings: operator, assistant, catcher), else Office (everything a phone login can do).
 * Browser-safe: the job menu and the crew home both read it.
 */
export type CrewView = "receiving" | "press" | "assist" | "catcher" | "fulfillment" | "shipping" | "office";

export const CREW_VIEWS: { id: CrewView; label: string; short: string; does: string }[] = [
  { id: "receiving", label: "Receiving", short: "Receiving", does: "Jobs to count in by press day, count in, missing or bad goods, work orders, open issues" },
  { id: "press", label: "Press operator", short: "Operator", does: "Their press today, start / pause / complete, the proof, work order, setup and inks" },
  { id: "assist", label: "Press assistant", short: "Assistant", does: "Their press today, the work order, inks and setup first; start / stop too" },
  { id: "catcher", label: "Catcher", short: "Catcher", does: "Post count from the count-in, rejects to reprint, box and shipping labels, where it goes" },
  { id: "fulfillment", label: "Fulfillment", short: "Fulfillment", does: "What to do with each job (fold, bag, tags, labels), size labels to print, where it goes" },
  { id: "shipping", label: "Shipping", short: "Shipping", does: "Scan a job to ship it: boxes, weights, labels" },
  { id: "office", label: "Office", short: "Office", does: "Everything a phone login can do" },
];
export const isCrewView = (v: unknown): v is CrewView => CREW_VIEWS.some((x) => x.id === v);

type CrewLike = { id: string; members?: { operator?: string | null; assistant?: string | null; catcher?: string | null } };
type MachineLike = { id: string; name: string; crew?: string | null };

/** the view set by hand, else the person's place on a press crew, else Office */
export function crewViewOf(set: string | null | undefined, employeeId: string, crews: CrewLike[]): CrewView {
  if (isCrewView(set)) return set;
  for (const c of crews) {
    if (c.members?.operator === employeeId) return "press";
    if (c.members?.assistant === employeeId) return "assist";
    if (c.members?.catcher === employeeId) return "catcher";
  }
  return "office";
}

/** the presses this person works on (their crew's machines) */
export function crewMachines(employeeId: string, crews: CrewLike[], machines: MachineLike[]): MachineLike[] {
  const mine = crews.filter((c) => c.members && Object.values(c.members).includes(employeeId)).map((c) => c.id);
  return machines.filter((m) => m.crew && mine.includes(m.crew));
}

/** the job menu's tiles, first to last, for each view; a tile not listed doesn't show for that view */
export type JobTile = "post" | "timer" | "proof" | "wo" | "setup" | "inks" | "checkin" | "labels" | "ship" | "notes" | "photos" | "time" | "open";
export const TILES: Record<CrewView, JobTile[]> = {
  receiving: ["checkin", "wo", "proof", "notes", "photos", "labels"],
  press: ["timer", "proof", "wo", "setup", "inks", "notes", "photos"],
  assist: ["wo", "inks", "setup", "proof", "notes", "photos", "timer"],
  catcher: ["post", "labels", "ship", "wo", "proof", "notes", "photos"],
  fulfillment: ["labels", "wo", "proof", "post", "notes", "photos"],
  shipping: ["ship", "labels", "wo", "notes", "photos"],
  office: ["proof", "wo", "setup", "inks", "checkin", "post", "labels", "ship", "timer", "notes", "photos", "time", "open"],
};
/** the tool a scanned job opens on for each view (Back goes to the job menu) */
export const OPENS_ON: Partial<Record<CrewView, JobTile>> = { receiving: "checkin", press: "timer", catcher: "post", shipping: "ship" };
