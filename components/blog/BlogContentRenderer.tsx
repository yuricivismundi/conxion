import type { BlogPostSection } from "@/content/blog/posts";

export default function BlogContentRenderer({ sections }: { sections: BlogPostSection[] }) {
  return (
    <div className="space-y-10">
      {sections.map((section, index) => (
        <section key={`${section.heading ?? "section"}-${index}`} className="space-y-5">
          {section.heading ? <h2 className="text-2xl font-bold tracking-tight text-white">{section.heading}</h2> : null}

          {section.paragraphs?.map((paragraph, paragraphIndex) => (
            <p key={`p-${paragraphIndex}`} className="text-base leading-8 text-slate-300 sm:text-[17px]">
              {paragraph}
            </p>
          ))}

          {section.bullets?.length ? (
            <ul className="space-y-3 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
              {section.bullets.map((bullet, bulletIndex) => (
                <li key={`b-${bulletIndex}`} className="flex items-start gap-3 text-sm leading-6 text-slate-300 sm:text-base">
                  <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF]" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}
