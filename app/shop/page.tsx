import Image from "next/image";
import InfoPageShell from "@/components/InfoPageShell";

export default function ShopPage() {
  return (
    <InfoPageShell
      title="ConXion Merch"
      description="ConXion shirt drop is coming soon."
    >
      <article className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))]">
        <div className="relative min-h-[280px] sm:min-h-[360px]">
          <Image
            src="/images/shop-shirts-v2.png"
            alt="ConXion shirt collection in black and white"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,10,14,0.35),rgba(6,10,14,0.85))]" />
          <div className="absolute inset-x-5 bottom-5 sm:inset-x-6 sm:bottom-6">
            <div className="inline-flex items-center rounded-full border border-[#00F5FF]/20 bg-black/45 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9ef7ff] backdrop-blur">
              Coming Soon
            </div>
            <h2 className="mt-3 max-w-[420px] text-3xl font-black tracking-tight text-white sm:text-4xl">
              ConXion shirts for the dance community
            </h2>
            <p className="mt-3 max-w-[520px] text-sm leading-6 text-white/75 sm:text-base">
              Merch isn&apos;t available yet — we&apos;re focused on the core app first. Check back soon.
            </p>
          </div>
        </div>
      </article>
    </InfoPageShell>
  );
}
