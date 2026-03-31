import { redirect } from "next/navigation";

export default function OrganizingEventsPage() {
  redirect("/events?view=organizing");
}

