import Link from "next/link";
import { notFound } from "next/navigation";
import InfoPageShell from "@/components/InfoPageShell";
import { getHelpArticle, getHelpCategory, HELP_ARTICLES } from "@/lib/help-center/content";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return HELP_ARTICLES.map((article) => ({ slug: article.slug }));
}

export default async function HelpArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = getHelpArticle(slug);
  if (!article) notFound();

  const category = getHelpCategory(article.category);
  const relatedArticles = article.related
    .map((relatedSlug) => getHelpArticle(relatedSlug))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <InfoPageShell title={article.title} description={article.summary}>
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Link href="/support" className="hover:text-cyan-300">
          Help Center
        </Link>
        <span>/</span>
        <span>{category?.title ?? "Article"}</span>
      </div>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
          <div className="flex flex-wrap items-center gap-3">
            {category ? (
              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100">
                {category.title}
              </span>
            ) : null}
            <span className="text-xs text-slate-500">Updated {article.updatedAt}</span>
          </div>

          <div className="mt-6 space-y-6 text-lg leading-9 text-slate-200">
            {article.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-fuchsia-300/20 bg-fuchsia-300/10 p-5">
            <h2 className="text-lg font-bold text-fuchsia-50">Need policy-level detail?</h2>
            <p className="mt-2 text-sm leading-7 text-fuchsia-100/90">
              Open the Trust & Safety Guidelines for full policy coverage, reporting scope, emergency guidance, and how moderation handles cases.
            </p>
            <div className="mt-4">
              <Link
                href="/safety-center"
                className="rounded-lg border border-fuchsia-300/35 bg-fuchsia-300/12 px-3 py-1.5 text-xs font-semibold text-fuchsia-50 hover:bg-fuchsia-300/18"
              >
                Open Safety Center
              </Link>
            </div>
          </div>
        </article>

        <aside className="space-y-6">
          <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
            <h2 className="text-lg font-bold text-white">Related articles</h2>
            <div className="mt-4 space-y-3">
              {relatedArticles.map((related) => (
                <Link key={related.slug} href={`/support/articles/${related.slug}`} className="block text-base leading-7 text-cyan-100 hover:text-white">
                  {related.title}
                </Link>
              ))}
            </div>
          </article>

          <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
            <h2 className="text-lg font-bold text-white">Need manual review?</h2>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              If the issue requires moderation, use the in-app report flow so it creates a support ticket and lands in the admin queue with the correct context.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/support"
                className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20"
              >
                Back to Help Center
              </Link>
              <Link
                href="/references"
                className="rounded-lg border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-semibold text-white/85 hover:border-white/35 hover:text-white"
              >
                Open references
              </Link>
            </div>
          </article>
        </aside>
      </section>
    </InfoPageShell>
  );
}
