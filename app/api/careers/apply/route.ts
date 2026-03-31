import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { CAREER_DAILY_SUBMISSION_LIMIT, CAREER_ROLE_IDS, CAREER_ROLES } from "@/lib/careers";
import { getBearerToken, getSupabaseUserClient } from "@/lib/supabase/user-server-client";

type CareerApplyPayload = {
  roleId?: unknown;
  fullName?: unknown;
  email?: unknown;
  location?: unknown;
  linkedinUrl?: unknown;
  portfolioUrl?: unknown;
  cvUrl?: unknown;
  coverLetter?: unknown;
};

const ALLOWED_CV_EXTENSIONS = new Set(["pdf", "doc", "docx"]);
const MAX_CV_FILE_BYTES = 8 * 1024 * 1024;

function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getDailySubmissionLimit() {
  const parsed = Number(process.env.CAREERS_DAILY_APPLICATION_LIMIT);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 20) return Math.floor(parsed);
  return CAREER_DAILY_SUBMISSION_LIMIT;
}

function asTrimmed(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function asOptionalUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? text : "";
  } catch {
    return "";
  }
}

function sanitizeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function getFileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] ?? "" : "";
}

async function parsePayload(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const fileRaw = formData.get("cvFile");
    const cvFile = fileRaw instanceof File && fileRaw.size > 0 ? fileRaw : null;
    return {
      roleId: asTrimmed(formData.get("roleId"), 80),
      fullName: asTrimmed(formData.get("fullName"), 120),
      email: asTrimmed(formData.get("email"), 190).toLowerCase(),
      location: asTrimmed(formData.get("location"), 120),
      linkedinUrl: asOptionalUrl(formData.get("linkedinUrl")),
      portfolioUrl: asOptionalUrl(formData.get("portfolioUrl")),
      cvUrl: asOptionalUrl(formData.get("cvUrl")),
      coverLetter: asTrimmed(formData.get("coverLetter"), 3000),
      cvFile,
    };
  }

  const raw = (await req.json().catch(() => null)) as CareerApplyPayload | null;
  return {
    roleId: asTrimmed(raw?.roleId, 80),
    fullName: asTrimmed(raw?.fullName, 120),
    email: asTrimmed(raw?.email, 190).toLowerCase(),
    location: asTrimmed(raw?.location, 120),
    linkedinUrl: asOptionalUrl(raw?.linkedinUrl),
    portfolioUrl: asOptionalUrl(raw?.portfolioUrl),
    cvUrl: asOptionalUrl(raw?.cvUrl),
    coverLetter: asTrimmed(raw?.coverLetter, 3000),
    cvFile: null,
  };
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const realIp = req.headers.get("x-real-ip");
  return realIp ? realIp.slice(0, 128) : "";
}

function dayBoundsUtc() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

function roleTitleFromId(roleId: string) {
  return CAREER_ROLES.find((role) => role.id === roleId)?.title ?? "ConXion Role";
}

