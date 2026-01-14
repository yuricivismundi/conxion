// app/onboarding/page.tsx
import { redirect } from "next/navigation";

export default function OnboardingPage() {
  redirect("/connections"); // <- your post-onboarding landing
}