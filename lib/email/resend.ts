const RESEND_API_BASE = "https://api.resend.com";

export type SendResendEmailParams = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
};

export type SendResendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: true; error: string }
  | { ok: false; skipped?: false; error: string };

export function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

export async function sendResendEmail(params: SendResendEmailParams): Promise<SendResendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();

  if (!apiKey || !from) {
    return { ok: false, skipped: true, error: "Resend is not configured." };
  }

  const response = await fetch(`${RESEND_API_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "with/transactional-email",
      ...(params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(params.to) ? params.to : [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { id?: string; message?: string; name?: string }
    | null;

  if (!response.ok) {
    return {
      ok: false,
      error: payload?.message ?? payload?.name ?? `Resend request failed with status ${response.status}.`,
    };
  }

  return { ok: true, id: payload?.id ?? null };
}
