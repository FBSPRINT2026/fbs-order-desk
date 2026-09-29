import type { Employee, TimeSettings } from "@/lib/timeclock";

export type TeamData = { me: string; boss: boolean; employees: Employee[]; settings: TimeSettings; reload: () => Promise<void> };
