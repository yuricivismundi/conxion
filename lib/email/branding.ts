import { readPublicAppUrl } from "@/lib/public-app-url";

type RenderBrandedEmailParams = {
  recipientName: string;
  eyebrow: string;
  title: string;
  intro: string;
  detailLines: string[];
  heroBadge?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  heroBody?: string;
  heroTheme?: "trip";
  detailStyle?: "stack" | "list";
  ctaLabel: string;
  ctaUrl: string;
  footerNote: string;
  ctaHint?: string;
  titleSizePx?: number;
  logoWidthPx?: number;
  showGreeting?: boolean;
  showFooterNote?: boolean;
  showFallbackLink?: boolean;
};

export const EMAIL_BRAND = {
  bg: "#090F16",
  card: "#151C27",
  panel: "#0D141C",
  text: "#FFFFFF",
  muted: "#A7B1C2",
  border: "rgba(255,255,255,0.08)",
  cyan: "#1DD9FF",
  magenta: "#D93BFF",
};

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function readAppBaseUrl() {
  const vercel = process.env.VERCEL_URL?.trim().replace(/\/+$/, "");
  return readPublicAppUrl(vercel ? `https://${vercel}` : "http://localhost:3000");
}

export function absoluteAppUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${readAppBaseUrl()}${normalized}`;
}

export function renderBrandedEmail(params: RenderBrandedEmailParams) {
  const detailLines = params.detailLines.filter((line) => line.trim().length > 0);
  const detailItems =
    params.detailStyle === "list"
      ? `<ul style="margin:0;padding:0 0 0 18px;color:${EMAIL_BRAND.muted};font-size:15px;line-height:1.6;text-align:left;">
          ${detailLines
            .map((line) => `<li style="margin:0 0 8px;">${escapeHtml(line)}</li>`)
            .join("")}
        </ul>`
      : detailLines
          .map(
            (line) =>
              `<div style="margin:0 0 10px;padding:0;color:${EMAIL_BRAND.muted};font-size:15px;line-height:1.65;">${escapeHtml(line)}</div>`
          )
          .join("");

  const logoUrl = absoluteAppUrl("/branding/CONXION-3-tight.png");
  const ctaUrl = escapeHtml(params.ctaUrl);
  const introBody = params.showGreeting === false ? escapeHtml(params.intro) : `Hi ${escapeHtml(params.recipientName)},<br />${escapeHtml(params.intro)}`;
  const showFooterNote = params.showFooterNote !== false && params.footerNote.trim().length > 0;
  const showFallbackLink = params.showFallbackLink !== false;
  const titleSizePx = params.titleSizePx ?? 42;
  const logoWidthPx = params.logoWidthPx ?? 220;
  const heroBlock =
    params.heroTheme === "trip" && (params.heroTitle?.trim() || params.heroBadge?.trim())
      ? `<div style="margin:14px auto 0;max-width:520px;padding:28px 18px 22px;border-radius:28px;background:
          radial-gradient(circle at top left, rgba(29,217,255,0.10), transparent 34%),
          radial-gradient(circle at top right, rgba(217,59,255,0.12), transparent 36%),
          linear-gradient(180deg, rgba(24,31,43,0.98) 0%, rgba(18,24,34,0.98) 100%);
          border:1px solid rgba(255,255,255,0.06);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 24px 50px rgba(0,0,0,0.34);">
          ${
            params.heroBadge?.trim()
              ? `<div style="display:inline-block;margin:0 auto 18px;padding:12px 22px;border-radius:999px;background:rgba(10,15,24,0.88);border:1px solid rgba(255,255,255,0.08);box-shadow:inset 0 1px 0 rgba(255,255,255,0.06);color:#F7F9FC;font-size:14px;font-weight:900;letter-spacing:0.05em;text-transform:uppercase;">
                  <span style="color:${EMAIL_BRAND.cyan};margin-right:10px;">&#128197;</span>${escapeHtml(params.heroBadge)}
                </div>`
              : ""
          }
          <div style="margin:0 auto;max-width:380px;">
            <div style="font-size:42px;line-height:1;letter-spacing:-0.04em;font-weight:900;color:${EMAIL_BRAND.cyan};text-shadow:0 0 14px rgba(29,217,255,0.14);">
              ${escapeHtml(params.heroTitle || "")}
            </div>
            ${
              params.heroSubtitle?.trim()
                ? `<div style="margin:12px 0 0;font-size:16px;line-height:1.2;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:#C9D1DC;">
                    ${escapeHtml(params.heroSubtitle)}
                  </div>`
                : ""
            }
            ${
              params.heroBody?.trim()
                ? `<div style="margin:18px 0 0;font-size:16px;line-height:1.6;color:${EMAIL_BRAND.muted};">
                    ${escapeHtml(params.heroBody)}
                  </div>`
                : ""
            }
          </div>
        </div>`
      : "";

  const html = `
    <!DOCTYPE html>
    <html lang="en" style="margin:0;padding:0;background:${EMAIL_BRAND.bg};">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(params.title)}</title>
      </head>
      <body style="margin:0;padding:0;background:${EMAIL_BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${EMAIL_BRAND.text};" bgcolor="${EMAIL_BRAND.bg}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;padding:0;background:${EMAIL_BRAND.bg};border-collapse:collapse;" bgcolor="${EMAIL_BRAND.bg}">
          <tr>
            <td align="center" style="padding:28px 14px;background:${EMAIL_BRAND.bg};" bgcolor="${EMAIL_BRAND.bg}">
              <div style="max-width:680px;margin:0 auto;border-radius:36px;background:${EMAIL_BRAND.card};overflow:hidden;box-shadow:0 25px 80px rgba(0,0,0,0.35);">
                <div style="padding:44px 28px 48px;text-align:center;background:
          radial-gradient(circle at top left, rgba(29,217,255,0.08), transparent 32%),
          radial-gradient(circle at top right, rgba(217,59,255,0.10), transparent 34%),
          ${EMAIL_BRAND.card};">
          <img src="${escapeHtml(logoUrl)}" alt="ConXion" style="display:block;margin:0 auto 24px;width:${logoWidthPx}px;max-width:68%;height:auto;" />
          ${
            params.eyebrow.trim()
              ? `<div style="display:inline-block;margin:0 0 22px;padding:8px 14px;border-radius:999px;border:1px solid ${EMAIL_BRAND.border};font-size:11px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:${EMAIL_BRAND.muted};">
            ${escapeHtml(params.eyebrow)}
          </div>`
              : ""
          }
          ${
            heroBlock ||
            `<h1 style="margin:0;font-size:${titleSizePx}px;line-height:1.08;letter-spacing:-0.035em;font-weight:900;color:${EMAIL_BRAND.text};">
            ${escapeHtml(params.title)}
          </h1>`
          }
          ${
            params.intro.trim()
              ? `<p style="margin:16px 0 0;font-size:${params.heroTheme === "trip" ? 16 : 15}px;line-height:1.65;color:${EMAIL_BRAND.muted};">
            ${introBody}
          </p>`
              : ""
          }
          ${
            detailItems
              ? `<div style="margin:28px auto 0;max-width:520px;padding:20px 18px;border-radius:24px;background:${EMAIL_BRAND.panel};border:1px solid ${EMAIL_BRAND.border};text-align:center;">${detailItems}</div>`
              : ""
          }
          <div style="margin:30px 0 0;">
            <a href="${ctaUrl}" style="display:inline-block;padding:18px 34px;border-radius:24px;background:linear-gradient(90deg, ${EMAIL_BRAND.cyan} 0%, ${EMAIL_BRAND.magenta} 100%);color:#071017;text-decoration:none;font-size:16px;font-weight:900;letter-spacing:-0.01em;">
              ${escapeHtml(params.ctaLabel)}
            </a>
          </div>
          ${
            params.ctaHint?.trim()
              ? `<p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#8F99AA;">${escapeHtml(params.ctaHint)}</p>`
              : ""
          }
          ${
            showFooterNote
              ? `<p style="margin:24px 0 0;font-size:12px;line-height:1.75;color:${EMAIL_BRAND.muted};">
            ${escapeHtml(params.footerNote)}
          </p>`
              : ""
          }
          ${
            showFallbackLink
              ? `<p style="margin:18px 0 0;font-size:11px;line-height:1.7;color:#7E8797;">
            If the button does not work, open ${ctaUrl}
          </p>`
              : ""
          }
          <p style="margin:30px 0 0;font-size:11px;line-height:1.7;color:#7E8797;">
            © ${new Date().getFullYear()} ConXion Social App
          </p>
                </div>
              </div>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `.trim();

  const text = [
    `ConXion | ${params.eyebrow}`,
    "",
    ...(params.heroBadge?.trim() ? [params.heroBadge, ""] : []),
    ...(params.heroTitle?.trim() ? [params.heroTitle] : []),
    ...(params.heroSubtitle?.trim() ? [params.heroSubtitle, ""] : []),
    ...(params.heroBody?.trim() ? [params.heroBody, ""] : []),
    ...(!params.heroTitle?.trim() ? [params.title, ""] : []),
    ...(params.showGreeting === false ? [] : [`Hi ${params.recipientName},`, ""]),
    params.intro,
    "",
    ...detailLines.map((line) => `- ${line}`),
    "",
    `${params.ctaLabel}: ${params.ctaUrl}`,
    "",
    ...(params.ctaHint?.trim() ? [params.ctaHint, ""] : []),
    ...(showFooterNote ? [params.footerNote] : []),
  ].join("\n");

  return { html, text };
}
