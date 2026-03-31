import { redirect } from "next/navigation";

export default function MySpaceGoalsPage() {
  redirect("/dashboard#goals");
}
