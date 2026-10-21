// SlipPay landing — PT-BR, minimalista/editorial. Fundo bone, tipografia grande,
// muito ar, verde money (#A16207) como acento único (#FDDA24 sobre preto). Card +
// MandateDemo são as âncoras visuais. Funil: o que é → por que (controle) →
// prova → quanto custa → testar grátis. Comércio exterior NÃO aparece (deck).

import { Link } from "react-router-dom";
import { Logo } from "../components/Logo.tsx";
import { MandateDemo } from "../components/MandateDemo.tsx";
import { LivePaymentCard } from "../components/LivePaymentCard.tsx";
import { ConnectWallet } from "../components/ConnectWallet.tsx";
import { RuleSandbox } from "../components/RuleSandbox.tsx";
import { CountUp } from "../components/CountUp.tsx";
import { useEffect, useState } from "react";

const AUDIT_CONTRACT = "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN";
const AUDIT_URL = `https://stellar.expert/explorer/public/contract/${AUDIT_CONTRACT}`;
// The live recurring-payment rail on mainnet, and a real payment that already settled.
const LIVE_CONTRACT = "CD2RFNOLMIKZN4EETDCGULGMD4ANS56IIUDIBLOE24P4JRZM2GCVFV2U";
const LIVE_CONTRACT_URL = `https://stellar.expert/explorer/public/contract/${LIVE_CONTRACT}`;
const REAL_TX = "5da9741f554294a196376088ebd8f753f466a03cf657e67248533d78e0e3edf6";
const REAL_TX_URL = `https://stellar.expert/explorer/public/tx/${REAL_TX}`;

const TIERS = [
  { name: "Starter", price: "R$2,500", per: "/mo", who: "to start and test", featured: false },
  { name: "Growth", price: "R$7,500", per: "/mo", who: "when payments grow", featured: true },
  { name: "Business", price: "R$20,000", per: "/mo", who: "for the whole finance team", featured: false },
];

const FAQ = [
  ["Is it safe to let an agent pay my bills?",
    "Yes. The agent decides nothing. It only executes what you approved. Before every payment it checks the recipient, the amount, and the limit. If something falls outside the rule, it stops and flags you. And you can pause whenever you want."],
  ["Does SlipPay hold the money?",
    "Never. The money sits in a wallet that is only yours. Not even SlipPay can touch it. We handle the automation, not your money."],
  ["How does it pay without me approving every time?",
    "You set the rules once: how much it can spend, to whom, and how often. Within that, the agent executes on its own. Over the limit or outside the rule, it stops immediately."],
  ["Do I need to understand crypto or blockchain?",
    "No. You use it like any app. The blockchain is just where every payment is recorded, so you can check everything without taking our word for it."],
  ["What currency does the agent pay in?",
    "Today, in digital dollars (USDC): settles in seconds, no chargebacks. Direct local-currency payment is on the roadmap."],
  ["Does it really work, or is it a prototype?",
    "It works. Real payments have already happened and are recorded. You verify every transaction. Not a simulation, not a mockup."],
  ["Is there a free trial? How much does it cost?",
    "14 days free, no card. Then a plan tailored to the size of your operation, always less than the hours the agent gives you back."],
  ["Can I pause or cancel?",
    "Anytime, in one click. The control is always yours."],
];

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <div className={`font-mono text-[10px] uppercase tracking-[0.3em] ${dark ? "text-[#FDDA24]" : "text-[#0a0a0a]/40"} mb-6`}>{children}</div>;
}

