import { redirect } from "next/navigation";

export default function ConnectionsRequestsPage() {
  redirect("/messages?tab=requests");
}
