import { redirect } from "next/navigation";

/** Incoming Orders is the Job Center's Requests step now (Oct 29, Nick: "incoming orders goes into requests"). */
export default function Incoming() {
  redirect("/shop/jobs?step=requests");
}
