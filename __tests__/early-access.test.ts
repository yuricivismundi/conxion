import { describe, expect, it } from "vitest";
import { evaluateHostingTrust } from "@/lib/hosting/trust-gate";
import { resolveDancePageLabel, showsTeachingSections } from "@/lib/dance-page";
import { getPlanIdFromMeta } from "@/lib/billing/limits";
import { canUseTeacherProfile } from "@/lib/teacher-profile/access";

const NOW = new Date("2026-10-20T12:00:00Z");
const OLD_ACCOUNT = "2026-09-01T00:00:00Z";
const NEW_ACCOUNT = "2026-10-18T00:00:00Z";

describe("early access plan", () => {
  it("gives every account Plus limits", () => {
    expect(getPlanIdFromMeta({})).toBe("pro");
  });

  it("lets anyone use the Dance Page without a trial or verification", () => {
    expect(
      canUseTeacherProfile({ roles: ["Social Dancer"], teacherProfileEnabled: true, trialEndsAt: null, isVerified: false })
    ).toBe(true);
    expect(
      canUseTeacherProfile({ roles: ["Social Dancer"], teacherProfileEnabled: false, trialEndsAt: null, isVerified: false })
    ).toBe(false);
  });
});

describe("hosting trust gate", () => {
  const APPROVED = {
    display_name: "Ana",
    avatar_path: "avatars/u1.jpg",
    avatar_status: "approved",
    bio: "Bachata and salsa dancer from Tallinn, travelling to festivals.",
    city: "Tallinn",
    country: "Estonia",
    dance_skills: { bachata: { level: "intermediate" } },
    roles: ["Social Dancer"],
  };

  it("allows a complete profile with an admin-approved photo", () => {
    expect(evaluateHostingTrust(APPROVED, NEW_ACCOUNT, NOW)).toEqual({ allowed: true, missing: [] });
  });

  it("blocks while the photo is waiting for admin review", () => {
    expect(evaluateHostingTrust({ ...APPROVED, avatar_status: "pending" }, OLD_ACCOUNT, NOW).missing).toEqual(["photo_pending"]);
  });

  it("blocks when the photo was rejected", () => {
    expect(evaluateHostingTrust({ ...APPROVED, avatar_status: "rejected", avatar_path: null, avatar_url: "/no-avatar-photo" }, OLD_ACCOUNT, NOW).missing).toEqual(["photo_rejected"]);
  });

  it("treats the default pravatar avatar as no photo and lists everything missing", () => {
    const result = evaluateHostingTrust({ avatar_url: "https://i.pravatar.cc/300", avatar_status: "pending", bio: "hi" }, OLD_ACCOUNT, NOW);
    expect(result.allowed).toBe(false);
    expect(result.missing).toEqual(["display_name", "photo", "bio", "city", "country", "dance_styles", "roles"]);
  });

  it("applies to Verified members too", () => {
    expect(evaluateHostingTrust({ ...APPROVED, verified: true, avatar_status: "pending" }, OLD_ACCOUNT, NOW).allowed).toBe(false);
  });

  it("can be switched to login-only", () => {
    expect(evaluateHostingTrust({}, NEW_ACCOUNT, NOW, { enforceGate: false }).allowed).toBe(true);
  });
});

describe("Dance Page label", () => {
  it("uses the chosen label, else derives it from roles", () => {
    expect(resolveDancePageLabel("Competitor", ["Teacher"])).toBe("Competitor");
    expect(resolveDancePageLabel(null, ["Social Dancer", "DJ"])).toBe("DJ");
    expect(resolveDancePageLabel(undefined, [])).toBe("Social Dancer");
  });

  it("shows teaching sections only for teachers", () => {
    expect(showsTeachingSections("Teacher", [])).toBe(true);
    expect(showsTeachingSections("Artist", ["teacher"])).toBe(true);
    expect(showsTeachingSections("Competitor", ["Social Dancer"])).toBe(false);
  });
});
