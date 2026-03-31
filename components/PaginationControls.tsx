"use client";

type PaginationControlsProps = {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
  className?: string;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function PaginationControls({
  page,
  totalPages,
  totalItems,
  pageSize,
  itemLabel,
  onPageChange,
  className,
}: PaginationControlsProps) {
  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div className={cx("mt-6 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <p className="text-sm text-white/55">
        Showing <span className="font-semibold text-white">{start}</span>-<span className="font-semibold text-white">{end}</span> of{" "}
        <span className="font-semibold text-white">{totalItems}</span> {itemLabel}
      </p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/10 bg-black/30 px-3 text-white/70 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Previous page"
        >
          <span className="material-symbols-outlined text-[20px]">chevron_left</span>
        </button>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white/70">
          Page {page} / {totalPages}
        </div>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/10 bg-black/30 px-3 text-white/70 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="Next page"
        >
          <span className="material-symbols-outlined text-[20px]">chevron_right</span>
        </button>
      </div>
    </div>
  );
}
