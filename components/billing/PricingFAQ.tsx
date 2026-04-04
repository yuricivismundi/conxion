"use client";

import { useState } from "react";
import type { PricingFaqItem } from "@/lib/billing/faq";
import { cx } from "@/lib/cx";

type Props = {
  items: PricingFaqItem[];
};


export default function PricingFAQ({ items }: Props) {
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null);

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const isOpen = openId === item.id;
        return (
          <article key={item.id} className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03]">
            <button
              type="button"
              onClick={() => setOpenId((current) => (current === item.id ? null : item.id))}
              className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left sm:px-5"
              aria-expanded={isOpen}
            >
              <span className="text-base font-semibold text-white">{item.question}</span>
              <span
                className={cx(
                  "material-symbols-outlined text-[20px] text-cyan-300 transition-transform",
                  isOpen ? "rotate-45" : ""
                )}
              >
                add
              </span>
            </button>
            {isOpen ? (
              <div className="border-t border-white/8 px-4 py-4 text-sm leading-6 text-slate-300 sm:px-5">{item.answer}</div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
