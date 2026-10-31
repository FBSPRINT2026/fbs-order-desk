"use client";
import SettingsTabs, { SettingsHead } from "@/components/SettingsTabs";
import OrderTrainingAdmin from "@/components/OrderTrainingAdmin";

/** Settings → Assistant & AI → Order training: every customer Create order has been taught (Oct 30, Nick) */
export default function Page() {
  return (
    <>
      <SettingsHead title="Assistant & AI" note="Order training: what Create order follows for each customer, and what it learned from finished orders" />
      <SettingsTabs />
      <OrderTrainingAdmin />
    </>
  );
}
