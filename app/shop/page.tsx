import Image from "next/image";
import InfoPageShell from "@/components/InfoPageShell";

const PRODUCT_OPTIONS = [
  {
    name: "ConXion Oversize T-Shirt",
    color: "Black",
    fit: "Oversized fit",
    note: "Soft streetwear shape for socials, festivals, and travel days.",
  },
  {
    name: "ConXion T-Shirt",
    color: "White",
    fit: "Classic fit",
    note: "Clean everyday tee with the front mark and full back logo.",
  },
];

const ORDER_DETAILS = [
  "Size: S / M / L / XL",
  "Color: Black or White",
  "City for shipping",
];

const MERCH_PERKS = [
  "Represent the community",
  "Made for dancers and travelers",
  "Easy first-drop ordering",
];

export default function ShopPage() {
  const orderMailto =
    "mailto:contact@conxion.social?subject=ConXion%20T-Shirt%20Order&body=Hi%20ConXion%20Team%2C%0A%0AI%20want%20to%20order%20a%20shirt.%0A%0ASize%3A%20%0AColor%3A%20%0ACity%20for%20shipping%3A%20%0A%0AThanks.";

  return (
    <InfoPageShell
      title="ConXion Merch"
      description="ConXion shirt drop. Pick your fit, send the order details by email, and we will confirm the rest manually."
    >
      <article className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))]">
        <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="relative min-h-[340px] border-b border-white/10 lg:min-h-[560px] lg:border-b-0 lg:border-r">
            <Image
              src="/images/shop-shirts-v2.png"
              alt="ConXion shirt collection in black and white"
              fill
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,10,14,0.1),rgba(6,10,14,0.76))]" />
            <div className="absolute inset-x-5 bottom-5 sm:inset-x-6 sm:bottom-6">
              <div className="inline-flex items-center rounded-full border border-[#00F5FF]/20 bg-black/45 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9ef7ff] backdrop-blur">
                First Drop
              </div>
              <h2 className="mt-3 max-w-[420px] text-3xl font-black tracking-tight text-white sm:text-4xl">
                ConXion shirts for the dance community
              </h2>
              <p className="mt-3 max-w-[520px] text-sm leading-6 text-white/75 sm:text-base">
                Black oversize and white classic tees made for socials, festivals, and travel days.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5 p-5 sm:p-6">
            <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#00F5FF]">Available Now</div>
              <div className="mt-4 space-y-4">
                {PRODUCT_OPTIONS.map((product) => (
                  <div key={`${product.name}-${product.color}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-white">{product.name}</h3>
                        <p className="mt-1 text-sm font-semibold text-fuchsia-300">{product.color}</p>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/65">
                        {product.fit}
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-white/70">{product.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#00F5FF]">Why to wear one</div>
                <ul className="mt-4 space-y-3">
                  {MERCH_PERKS.map((perk) => (
                    <li key={perk} className="flex items-start gap-3 text-sm leading-6 text-white/75">
                      <span className="material-symbols-outlined text-[18px] text-fuchsia-300">check_circle</span>
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-[28px] border border-[#00F5FF]/15 bg-[linear-gradient(180deg,rgba(0,245,255,0.08),rgba(255,0,255,0.06))] p-5">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#00F5FF]">Want One?</div>
                <p className="mt-3 text-sm leading-6 text-white/80">
                  Send us one email with the basic order details and we will confirm the next steps manually.
                </p>
                <ul className="mt-4 space-y-2 text-sm text-white/78">
                  {ORDER_DETAILS.map((detail) => (
                    <li key={detail} className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-fuchsia-300">fiber_manual_record</span>
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={orderMailto}
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-300 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-[#06121a] hover:brightness-110"
                >
                  Email Us
                </a>
                <p className="mt-3 text-sm text-white/65">
                  contact@conxion.social
                </p>
              </div>
            </div>
          </div>
        </div>
      </article>
    </InfoPageShell>
  );
}
