import { redirect } from "next/navigation";

export default function MySpaceCompetitionsPage() {
  redirect("/dashboard#competitions");
}