export async function POST(req: Request) {
  let cvStoragePath: string | null = null;
  const supabaseAdmin = getSupabaseAdminClient();
  try {
    if (!supabaseAdmin) {
      return NextResponse.json(
        { ok: false, error: "Careers service is not configured. Missing Supabase service credentials." },
        { status: 500 }
      );
    }

    const parsed = await parsePayload(req);
    const { roleId, fullName, email, location, linkedinUrl, portfolioUrl, coverLetter } = parsed;
    let cvUrl = parsed.cvUrl;
    const cvFile = parsed.cvFile;
    const dailyLimit = getDailySubmissionLimit();

    if (!roleId || !CAREER_ROLE_IDS.has(roleId)) {
      return NextResponse.json({ ok: false, error: "Select a valid role." }, { status: 400 });
    }
    if (fullName.length < 2) {
      return NextResponse.json({ ok: false, error: "Full name is required." }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ ok: false, error: "Valid email is required." }, { status: 400 });
    }
    if (!cvUrl && !cvFile) {
      return NextResponse.json({ ok: false, error: "Attach a CV file or provide a CV URL." }, { status: 400 });
    }
    if (cvFile) {
      if (cvFile.size > MAX_CV_FILE_BYTES) {
        return NextResponse.json({ ok: false, error: "CV file is too large. Max size is 8MB." }, { status: 400 });
      }
      const ext = getFileExtension(cvFile.name);
      if (!ALLOWED_CV_EXTENSIONS.has(ext)) {
        return NextResponse.json({ ok: false, error: "CV file must be PDF, DOC, or DOCX." }, { status: 400 });
      }
    }
    if (coverLetter.length < 120) {
      return NextResponse.json(
        { ok: false, error: "Cover letter is too short. Please provide more detail (minimum 120 chars)." },
        { status: 400 }
      );
    }

    const ipAddress = getClientIp(req);
    const userAgent = asTrimmed(req.headers.get("user-agent") ?? "", 256);
    const { start, end } = dayBoundsUtc();

    const emailLimitCheck = await supabaseAdmin
      .from("careers_applications")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", start)
      .lt("created_at", end);
    if (emailLimitCheck.error) {
      return NextResponse.json({ ok: false, error: emailLimitCheck.error.message }, { status: 500 });
    }
    if ((emailLimitCheck.count ?? 0) >= dailyLimit) {
      return NextResponse.json(
        { ok: false, error: `Daily limit reached. You can submit up to ${dailyLimit} applications per day.` },
        { status: 429 }
      );
    }

    if (ipAddress) {
      const ipLimitCheck = await supabaseAdmin
        .from("careers_applications")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", ipAddress)
        .gte("created_at", start)
        .lt("created_at", end);
      if (ipLimitCheck.error) {
        return NextResponse.json({ ok: false, error: ipLimitCheck.error.message }, { status: 500 });
      }
      if ((ipLimitCheck.count ?? 0) >= dailyLimit) {
        return NextResponse.json(
          { ok: false, error: `Daily limit reached for this network. Try again tomorrow.` },
          { status: 429 }
        );
      }
    }

    let userId: string | null = null;
    const token = getBearerToken(req);
    if (token) {
      try {
        const supabaseUser = getSupabaseUserClient(token);
        const { data: authData, error: authErr } = await supabaseUser.auth.getUser(token);
        if (!authErr && authData.user) userId = authData.user.id;
      } catch {
        userId = null;
      }
    }

    let cvFileName: string | null = null;

    if (cvFile) {
      const ext = getFileExtension(cvFile.name);
      const normalizedName = sanitizeFileName(cvFile.name) || `cv.${ext}`;
      const folder = new Date().toISOString().slice(0, 10);
      const storagePath = `${folder}/${randomUUID()}-${normalizedName}`;
      const fileBuffer = Buffer.from(await cvFile.arrayBuffer());
      const uploadRes = await supabaseAdmin.storage
        .from("careers-cv")
        .upload(storagePath, fileBuffer, { contentType: cvFile.type || "application/octet-stream", upsert: false });
      if (uploadRes.error) {
        return NextResponse.json({ ok: false, error: `Failed to upload CV file: ${uploadRes.error.message}` }, { status: 500 });
      }
      cvStoragePath = uploadRes.data.path;
      cvFileName = cvFile.name.slice(0, 190);
      cvUrl = "";
    }

    const insertRes = await supabaseAdmin
      .from("careers_applications")
      .insert({
        role_id: roleId,
        role_title: roleTitleFromId(roleId),
        full_name: fullName,
        email,
        location: location || null,
        linkedin_url: linkedinUrl || null,
        portfolio_url: portfolioUrl || null,
        cv_url: cvUrl || null,
        cv_storage_path: cvStoragePath,
        cv_file_name: cvFileName,
        cover_letter: coverLetter,
        user_id: userId,
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
      })
      .select("id,created_at")
      .single();

    if (insertRes.error) {
      if (cvStoragePath) {
        await supabaseAdmin.storage.from("careers-cv").remove([cvStoragePath]).catch(() => undefined);
      }
      return NextResponse.json({ ok: false, error: insertRes.error.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        applicationId: insertRes.data.id,
        createdAt: insertRes.data.created_at,
        dailyLimit,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (cvStoragePath && supabaseAdmin) {
      await supabaseAdmin.storage.from("careers-cv").remove([cvStoragePath]).catch(() => undefined);
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to submit application." },
      { status: 500 }
    );
  }
}
