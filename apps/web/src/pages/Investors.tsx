// /investors — credibility + thesis + honest traction + a clear invite. English
// (investor audience is global). Bone + gray + yellow-detail, yellow CTA, logo dot.
// HONEST traction: live + verifiable on mainnet, pre-revenue, no external users yet.
// Do NOT inflate metrics here — investors verify first.

import { Link } from "react-router-dom";
import { V3Ribbon } from "../components/V3Ribbon.tsx";

const display = { fontFamily: "'DM Sans', sans-serif" } as const;
const GRAY = "#6f6862";
const CONTRACT = "CCT3KJXRUO3HJJ2GLTW2MISSQVUEKOPUG3B4YQH75TCGKAOC4P6FIKUF";
const TX = "ede13fb6230334af91b2af1cfab92f86f8f44e8a7755acb57d92891d68a3e957";
const xc = (p: string, id: string) => `https://stellar.expert/explorer/public/${p}/${id}`;
const CONTACT = "mailto:m.galmanus@gmail.com?subject=SlipPay%20%E2%80%94%20investor";

const mark = { color: "#0a0a0a", background: "#2563eb", padding: "0 0.06em" } as const;

function Stamp({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: GRAY }}>
      <span className="text-[#0a0a0a]/55">{n}</span><span className="h-px w-8 bg-current opacity-40" /><span>{label}</span>
    </div>
  );
}
const Bullets = ({ items }: { items: string[] }) => (
  <div className="mt-6 flex flex-col gap-3 max-w-[64ch]">
    {items.map((x) => <div key={x} className="flex items-baseline gap-3 text-lg md:text-xl text-[#0a0a0a]/75"><span className="text-[#2563eb] shrink-0">✓</span><span>{x}</span></div>)}
  </div>
);

