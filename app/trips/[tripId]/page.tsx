import { redirect } from "next/navigation";

export default async function TripDetailsPage() {
  redirect("/activity?tab=trips");
}
