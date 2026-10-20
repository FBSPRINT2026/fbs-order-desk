import type { Employee, TimeSettings } from "@/lib/timeclock";

/** What every Time Clock tab gets: who's looking, everyone on the clock, the settings, and a way to reload. */
export type TimeData = { me: string; role: string; /** may see pay rates (the "pay" permission) */ seesPay?: boolean; employees: Employee[]; settings: TimeSettings; reload: () => Promise<void> };
/** runs the time clock: owners, admins, and anyone with "Runs the time clock" (Jose; Oct 20, Nick: "everything, including pay") */
export const isBoss = (d: TimeData) => d.role === "owner" || d.role === "admin" || !!d.seesPay;
/** sees pay rates and labor cost */
export const seesPay = (d: TimeData) => isBoss(d) || !!d.seesPay;
