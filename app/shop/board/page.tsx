"use client";
import MachineSchedule from "@/components/MachineSchedule";

/** Production: the production calendar (machines, days, jobs in run order). The order pipeline lives on the dashboard. */
export default function ProductionPage() {
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Machines, days and jobs in run order</div><h1>Production</h1></div></div>
      <MachineSchedule />
    </>
  );
}
