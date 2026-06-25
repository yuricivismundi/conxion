type TeacherReference = {
  id: string;
  client_name: string;
  client_context: string | null;
  testimonial: string;
  rating: number | null;
  reference_year: number | null;
};

type Props = {
  references: TeacherReference[];
  isOwner?: boolean;
  teacherUserId?: string;
};

export default function TeacherReferencesSection({ references, isOwner, teacherUserId }: Props) {
  if (references.length === 0 && !isOwner) return null;

  return (
    <section className="mb-12 sm:mb-20">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white tracking-tight">
          What students say
        </h2>
        {references.length > 0 && (
          <span className="text-xs text-zinc-500 font-medium">{references.length} reference{references.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {references.length === 0 && isOwner && (
        <div className="rounded-2xl border border-dashed border-zinc-800 px-6 py-10 text-center">
          <p className="text-zinc-500 text-sm">No references yet.</p>
          <p className="text-zinc-600 text-xs mt-1">Add testimonials from previous students to build trust.</p>
          <a
            href="/me/edit/teacher-profile?tab=references"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-zinc-500 hover:text-white transition"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
            Add references
          </a>
        </div>
      )}

      {references.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {references.map((ref) => (
            <div
              key={ref.id}
              className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 flex flex-col gap-3"
            >
              {/* Stars */}
              {ref.rating && (
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span
                      key={i}
                      className={`material-symbols-outlined text-[14px] ${i < ref.rating! ? "text-[#0df2f2]" : "text-zinc-700"}`}
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      star
                    </span>
                  ))}
                </div>
              )}

              {/* Testimonial */}
              <p className="text-sm text-zinc-300 leading-relaxed">&ldquo;{ref.testimonial}&rdquo;</p>

              {/* Client info */}
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/[0.04]">
                <div>
                  <p className="text-xs font-semibold text-white">{ref.client_name}</p>
                  {ref.client_context && (
                    <p className="text-[11px] text-zinc-500 mt-0.5">{ref.client_context}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {ref.reference_year && (
                    <span className="text-[11px] text-zinc-600">{ref.reference_year}</span>
                  )}
                  <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5">Reference</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isOwner && references.length > 0 && (
        <div className="mt-4 text-center">
          <a
            href="/me/edit/teacher-profile?tab=references"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition underline underline-offset-2"
          >
            Manage references
          </a>
        </div>
      )}
    </section>
  );
}