export default function Investors() {
  return (
    <div className="min-h-screen relative bg-transparent text-[#0a0a0a] grain overflow-x-hidden">
      <V3Ribbon />
      <style>{`::selection{background:#2563eb;color:#0a0a0a}`}</style>
      <header className="px-6 md:px-12 py-7 flex items-center justify-between border-b border-[#0a0a0a]/10">
        <Link to="/" className="text-xl font-bold tracking-[-0.06em] lowercase" style={display}>slippay<span className="text-[#2563eb]">.</span></Link>
        <Link to="/" className="text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]">Home</Link>
      </header>

      <main className="max-w-[920px] mx-auto px-6 md:px-12 pt-14 md:pt-24 pb-28">
        <Stamp n="—" label="investors" />
        <h1 className="mt-10 font-bold uppercase tracking-[-0.05em] leading-[0.88] text-[clamp(2.25rem,6.5vw,4.75rem)]" style={display}>
          Building the global money layer on <span style={mark}>Pix</span> and <span style={mark}>USDC</span>.
        </h1>
        <p className="mt-10 text-xl md:text-2xl leading-relaxed max-w-[60ch] text-[#0a0a0a]/75">
          We connect Brazil's real-time payment system (Pix) to global stablecoin rails, enabling instant conversion between local currency and USDC.
        </p>
        <p className="mt-6 text-lg md:text-xl font-medium tracking-[-0.01em]" style={display}>
          BRL in → USDC out → programmable global payments.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-6">
          <a href={CONTACT} className="lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#0a0a0a] text-white">Get in touch</a>
          <Link to="/gate" className="text-[12px] uppercase tracking-[0.18em] border-b border-[#0a0a0a]/20 hover:border-[#0a0a0a] pb-1" style={{ color: GRAY }}>See the technical moat →</Link>
        </div>

        {/* WHY NOW */}
        <section className="mt-24 pt-12 border-t border-[#0a0a0a]/12">
          <Stamp n="001" label="why now" />
          <Bullets items={[
            "Stablecoins have reached real-world payment scale (USDC moved $18.3T in 2025).",
            "Pix is instant, ubiquitous and programmable at the edge ($6.7T/yr, ~25M Brazilians in crypto).",
            "Global users and businesses need dollar exposure without traditional banking friction.",
            "Blockchain settlement is now fast enough for consumer-grade, one-tap UX.",
          ]} />
        </section>

        {/* WHAT WE'RE BUILDING */}
        <section className="mt-24 pt-12 border-t border-[#0a0a0a]/12">
          <Stamp n="002" label="what we're building" />
          <p className="mt-6 text-lg text-[#0a0a0a]/60">A non-custodial money layer that enables:</p>
          <Bullets items={[
            "Instant BRL → USDC conversion.",
            "Programmable payments with user-defined rules.",
            "Global, wallet-native dollar balances.",
            "Automated recurring flows, executed only within your rules.",
            "API access for developers and businesses.",
          ]} />
        </section>

        {/* TRACTION — HONEST */}
        <section className="mt-24 pt-12 border-t border-[#0a0a0a]/12">
          <Stamp n="003" label="status · honest" />
          <h2 className="mt-8 text-2xl md:text-3xl font-semibold tracking-[-0.02em]" style={display}>Live and verifiable. Pre-revenue.</h2>
          <Bullets items={[
            "Live on Stellar mainnet — every claim below is a public, clickable transaction.",
            "Real on-chain USDC settlement proven (currently self-originated, not external user volume).",
            "Integrity gate + autonomous attested scheduler deployed and proven on mainnet.",
            "Non-custodial smart wallet with biometric authorization, live.",
          ]} />
          <p className="mt-6 text-[15px] leading-relaxed max-w-[58ch] text-[#0a0a0a]/55">
            We are pre-launch: no external paying users and no revenue yet. The machine works and is provable today; the next milestone is the first real users. We'd rather show you a real chain than a vanity chart.
          </p>
          <div className="mt-6 flex flex-col gap-3 max-w-[520px]">
            {[["A real payment", xc("tx", TX)], ["The live contract", xc("contract", CONTRACT)]].map(([label, href]) => (
              <a key={href} href={href} target="_blank" rel="noreferrer" className="group flex items-baseline justify-between gap-4 border-t border-[#0a0a0a]/12 py-4 hover:bg-[#0a0a0a]/[0.02] transition-colors">
                <span className="text-[16px] md:text-lg text-[#0a0a0a]/85">{label}</span>
                <span className="font-mono text-[11px] group-hover:underline shrink-0" style={{ color: GRAY }}>↗</span>
              </a>
            ))}
          </div>
        </section>

        {/* EDGE */}
        <section className="mt-24 pt-12 border-t border-[#0a0a0a]/12">
          <Stamp n="004" label="our edge" />
          <p className="mt-6 text-lg text-[#0a0a0a]/60">We sit at the intersection of:</p>
          <Bullets items={[
            "Real-time payment infrastructure (Pix).",
            "Stablecoin settlement (USDC).",
            "Programmable wallets (smart accounts / delegated execution).",
            "UX abstraction for non-crypto-native users.",
          ]} />
          <p className="mt-8 text-xl md:text-2xl font-medium tracking-[-0.02em] max-w-[36ch]" style={display}>
            The goal isn't "crypto payments". It's <span style={mark}>invisible global money movement</span>.
          </p>
        </section>

        {/* VISION */}
        <section className="mt-24 pt-12 border-t border-[#0a0a0a]/12">
          <Stamp n="005" label="vision" />
          <h2 className="mt-8 font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(2rem,6vw,4rem)] max-w-[22ch]" style={display}>
            Make moving money across borders as simple as sending a Pix.
          </h2>
          <p className="mt-8 text-xl leading-relaxed max-w-[52ch] text-[#0a0a0a]/65">
            No wires. No banking delays. No currency friction. Just programmable dollars that move instantly, anywhere.
          </p>
          <div className="mt-10">
            <a href={CONTACT} className="lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#0a0a0a] text-white">Talk to the founder</a>
          </div>
        </section>

        <div className="mt-20 font-mono text-[10px] uppercase tracking-[0.28em] text-[#0a0a0a]/30">slippay · global money, in one tap · live on mainnet</div>
      </main>
    </div>
  );
}
