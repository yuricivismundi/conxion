import Image from "next/image";
import Link from "next/link";
import { formatBlogDate, getBlogPostUrl, type BlogPost } from "@/content/blog/posts";

function getCategoryClasses(category: string) {
  switch (category) {
    case "Community":
      return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
    case "Guide":
      return "border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-100";
    case "Teachers":
      return "border-violet-300/25 bg-violet-300/10 text-violet-100";
    case "Travel":
      return "border-orange-300/25 bg-orange-300/10 text-orange-100";
    default:
      return "border-white/10 bg-white/[0.04] text-white/80";
  }
}

export default function BlogPostCard({
  post,
  priority = false,
  featured = false,
}: {
  post: BlogPost;
  priority?: boolean;
  featured?: boolean;
}) {
  return (
    <article
      className={[
        "group overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] shadow-[0_18px_45px_rgba(0,0,0,0.24)] transition-[border-color,box-shadow,background-color]",
        "hover:border-white/15 hover:bg-white/[0.04] hover:shadow-[0_22px_52px_rgba(0,0,0,0.28)]",
        featured ? "grid gap-0 lg:grid-cols-[1.2fr_0.8fr]" : "flex h-full flex-col",
      ].join(" ")}
    >
      <Link href={getBlogPostUrl(post.slug)} className={featured ? "order-2 lg:order-1" : ""}>
        <div className={featured ? "relative h-full min-h-[280px]" : "relative aspect-[1200/630]"}>
          <Image
            src={post.coverImage}
            alt={post.coverImageAlt}
            fill
            priority={priority}
            sizes={featured ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1280px) 24vw, (min-width: 768px) 48vw, 100vw"}
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-[#080808]/45 to-transparent" />
        </div>
      </Link>

      <div className={featured ? "order-1 flex flex-col justify-between p-6 sm:p-8 lg:order-2" : "flex flex-1 flex-col p-5"}>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${getCategoryClasses(post.category)}`}>
              {post.category}
            </span>
            <span className="text-xs text-white/40">{formatBlogDate(post.date)}</span>
            <span className="text-xs text-white/25">•</span>
            <span className="text-xs text-white/40">{post.readTime}</span>
          </div>

          <h2 className={featured ? "mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl" : "mt-4 text-xl font-bold leading-tight text-white"}>
            <Link href={getBlogPostUrl(post.slug)} className="transition hover:text-cyan-100">
              {post.title}
            </Link>
          </h2>

          <p className={featured ? "mt-4 max-w-xl text-base leading-7 text-slate-300" : "mt-3 text-sm leading-6 text-slate-300"}>
            {post.excerpt}
          </p>
        </div>

        <div className={featured ? "mt-6" : "mt-5"}>
          <Link
            href={getBlogPostUrl(post.slug)}
            className="inline-flex min-h-11 items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-5 py-2.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-300/15"
          >
            Read article
          </Link>
        </div>
      </div>
    </article>
  );
}
