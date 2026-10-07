import type { Employee, TimeSettings } from "@/lib/timeclock";

/** What every Time Clock tab gets: who's looking, everyone on the clock, the settings, and a way to reload. */
export type TimeData = { me: string; role: string; /** may see pay rates (the "pay" permission) */ seesPay?: boolean; employees: Employee[]; settings: TimeSettings; reload: () => Promise<void> };
export const isBoss = (d: TimeData) => d.role === "owner" || d.role === "admin";
/** sees pay rates and labor cost (read only unless they're also a boss) */
export const seesPay = (d: TimeData) => isBoss(d) || !!d.seesPay;
