/** separation stages (kept apart from the Studio so lists and the customer page don't load the whole Studio) */
type Status = "requested" | "in_progress" | "review" | "approved" | "films" | "cancelled";
/**
 * Three stages, as the shop works: Working (getting it right), Printed (films printed: Print Films moves it here) and
 * Archived (not used; kept 30 days in the Archived tab). The database keeps its older values: requested / in_progress /
 * review / approved all show as Working, films is Printed, cancelled is Archived.
 */
export type SepStage = "working" | "printed" | "archived";
export const sepStage = (status: Status): SepStage => (status === "films" ? "printed" : status === "cancelled" ? "archived" : "working");
const STAGE = { working: { label: "Working", c: "#A152C9" }, printed: { label: "Printed", c: "#0A8FC0" }, archived: { label: "Archived", c: "#7C8799" } };
export const SEP_STATUS: Record<Status, { label: string; c: string }> = {
  requested: STAGE.working, in_progress: STAGE.working, review: STAGE.working, approved: STAGE.working, films: STAGE.printed, cancelled: STAGE.archived,
};
/** archived separations stay in the Archived tab this many days */
export const ARCHIVE_DAYS = 30;