import { redirect } from "next/navigation";

export default function TripsRequestsPage() {
  redirect("/messages?tab=requests");
}