export default function AgentHome() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const bar = document.getElementById("scrollbar");
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      if (bar) bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + "%";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    root.classList.add("js-reveal");
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) { e.target.classList.add("reveal-in"); io.unobserve(e.target); }
    }, { rootMargin: "-8% 0px -8% 0px", threshold: 0.06 });
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => { io.disconnect(); root.classList.remove("js-reveal"); };
  }, []);

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] overflow-x-hidden">
      <div className="scroll-progress" id="scrollbar" />
      <header className="relative px-6 md:px-12 py-7 flex items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-8 text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55">
          <Link to="/manifesto" className="navlink hover:text-[#0a0a0a] hidden sm:inline">Manifesto</Link>
          <Link to="/seguranca" className="navlink hover:text-[#0a0a0a] hidden sm:inline">Security</Link>
          <a href="#precos" className="navlink hover:text-[#0a0a0a] hidden sm:inline">Pricing</a>
          <a href="https://slippay.gitbook.io/slippay-docs" target="_blank" rel="noreferrer" className="navlink hover:text-[#0a0a0a] hidden sm:inline">Docs</a>
          <ConnectWallet className="hidden sm:inline-flex items-center rounded-full px-5 py-2.5 border border-[#0a0a0a]/25 hover:border-[#0a0a0a] text-[10px] uppercase tracking-[0.22em] disabled:opacity-50" />
          <Link to="/pay" className="hidden sm:inline-flex items-center rounded-full px-5 py-2.5 bg-[#FDDA24] text-[#0a0a0a] hover:opacity-90">Try it free</Link>
          {/* hamburger — mobile only */}
          <button onClick={() => setMenuOpen((v) => !v)} aria-label="Menu" className="sm:hidden flex flex-col gap-[5px] p-1">
            <span className={`block w-6 h-[2px] bg-[#0a0a0a] transition-transform ${menuOpen ? "translate-y-[7px] rotate-45" : ""}`} />
            <span className={`block w-6 h-[2px] bg-[#0a0a0a] transition-opacity ${menuOpen ? "opacity-0" : ""}`} />
            <span className={`block w-6 h-[2px] bg-[#0a0a0a] transition-transform ${menuOpen ? "-translate-y-[7px] -rotate-45" : ""}`} />
          </button>
        </nav>
        {/* mobile menu panel */}
        {menuOpen && (
          <div className="sm:hidden absolute top-full left-0 right-0 z-50 bg-[#f1eee7] border-y border-[#0a0a0a]/10 px-6 py-4 flex flex-col gap-1 text-[12px] uppercase tracking-[0.18em]">
            <Link to="/manifesto" onClick={() => setMenuOpen(false)} className="py-3 border-b border-[#0a0a0a]/8">Manifesto</Link>
            <Link to="/seguranca" onClick={() => setMenuOpen(false)} className="py-3 border-b border-[#0a0a0a]/8">Security</Link>
            <a href="#precos" onClick={() => setMenuOpen(false)} className="py-3 border-b border-[#0a0a0a]/8">Pricing</a>
            <a href="https://slippay.gitbook.io/slippay-docs" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)} className="py-3 border-b border-[#0a0a0a]/8">Docs</a>
            <ConnectWallet className="mt-3 inline-flex items-center justify-center rounded-full px-5 py-3 border border-[#0a0a0a]/25 text-[12px] uppercase tracking-[0.18em]" />
            <Link to="/pay" onClick={() => setMenuOpen(false)} className="mt-2 inline-flex items-center justify-center rounded-full px-5 py-3 bg-[#FDDA24] text-[#0a0a0a]">Try it free</Link>
          </div>
        )}
      </header>

      {/* HERO */}
      <section className="relative">
        <div className="max-w-[1240px] mx-auto px-6 md:px-12 pt-8 md:pt-24 pb-20 md:pb-36">
          <div className="hero-in flex flex-col items-center text-center">
            <Eyebrow>real dollars, on autopilot</Eyebrow>
            <h1 className="text-[44px] leading-[0.95] md:text-[80px] md:leading-[0.92] font-semibold tracking-[-0.045em] max-w-[15ch] mx-auto">
              <span className="mask-clip"><span className="mask-up">Your money, on autopilot.</span></span>
            </h1>
            <p className="mt-9 text-xl text-[#0a0a0a]/70 leading-relaxed max-w-[46ch] mx-auto">
              Keep your money in dollars and let it pay your bills by itself, the moment
              they're due. No card machine, no chargebacks.
              <span className="text-[#0a0a0a] font-medium"> The money stays yours, and it only does what you allow.</span>
            </p>
            <div className="mt-11 flex flex-wrap items-center justify-center gap-7">
              <Link to="/pay" className="lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.2em] bg-[#FDDA24] text-[#0a0a0a]">Try it free</Link>
              <a href="#precos" className="text-[12px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 hover:text-[#0a0a0a] border-b border-[#0a0a0a]/20 pb-1">How much?</a>
            </div>
            <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-[#0a0a0a]/40">free to try · no card</p>
            <p className="mt-7 text-[15px] text-[#0a0a0a]/50 leading-relaxed max-w-[44ch] mx-auto">
              For anyone who pays or gets paid in dollars — from a freelancer to a company.
            </p>
            <div className="mt-14 w-full max-w-[420px] mx-auto">
              <LivePaymentCard />
            </div>
          </div>
        </div>
      </section>

      {/* TRUST STRIP — credibilidade honesta (parceiros de tech, não depoimento falso) */}
      <section className="border-t border-[#0a0a0a]/10">
        <div className="max-w-[1240px] mx-auto px-6 md:px-12 py-7 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">
          <span>built on</span>
          <span className="text-[#0a0a0a]/75">Stellar</span>
          <span className="opacity-30">·</span>
          <span className="text-[#0a0a0a]/75">Circle · USDC</span>
          <span className="opacity-30">·</span>
          <span>every payment public &amp; checkable</span>
        </div>
      </section>

      {/* LIVE ON MAINNET — honest, verifiable reinforcement */}
      <section className="border-t border-[#0a0a0a]/10 bg-[#0a0a0a] text-[#f1eee7]">
        <div data-reveal className="max-w-[1240px] mx-auto px-6 md:px-12 py-20 md:py-28 text-center">
          <Eyebrow dark>live on the main network today</Eyebrow>
          <h2 className="text-4xl md:text-6xl font-semibold tracking-[-0.045em] leading-[0.95] max-w-[16ch] mx-auto">
            This isn't a demo. <span className="text-[#FDDA24]">It's running.</span>
          </h2>
          <p className="mt-8 text-xl text-[#f1eee7]/65 leading-relaxed max-w-[46ch] mx-auto">
            Real money already moves through SlipPay on the live network. You don't have to
            trust us — open any payment and check it yourself.
          </p>
          <div className="mt-12 grid sm:grid-cols-3 gap-8 max-w-[860px] mx-auto text-left">
            {[
              ["Pays by itself", "Recurring payments charge themselves, on schedule. Live on the main network."],
              ["Pay with your face", "Create an account and pay with Face ID. No app, no password, no seed phrase."],
              ["Public & checkable", "Every payment is recorded in the open. Anyone can verify it, anytime."],
            ].map(([h, b]) => (
              <div key={h}>
                <div className="text-lg font-semibold tracking-[-0.01em] text-[#FDDA24]">{h}</div>
                <p className="mt-2 text-[15px] text-[#f1eee7]/60 leading-relaxed">{b}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
            <a href={REAL_TX_URL} target="_blank" rel="noreferrer" className="lift inline-flex items-center gap-2.5 rounded-full px-7 py-3.5 text-[11px] uppercase tracking-[0.18em] bg-[#FDDA24] text-[#0a0a0a]">See a real payment ↗</a>
            <a href={LIVE_CONTRACT_URL} target="_blank" rel="noreferrer" className="text-[12px] uppercase tracking-[0.18em] text-[#f1eee7]/60 hover:text-[#f1eee7] border-b border-[#f1eee7]/25 pb-1">The live contract ↗</a>
          </div>
        </div>
      </section>

      {/* O QUE SE REPETE — uma linha */}
      <section className="border-t border-[#0a0a0a]/10">
        <div data-reveal className="max-w-[1240px] mx-auto px-6 md:px-12 py-20 md:py-28 text-center">
          <Eyebrow>what the agent handles</Eyebrow>
          <p className="text-3xl md:text-5xl font-semibold tracking-[-0.03em] leading-[1.08] max-w-[24ch] mx-auto">
            The agent handles the payments that follow predictable rules.
          </p>
          <p className="mt-7 text-xl text-[#0a0a0a]/55 leading-relaxed max-w-[46ch] mx-auto">Subscriptions, APIs, suppliers, contractors, and other recurring charges.</p>
        </div>
      </section>

      {/* MAIS BARATO QUE A STRIPE */}
      <section className="border-t border-[#0a0a0a]/10">
        <div data-reveal className="max-w-[1240px] mx-auto px-6 md:px-12 py-24 md:py-32 text-center">
          <Eyebrow>cheaper and safer than stripe</Eyebrow>
          <h2 className="text-4xl md:text-6xl font-semibold tracking-[-0.04em] leading-[0.95] max-w-[14ch] mx-auto">Save ~3% on every transaction.</h2>
          <p className="mt-8 text-xl text-[#0a0a0a]/60 leading-relaxed max-w-[52ch] mx-auto">
            Cards and Stripe take close to 3% of every sale. In Brazil, even more. On Stellar, moving
            money costs fractions of a cent. SlipPay passes that saving on to you:
            <span className="text-[#0a0a0a] font-medium"> the same sale, at a fraction of the fee, with no chargebacks.</span>
          </p>
          <div className="mt-12 grid sm:grid-cols-2 gap-px bg-[#0a0a0a]/12 border border-[#0a0a0a]/12 max-w-[680px] mx-auto text-left">
            <div className="bg-white p-7 md:p-8">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45">card / stripe</div>
              <div className="mt-4 text-4xl font-semibold tabular-nums tracking-[-0.03em]"><CountUp to={2.9} format={(n) => `~${n.toFixed(1)}%+`} /></div>
              <div className="mt-2 text-[14px] text-[#0a0a0a]/55 leading-snug">per transaction, and still subject to chargebacks</div>
            </div>
            <div className="bg-[#0a0a0a] text-[#f1eee7] p-7 md:p-8">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#FDDA24]">slippay · on stellar</div>
              <div className="mt-4 text-4xl font-semibold tracking-[-0.03em]">a fraction</div>
              <div className="mt-2 text-[14px] text-[#f1eee7]/60 leading-snug">near-zero network fee · final in seconds · no chargebacks</div>
            </div>
          </div>
          <p className="mt-12 text-xl text-[#0a0a0a]/60 leading-relaxed max-w-[52ch] mx-auto">
            And safer. Stripe is centralized: it holds your money and can freeze your account at
            any time. <span className="text-[#0a0a0a] font-medium">SlipPay is non-custodial: the money never leaves your wallet, and no one can lock it.</span>
          </p>
        </div>
      </section>

      {/* COMO USAR HOJE — pro CNPJ com conta no banco */}
      <section className="border-t border-[#0a0a0a]/10 bg-[#0a0a0a] text-[#f1eee7]">
        <div data-reveal className="max-w-[1240px] mx-auto px-6 md:px-12 py-24 md:py-32 text-center">
          <Eyebrow dark>already have a bank account?</Eyebrow>
          <h2 className="text-4xl md:text-6xl font-semibold tracking-[-0.045em] leading-[0.95] max-w-[15ch] mx-auto">See how to start with what you already have.</h2>
          <div className="mt-16 grid md:grid-cols-3 gap-12 md:gap-10">
            {[
              ["01", "Create your account", "With your face, in a minute. No password, no phrase to memorize, no card. Free."],
              ["02", "Your money becomes dollars", "From your bank account you buy digital dollars at a trusted exchange and send them to your wallet. We guide you step by step; it takes a few minutes."],
              ["03", "The agent takes over", "You set how much it can spend and to whom. Then the agent pays your bills in dollars, on its own, always within your rules."],
            ].map(([n, h, b]) => (
              <div key={n}>
                <div className="font-mono text-[12px] text-[#FDDA24] mb-4">{n}</div>
                <div className="text-2xl font-semibold tracking-[-0.02em]">{h}</div>
                <p className="mt-3 text-[15px] text-[#f1eee7]/60 leading-relaxed max-w-[34ch] mx-auto">{b}</p>
              </div>
            ))}
          </div>
          <p className="mt-14 text-lg text-[#f1eee7]/55 leading-relaxed max-w-[54ch] mx-auto">
            Direct local-to-dollar, with no exchange in between, is coming. And if you want, we'll
            set up your first dollars with you, hands-on. <a href="/signup" className="text-[#FDDA24] hover:underline underline-offset-4">Talk to us.</a>
          </p>
        </div>
      </section>

      {/* MULTI-CHAIN — aceita USDC de qualquer chain via CCTP */}
      <section className="border-t border-[#0a0a0a]/10">
        <div data-reveal className="max-w-[1240px] mx-auto px-6 md:px-12 py-20 md:py-28 text-center">
          <Eyebrow>bring your dollars from anywhere</Eyebrow>
          <h2 className="text-3xl md:text-5xl font-semibold tracking-[-0.03em] leading-[1.02] max-w-[18ch] mx-auto">Already have digital dollars somewhere else?</h2>
          <p className="mt-7 text-xl text-[#0a0a0a]/60 leading-relaxed max-w-[50ch] mx-auto">
            If your dollars are on another network, bring them in. They arrive in your wallet
            as <span className="text-[#0a0a0a] font-medium">real dollars, straight from Circle</span> — the company behind USDC.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-x-7 gap-y-3 font-mono text-[12px] uppercase tracking-[0.16em] text-[#0a0a0a]/55">
            {["Ethereum", "Base", "Solana", "Arbitrum", "Optimism", "Polygon", "Avalanche", "Unichain", "Linea", "+ mais"].map((c) => (
              <span key={c} className="flex items-center gap-2"><span className="text-[#0a0a0a]">◆</span>{c === "+ mais" ? "+ more" : c}</span>
            ))}
          </div>
        </div>
      </section>

      {/* CONTROLE — a frase que mata a objeção */}
      <section className="border-t border-[#0a0a0a]/10 bg-[#0a0a0a] text-[#f1eee7]">
        <div data-reveal className="max-w-[1240px] mx-auto px-6 md:px-12 py-28 md:py-40 text-center">
          <Eyebrow dark>full control</Eyebrow>
          <h2 className="text-5xl md:text-7xl font-semibold tracking-[-0.045em] leading-[0.95] max-w-[12ch] mx-auto">
            The agent doesn't decide. <span className="text-[#FDDA24]">It executes.</span>
          </h2>
          <p className="mt-9 text-xl text-[#f1eee7]/65 leading-relaxed max-w-[48ch] mx-auto">
            <span className="text-[#f1eee7] font-medium">Your money never leaves your control.</span> You
            set the rules, and before every payment the agent checks who gets paid, how much it can
            spend, whether it's within policy, and whether the limit still holds.
          </p>
          <div className="mt-12 flex flex-wrap justify-center gap-x-10 gap-y-4 font-mono text-[12px] uppercase tracking-[0.18em] text-[#f1eee7]/55">
            {["who gets paid", "how much", "policy", "limit"].map((c) => (
              <span key={c} className="flex items-center gap-2.5"><span className="text-[#FDDA24]">✓</span>{c}</span>
            ))}
          </div>
          <p className="mt-14 text-2xl md:text-3xl font-medium tracking-[-0.02em] text-[#f1eee7]/90 max-w-[26ch] mx-auto">
            The agent can make a mistake. The rule that protects your money can't. Outside it, it stops and flags you.
          </p>
          <div className="mt-12 max-w-[560px] mx-auto text-left">
            <RuleSandbox />
          </div>
        </div>
      </section>

      {/* EXEMPLO — concreto, R$ */}
      <section className="border-t border-[#0a0a0a]/10">
        <div data-reveal className="max-w-[1240px] mx-auto px-6 md:px-12 py-24 md:py-32 flex flex-col items-center text-center">
          <div>
            <Eyebrow>an example</Eyebrow>
            <h2 className="text-4xl md:text-6xl font-semibold tracking-[-0.04em] leading-[0.95] max-w-[16ch] mx-auto">R$40k a month, on autopilot.</h2>
            <p className="mt-8 text-xl text-[#0a0a0a]/65 leading-relaxed max-w-[46ch] mx-auto">
              The agent runs the recurring payments within the approved rules, and only asks for help
              when something falls outside the norm.
            </p>
          </div>
          <div className="mt-14 w-full max-w-[420px] mx-auto text-left">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/40 pb-6">one company · every month</div>
            {[
              ["APIs", "R$20,000"],
              ["Suppliers", "R$13,000"],
              ["Subscriptions", "R$7,000"],
            ].map(([l, v]) => (
              <div key={l} className="flex items-baseline justify-between py-4 border-t border-[#0a0a0a]/10">
                <span className="text-lg text-[#0a0a0a]/70">{l}</span>
                <span className="text-xl font-semibold tabular-nums">{v}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between pt-6 mt-2 border-t-2 border-[#0a0a0a]">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]">paid by the agent</span>
              <span className="text-3xl font-semibold tabular-nums"><CountUp to={40} format={(n) => `R$${Math.round(n)}k`} /></span>
            </div>
          </div>
        </div>
      </section>

      {/* PROVA */}
      <section className="border-t border-[#0a0a0a]/10">
        <div data-reveal className="max-w-[1240px] mx-auto px-6 md:px-12 py-24 md:py-32 flex flex-col items-center text-center">
          <div>
            <Eyebrow>it's already working</Eyebrow>
            <h2 className="text-4xl md:text-6xl font-semibold tracking-[-0.04em] leading-[0.95] max-w-[14ch] mx-auto">Not a promise.</h2>
            <p className="mt-8 text-xl text-[#0a0a0a]/65 leading-relaxed max-w-[46ch] mx-auto">
              Real money is already moving with SlipPay. You don't have to take our word:
              track the payments, check the limits, and verify every transaction yourself. Not a
              simulation. Not a prototype.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-7">
              <a href={AUDIT_URL} target="_blank" rel="noreferrer" className="lift inline-flex items-center gap-2.5 rounded-full px-7 py-3.5 text-[11px] uppercase tracking-[0.18em] bg-[#FDDA24] text-[#0a0a0a]">Verify on-chain<span className="w-1.5 h-1.5 rounded-full bg-[#FDDA24]" /></a>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/35">powered by Stellar + USDC</span>
            </div>
          </div>
          <div className="mt-14 w-full max-w-[440px] mx-auto text-left">
            <MandateDemo />
          </div>
        </div>
      </section>

      {/* VISÃO — a alma do manifesto, dark */}
      <section className="border-t border-[#0a0a0a]/10 bg-[#0a0a0a] text-[#f1eee7]">
        <div data-reveal className="max-w-[1240px] mx-auto px-6 md:px-12 py-24 md:py-40 text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#FDDA24] mb-6">our vision</div>
          <h2 className="text-4xl md:text-7xl font-semibold tracking-[-0.045em] leading-[0.96] max-w-[18ch] mx-auto">
            Real dollars, <span className="text-[#FDDA24]">as simple as an app.</span>
          </h2>
          <p className="mt-12 text-xl md:text-2xl text-[#f1eee7]/70 leading-relaxed max-w-[54ch] mx-auto">
            Dollars that work on their own and stay yours. No becoming an engineer, no memorizing
            jargon. The AI does the heavy lifting, and the rule that protects your money never depends on it.
          </p>
          <p className="mt-8 text-2xl md:text-3xl font-medium tracking-[-0.02em] max-w-[24ch] mx-auto">
            The most advanced technology, simple to use.
          </p>
          <a href="/manifesto" className="mt-10 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-[#FDDA24] border-b border-[#FDDA24]/40 hover:border-[#FDDA24] pb-1">Read the manifesto</a>
        </div>
      </section>

      {/* PREÇOS — comece grátis */}
      <section id="precos" className="border-t border-[#0a0a0a]/10">
        <div className="max-w-[1240px] mx-auto px-6 md:px-12 py-24 md:py-32 text-center">
          <Eyebrow>pricing</Eyebrow>
          <h2 className="text-4xl md:text-6xl font-semibold tracking-[-0.04em] leading-[0.95] max-w-[16ch] mx-auto">Start free. Pay when it's worth it.</h2>
          <p className="mt-8 text-xl text-[#0a0a0a]/60 leading-relaxed max-w-[52ch] mx-auto">14 days free, no card. Then a plan tailored to the size of your operation. We settle the price once the agent is already saving you work.</p>

          <div className="mt-16 grid md:grid-cols-3 gap-8 text-left">
            {TIERS.map((t) => (
              <div key={t.name} className={`py-8 ${t.featured ? "border-t-2 border-[#A16207]" : "border-t border-[#0a0a0a]/15"}`}>
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-semibold tracking-[-0.01em]">{t.name}</span>
                  {t.featured && <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#0a0a0a]">most chosen</span>}
                </div>
                <div className="mt-3 text-[15px] text-[#0a0a0a]/55">{t.who}</div>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
            <Link to="/pay" className="lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.2em] bg-[#FDDA24] text-[#0a0a0a]">Try it free</Link>
            <a href="/signup" className="text-[12px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 hover:text-[#0a0a0a] border-b border-[#0a0a0a]/20 pb-1">Talk to us</a>
          </div>
          <p className="mt-10 text-[14px] text-[#0a0a0a]/45 max-w-[60ch] leading-relaxed mx-auto">
            The money is always yours, never held by us, and every payment can be checked.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-[#0a0a0a]/10">
        <div data-reveal className="max-w-[1240px] mx-auto px-6 md:px-12 py-24 md:py-32 text-center">
          <Eyebrow>frequently asked questions</Eyebrow>
          <h2 className="text-4xl md:text-6xl font-semibold tracking-[-0.04em] leading-[0.95] max-w-[14ch] mx-auto">Still have questions?</h2>
          <div className="mt-14 max-w-[820px] mx-auto text-left">
            {FAQ.map(([q, a], i) => {
              const open = openFaq === i;
              return (
                <div key={q} className="border-t border-[#0a0a0a]/12 last:border-b">
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="w-full flex items-center justify-between gap-6 py-6 text-left group"
                    aria-expanded={open}
                  >
                    <span className="text-lg md:text-2xl font-semibold tracking-[-0.02em] group-hover:text-[#0a0a0a] transition-colors">{q}</span>
                    <span className={`shrink-0 text-2xl leading-none text-[#0a0a0a] transition-transform duration-300 ${open ? "rotate-45" : ""}`}>+</span>
                  </button>
                  <div className="grid transition-all duration-300 ease-out" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
                    <div className="overflow-hidden">
                      <p className="pb-7 text-lg text-[#0a0a0a]/65 leading-relaxed max-w-[60ch]">{a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="border-t border-[#0a0a0a]/10 bg-[#0a0a0a] text-[#f1eee7]">
        <div className="max-w-[1240px] mx-auto px-6 md:px-12 py-32 md:py-44 text-center">
          <h2 className="text-5xl md:text-7xl font-semibold tracking-[-0.045em] leading-[0.95] max-w-[18ch] mx-auto">Set the rules once.</h2>
          <p className="mt-8 text-xl text-[#f1eee7]/60 leading-relaxed max-w-[44ch] mx-auto">Stop approving the same payments forever. Try it free, no card. The simple way to let your money work on its own.</p>
          <div className="mt-12 flex justify-center">
            <Link to="/pay" className="lift inline-flex items-center rounded-full px-10 py-4 text-[11px] uppercase tracking-[0.2em] bg-[#FDDA24] text-[#0a0a0a]">Try it free</Link>
          </div>
          <div className="mt-16 flex flex-wrap justify-center gap-7 text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/45">
            <a href="https://slippay.gitbook.io/slippay-docs" target="_blank" rel="noreferrer" className="hover:text-[#FDDA24]">Docs ↗</a>
            <a href={AUDIT_URL} target="_blank" rel="noreferrer" className="hover:text-[#FDDA24]">On-chain ↗</a>
            <a href="#precos" className="hover:text-[#FDDA24]">Pricing</a>
          </div>
          <div className="mt-8 font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/30">slippay · the safe way to let software move money</div>
        </div>
      </section>
    </div>
  );
}
