import type { Employee, TimeSettings } from "@/lib/timeclock";

export type TeamData = { me: string; boss: boolean; /** may see pay rates and labor cost (owner / admin, or the "pay" permission) */ seesPay?: boolean; employees: Employee[]; settings: TimeSettings; reload: () => Promise<void> };
