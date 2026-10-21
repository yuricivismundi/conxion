import { renderBrandedEmail, absoluteAppUrl } from "@/lib/email/branding";

export * from "@/lib/invites/limits";

export function buildInviteEmail(params: { inviterName: string; note: string | null }) {
  const inviter = params.inviterName.trim() || "A dancer";
  const signupUrl = absoluteAppUrl("/auth");
  const subject = `${inviter} invited you to ConXion`;
  const rendered = renderBrandedEmail({
    recipientName: "",
    showGreeting: false,
    eyebrow: "You're invited",
    title: `${inviter} wants you on ConXion`,
    intro: params.note
      ? `"${params.note}"`
      : `${inviter} thinks you'd like ConXion, the community app for social dancers.`,
    detailStyle: "list",
    detailLines: [
      "Build your free Dance Page: bio, videos, upcoming events and competitions in one link.",
      "Find socials, festivals and dancers when you travel.",
      "Free during early access. Join now and keep the Founding Member badge.",
    ],
    ctaLabel: "Create my account",
    ctaUrl: signupUrl,
    footerNote: `You received this one-time email because ${inviter} entered your address on ConXion. We won't email you again unless you sign up.`,
  });
  return { subject, html: rendered.html, text: rendered.text };
}
