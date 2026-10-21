// x402 ecosystem carousel — the PUBLIC x402 Foundation membership, shown as
// authority for the x402 standard Slippay builds on (NOT as Slippay's backers;
// the source disclaimer states that plainly in the parent section).
//
// Logos: dropped into /public/x402-logos/<slug>.png are shown if present; if a
// file is absent the card falls back to a typographic wordmark. No external CDN
// at runtime (a CDN outage must never blank the landing) — host logos locally.
//
// Descriptions + URLs are public, from x402.org/ecosystem (Premier members).

type Member = { slug: string; name: string; url: string; desc: string };

const MEMBERS: Member[] = [
  { slug: "visa", name: "Visa", url: "https://visa.com",
    desc: "Joined the x402 Foundation as a Premier member, putting the world's largest card network behind the standard." },
  { slug: "mastercard", name: "Mastercard", url: "https://mastercard.com",
    desc: "Premier member — card-network and payment infrastructure added to the standard." },
  { slug: "amex", name: "American Express", url: "https://americanexpress.com",
    desc: "Joined as a Premier member, bringing a global card brand to the standard." },
  { slug: "stripe", name: "Stripe", url: "https://stripe.com",
    desc: "Integrated x402 to enable native USDC stablecoin payments for internet commerce via the HTTP 402 standard." },
  { slug: "coinbase", name: "Coinbase", url: "https://coinbase.com",
    desc: "Best-in-class x402 facilitator. Fee-free USDC settlement on Base Mainnet. KYT/OFAC checks on every transaction." },
  { slug: "cloudflare", name: "Cloudflare", url: "https://cloudflare.com",
    desc: "Co-founded the x402 Foundation with Coinbase; native x402 support in Workers and AI Agents — serverless HTTP payments at the edge." },
  { slug: "google", name: "Google", url: "https://google.com",
    desc: "Premier member, aligning cloud and internet infrastructure with the standard." },
  { slug: "aws", name: "Amazon · AWS", url: "https://aws.amazon.com",
    desc: "AWS supports x402 for machine-to-machine cloud payments, letting AI agents and services transact via HTTP 402." },
  { slug: "circle", name: "Circle", url: "https://circle.com",
    desc: "Issues USDC and built the Circle Agent Stack on x402 — gas-free, sub-cent USDC payments for autonomous agents." },
  { slug: "shopify", name: "Shopify", url: "https://shopify.com",
    desc: "Premier member, connecting the standard to commerce and merchant infrastructure." },
  { slug: "fiserv", name: "Fiserv", url: "https://fiserv.com",
    desc: "Premier member — making agent-driven commerce adoptable by existing merchants without major re-engineering." },
  { slug: "adyen", name: "Adyen", url: "https://adyen.com",
    desc: "Joined to shape open, interoperable payment standards for agentic commerce, focused on merchant outcomes." },
];

// Local logo filename per member (pulled from x402.org/logos, hosted in
// /public/x402-logos). Mixed svg/png as the originals are.
const LOGO: Record<string, string> = {
  visa: "visa.png", mastercard: "mastercard.svg", amex: "amex.png", stripe: "stripe.svg",
  coinbase: "coinbase.png", cloudflare: "cloudflare.png", google: "google.png", aws: "aws.svg",
  circle: "circle.svg", shopify: "shopify.svg", fiserv: "fiserv.svg", adyen: "adyen.svg",
};

function Card({ m }: { m: Member }) {
  return (
    <a
      href={m.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group shrink-0 w-[300px] md:w-[360px] bg-[#f1eee7] border border-[#0a0a0a]/15 hover:border-[#0a0a0a]/40 transition-colors p-7 md:p-8 flex flex-col"
    >
      {/* logo if present (local), else hidden — the wordmark below always shows */}
      <img
        src={`/x402-logos/${LOGO[m.slug] ?? m.slug + ".png"}`}
        alt={`${m.name} logo`}
        className="h-9 w-auto self-start mb-5 object-contain"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
      <div className="text-base font-semibold tracking-tight text-[#0a0a0a]">{m.name}</div>
      <p className="mt-3 text-[13px] leading-[1.5] text-[#0a0a0a]/65 flex-1">{m.desc}</p>
      <span className="mt-5 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-[#0a0a0a]/70 group-hover:text-[#0a0a0a]">
        <span className="border-b-2 border-[#FDDA24] pb-0.5">Visit website</span>
        <span className="group-hover:translate-x-0.5 transition-transform">→</span>
      </span>
    </a>
  );
}

export function X402Carousel() {
  // Continuous marquee: the track holds two copies of the member list and slides
  // -50% on a linear loop, so cards move by themselves, seamlessly. Hover pauses
  // (so a card can be read and its link clicked); reduced-motion stops it. The
  // edges fade so cards enter/leave softly. See index.css .marquee-track.
  const reel = [...MEMBERS, ...MEMBERS];
  return (
    <div
      className="marquee-wrap relative overflow-hidden"
      style={{
        maskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)",
      }}
    >
      <div className="marquee-track flex gap-4 w-max py-1">
        {reel.map((m, i) => <Card key={`${m.slug}-${i}`} m={m} />)}
      </div>
    </div>
  );
}
