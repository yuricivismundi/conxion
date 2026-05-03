import type { Metadata } from "next";
import Link from "next/link";
import BlogPostCard from "@/components/blog/BlogPostCard";
import { BLOG_DESCRIPTION, getAllBlogPosts } from "@/content/blog/posts";
import { absolutePublicAppUrl } from "@/lib/public-app-url";

const blogIndexUrl = absolutePublicAppUrl("/blog");
const socialImage = absolutePublicAppUrl(getAllBlogPosts()[0]?.coverImage ?? "/branding/CONXION-2-favicon.png?v=17");

export const metadata: Metadata = {
  title: "ConXion Blog",
  description: BLOG_DESCRIPTION,
  alternates: {
    canonical: "/blog",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "ConXion Blog",
    description: BLOG_DESCRIPTION,
    url: blogIndexUrl,
    type: "website",
    images: [
      {
        url: socialImage,
        width: 1200,
        height: 630,
        alt: "ConXion blog featured article cover",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ConXion Blog",
    description: BLOG_DESCRIPTION,
    images: [socialImage],
  },
};

export default function BlogIndexPage() {
  const posts = getAllBlogPosts();
  const featuredPost = posts[0];
  const remainingPosts = posts.slice(1);

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 pb-16 pt-6 sm:px-6 sm:pb-20 sm:pt-8">
      <header className="relative overflow-hidden rounded-[36px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(0,245,255,0.12),transparent_32%),radial-gradient(circle_at_top_right,rgba(255,0,255,0.10),transparent_28%),rgba(255,255,255,0.03)] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.3)] sm:p-8 lg:p-10">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(0,245,255,0.04),transparent_35%,rgba(255,0,255,0.05))]" />
        <div className="relative z-10 max-w-4xl">
          <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">Guides for a more coordinated dance life</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">{BLOG_DESCRIPTION}</p>
        </div>
      </header>

      {featuredPost ? (
        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-white">Featured article</h2>
              <p className="mt-1 text-sm text-slate-400">Start with the clearest introduction to what ConXion is for.</p>
            </div>
          </div>
          <BlogPostCard post={featuredPost} priority featured />
        </section>
      ) : null}

      <section className="mt-10">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-white">Latest articles</h2>
            <p className="mt-1 text-sm text-slate-400">Community, trust, teachers, and travel guidance in one place.</p>
          </div>
          <Link href="/support" className="text-sm font-semibold text-cyan-100 transition hover:text-white">
            Need product help instead?
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {remainingPosts.map((post) => (
            <BlogPostCard key={post.slug} post={post} />
          ))}
        </div>
      </section>
    </main>
  );
}
