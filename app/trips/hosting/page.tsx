import { redirect } from "next/navigation";

export default function TripsHostingPage() {
  redirect("/activity?tab=hosting");
}
