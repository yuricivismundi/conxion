import { redirect } from "next/navigation";

export default function NetworkRequestsPage() {
  redirect("/messages?tab=requests");
}
