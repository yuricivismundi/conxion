import { redirect } from "next/navigation";

export default function NetworkConnectionsPage() {
  redirect("/network?tab=connections");
}
