import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import BlogContentRenderer from "@/components/blog/BlogContentRenderer";
import BlogSharePanel from "@/components/blog/BlogSharePanel";
import { formatBlogDate, getAllBlogPosts, getBlogPost, getBlogPostAbsoluteUrl, type BlogPost } from "@/content/blog/posts";
import { absolutePublicAppUrl } from "@/lib/public-app-url";

type PageProps = {
  params: Promise<{ slug: string }>;
};

function buildArticleMetadata(post: BlogPost): Metadata {
  const url = getBlogPostAbsoluteUrl(post.slug);
  const imageUrl = absolutePublicAppUrl(post.coverImage);

  return {
    title: post.metaTitle,
    description: post.metaDescription,
    alternates: {
      canonical: `/blog/${post.slug}`,
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title: post.metaTitle,
      description: post.metaDescription,
      url,
      type: "article",
      publishedTime: post.publishedAt,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: post.coverImageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.metaTitle,
      description: post.metaDescription,
      images: [imageUrl],
    },
  };
}

export function generateStaticParams() {
  return getAllBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) {
    return {
      title: "Article not found | ConXion Blog",
      description: "The requested blog article could not be found.",
      robots: {
        index: false,
        follow: false,
      },
    };
  }
  return buildArticleMetadata(post);
}

export default async function BlogArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const url = getBlogPostAbsoluteUrl(post.slug);
  const imageUrl = absolutePublicAppUrl(post.coverImage);
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.metaDescription,
    datePublished: post.publishedAt,
    dateModified: post.publishedAt,
    mainEntityOfPage: url,
    image: [imageUrl],
    author: {
      "@type": "Organization",
      name: "ConXion",
    },
    publisher: {
      "@type": "Organization",
      name: "ConXion",
      logo: {
        "@type": "ImageObject",
        url: absolutePublicAppUrl("/branding/CONXION-2-tight.png?v=14"),
      },
    },
  };

  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-8">
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
          <li>
            <Link href="/" className="transition hover:text-white">
              Home
            </Link>
          </li>
          <li className="text-white/25">/</li>
          <li>
            <Link href="/blog" className="transition hover:text-white">
              Blog
            </Link>
          </li>
          <li className="text-white/25">/</li>
          <li className="text-white/70">{post.category}</li>
        </ol>
      </nav>

      <article className="overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.03] shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
        <header className="p-6 sm:p-8 lg:p-10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
              {post.category}
            </span>
            <span className="text-xs text-slate-400">{formatBlogDate(post.date)}</span>
            <span className="text-xs text-white/25">•</span>
            <span className="text-xs text-slate-400">{post.readTime}</span>
          </div>

          <h1 className="mt-5 max-w-4xl text-3xl font-black tracking-tight text-white sm:text-4xl lg:text-[3.15rem] lg:leading-[1.04]">{post.title}</h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">{post.excerpt}</p>
        </header>

        <div className="grid gap-10 border-t border-white/10 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:p-10">
          <div className="space-y-8">
            <div className="relative overflow-hidden rounded-[28px] aspect-[1200/630] min-h-[280px]">
              <Image
                src={post.coverImage}
                alt={post.coverImageAlt}
                fill
                priority
                sizes="(min-width: 1024px) 60vw, 100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#080808]/10 via-transparent to-transparent" />
            </div>
            <BlogContentRenderer sections={post.sections} />
          </div>

          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <BlogSharePanel title={post.title} url={url} />

            <section className="rounded-[28px] border border-white/10 bg-black/20 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Keep reading</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">Explore the rest of the ConXion blog for travel, teaching, hosting, and community guidance.</p>
              <Link
                href="/blog"
                className="mt-4 inline-flex min-h-11 items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-300/15"
              >
                Back to blog
              </Link>
            </section>
          </aside>
        </div>
      </article>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />
    </main>
  );
}
