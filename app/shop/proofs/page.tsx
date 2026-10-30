import { redirect } from "next/navigation";

/** The Proof Center is part of the Job Center now: Ready, Sent, Make changes and Approved (Oct 29, Nick). */
export default function Proofs() {
  redirect("/shop/jobs?step=sent");
}
