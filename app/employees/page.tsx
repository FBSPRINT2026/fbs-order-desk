import { redirect } from "next/navigation";

/** An easy address to share with the crew (Nick, Nov 13 2026: "portal.fbsprint.com/employee… a link that I can share with
 *  them, so it brings them to their phone menu"): the crew's main menu, /crew. */
export default function EmployeeLink() {
  redirect("/crew");
}
