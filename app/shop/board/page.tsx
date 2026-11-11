"use client";
import MachineSchedule from "@/components/MachineSchedule";
import { useProdSide } from "@/lib/prodSide";

/**
 * Schedule: the department's production calendar (machines, days, jobs in run order). Which department follows the
 * SP / EMB / HP switch in the left menu (Nov 11, Nick: "instead of it saying production, we should just say schedule…
 * the schedule for each department"). The order pipeline lives on the dashboard.
 */
const NAME = { screen: "Screen Print", embroidery: "Embroidery", heat: "Heat Press" } as const;
export default function SchedulePage() {
  const [side] = useProdSide();
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Machines, days and jobs in run order</div><h1>{NAME[side as keyof typeof NAME] || "Production"} Schedule</h1></div></div>
      <MachineSchedule />
    </>
  );
}
