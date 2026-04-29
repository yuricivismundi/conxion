import { redirect } from "next/navigation";

export default function TripsMyPage() {
  redirect("/activity?tab=trips");
}
