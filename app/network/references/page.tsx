import { redirect } from "next/navigation";

export default function NetworkReferencesPage() {
  redirect("/network?tab=references");
}
