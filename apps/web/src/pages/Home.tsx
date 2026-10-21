import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo.tsx";
import { Reveal } from "../components/Reveal.tsx";
import { PayFlowDemo } from "../components/PayFlowDemo.tsx";
import { useLang, type Lang } from "../lib/lang.ts";
import { homeCopy } from "../copy/home.tsx";

function useScrolled(threshold = 80) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

// Magnetic CTA · button follows cursor with a 6px max offset while hovered.
// Cheap premium-fintech tell · no library needed.
function MagneticCTA({ to, children }: { to: string; children: React.ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null);
  function onMove(e: React.MouseEvent<HTMLAnchorElement>) {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const mx = e.clientX - r.left - r.width / 2;
    const my = e.clientY - r.top - r.height / 2;
    el.style.transform = `translate(${(mx / r.width) * 8}px, ${(my / r.height) * 8}px)`;
  }
  function onLeave() {
    const el = ref.current; if (!el) return;
    el.style.transform = "translate(0,0)";
  }
  return (
    <Link to={to} ref={ref as any}
      onMouseMove={onMove} onMouseLeave={onLeave}
      style={{ transition: "transform 200ms cubic-bezier(0.22,1,0.36,1)" }}
      className="inline-flex items-center gap-3 bg-[#0a0a0a] text-[#f1eee7] px-8 py-4 text-[11px] uppercase tracking-[0.22em] hover:bg-[#1a1a1a]">
      {children}
    </Link>
  );
}

// PT|EN toggle. Inherits text color from the nav (light over hero, ink when
// scrolled), so it reads on both backgrounds.
function LangToggle({ lang, setLang, className = "" }: { lang: Lang; setLang: (l: Lang) => void; className?: string }) {
  return (
    <div className={"flex items-center gap-1.5 tabular-nums " + className}>
      <button onClick={() => setLang("pt")} className={lang === "pt" ? "font-semibold" : "opacity-50 hover:opacity-100 transition-opacity"}>PT</button>
      <span className="opacity-30">/</span>
      <button onClick={() => setLang("en")} className={lang === "en" ? "font-semibold" : "opacity-50 hover:opacity-100 transition-opacity"}>EN</button>
    </div>
  );
}

// One proof fact — number + one line. Used in the condensed proof grid.
// Centered, monumental-adjacent: the feeling leads, the mechanics stay brief.
// Tween a number toward `target` (ease-out cubic) — `from` is always the
// currently-displayed value, so rapid slider drags chase smoothly without jumps.
function useTween(target: number, ms = 420): number {
  const [v, setV] = useState(target);
  const vRef = useRef(target);
  vRef.current = v;
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(target); return; }
    const from = vRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

// Loss calculator — turns the abstract "5–12%" into a felt, accumulating number.
// STATUS-QUO LOSS ONLY: shows what the earner loses TODAY on the way in. It
// deliberately does NOT compute a "Slippay saves you $X" figure, because the
// full receive→hold→Pix loop is early-access (see honest status section). The
// ~1–2% target is stated as context in the footnote, never as a delivered saving.
function LossCalculator({ t }: { t: { label: string; title: string; lossLabel: string; youReceive: string; perMonth: string; perYear: string; over3y: string; foot: string } }) {
  const presets = [1000, 3000, 5000, 10000];
  const [amount, setAmount] = useState(3000);
  const LOW = 0.05, HIGH = 0.12;
  const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
  const shown = useTween(amount);
  const mLow = shown * LOW, mHigh = shown * HIGH;

  return (
    <div className="max-w-[700px] mx-auto mt-16 border border-[#0a0a0a]/15 bg-white/50 p-7 md:p-12 lift">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-6">{t.label}</div>
      <div className="text-xl md:text-2xl tracking-[-0.01em] mb-9 max-w-[28ch] leading-snug">{t.title}</div>

      {/* amount — slider + live value, plus quick presets */}
      <div className="flex items-end justify-between mb-3">
        <span className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45 font-mono">{t.youReceive}</span>
        <span className="text-2xl md:text-4xl font-medium tabular-nums tracking-[-0.03em]">{usd(amount)}</span>
      </div>
      <input
        type="range" min={500} max={20000} step={500} value={amount}
        onChange={e => setAmount(Number(e.target.value))}
        aria-label={t.youReceive}
        className="slip-range w-full"
      />
      <div className="flex flex-wrap gap-2 mt-5 mb-11">
        {presets.map(p => (
          <button
            key={p} type="button" onClick={() => setAmount(p)}
            className={"px-4 py-2 text-sm font-mono tabular-nums border transition-colors " +
              (amount === p ? "bg-[#0a0a0a] text-[#f1eee7] border-[#0a0a0a]" : "border-[#0a0a0a]/25 hover:border-[#0a0a0a]/60")}
          >{usd(p)}</button>
        ))}
      </div>

      {/* the loss — big, animated, accumulating */}
      <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45 font-mono mb-3">{t.lossLabel}</div>
      <div className="flex items-end gap-3 flex-wrap">
        <span className="text-5xl md:text-7xl font-medium tracking-[-0.045em] tabular-nums leading-[0.9]" style={{ color: "#b91c1c" }}>
          {usd(mLow)}<span className="text-[#0a0a0a]/25 mx-1">–</span>{usd(mHigh)}
        </span>
        <span className="text-xs uppercase tracking-[0.2em] text-[#0a0a0a]/45 mb-1">{t.perMonth}</span>
      </div>

      <div className="mt-9 grid grid-cols-2 gap-px bg-[#0a0a0a]/12 border border-[#0a0a0a]/12">
        <div className="bg-[#f1eee7] p-5">
          <div className="text-xl md:text-3xl font-medium tabular-nums tracking-[-0.03em]">{usd(mLow * 12)}<span className="text-[#0a0a0a]/25 mx-0.5">–</span>{usd(mHigh * 12)}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/45 mt-2">{t.perYear}</div>
        </div>
        <div className="bg-[#f1eee7] p-5">
          <div className="text-xl md:text-3xl font-medium tabular-nums tracking-[-0.03em]">{usd(mLow * 36)}<span className="text-[#0a0a0a]/25 mx-0.5">–</span>{usd(mHigh * 36)}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/45 mt-2">{t.over3y}</div>
        </div>
      </div>

      <p className="mt-7 text-xs leading-relaxed text-[#0a0a0a]/55 max-w-[62ch]">{t.foot}</p>
    </div>
  );
}

function ProofFact({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="group lift">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/30 mb-3 transition-colors duration-300 group-hover:text-[#FDDA24]">
        {n}
      </div>
      <div className="text-lg md:text-xl tracking-tight font-medium leading-[1.25]">{title}</div>
      <p className="mt-3 text-sm leading-[1.6] text-[#f1eee7]/65">{body}</p>
    </div>
  );
}

export default function Home() {
  const scrolled = useScrolled(80);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [lang, setLang] = useLang();
  const t = homeCopy[lang];
  // Lock body scroll while mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileMenu ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileMenu]);
  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain overflow-x-hidden">
      <header
        className={
          "fixed top-0 left-0 right-0 z-30 transition-colors duration-300 " +
          (scrolled ? "bg-[#f1eee7]/80 backdrop-blur-md border-b border-[#0a0a0a]/8" : "bg-transparent")
        }
      >
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 py-4 md:py-6 flex items-center justify-between">
        <Logo variant={scrolled ? "ink" : "bone"} />
        {/* Desktop nav */}
        <nav
          className={"hidden md:flex items-center gap-7 text-[10px] uppercase tracking-[0.22em] transition-colors duration-300 " +
            (scrolled ? "text-[#0a0a0a]" : "text-[#f1eee7]")}
          style={scrolled ? undefined : { textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}
        >
          <Link to="/agents" className="hover:opacity-60 transition-opacity">{t.nav.agents}</Link>
          <a href="https://slippay.gitbook.io/slippay-docs" className="hover:opacity-60 transition-opacity">{t.nav.docs}</a>
          <a href="#proof" className="hover:opacity-60 transition-opacity">{t.nav.how}</a>
          <Link to="/login" className="hover:opacity-60 transition-opacity">{t.nav.login}</Link>
          <LangToggle lang={lang} setLang={setLang} />
          <Link to="/signup"
            style={{ textShadow: "none" }}
            className="lift bg-[#FDDA24] text-[#0a0a0a] px-4 py-2 hover:bg-[#a8d949] text-[10px] uppercase tracking-[0.22em] flex items-center gap-2 font-medium">
            <span className="inline-block w-1 h-1 bg-[#0a0a0a]" />
            {t.nav.signup}
          </Link>
        </nav>
        {/* Mobile hamburger */}
        <button
          aria-label="Open menu"
          onClick={() => setMobileMenu(v => !v)}
          className={"md:hidden flex flex-col gap-1.5 p-2.5 transition-colors " + (scrolled ? "text-[#0a0a0a]" : "text-[#f1eee7] bg-[#0a0a0a]/35 backdrop-blur-sm")}
        >
          <span className="block w-6 h-[2px] bg-current" />
          <span className="block w-6 h-[2px] bg-current" />
          <span className="block w-4 h-[2px] bg-current ml-auto" />
        </button>
        </div>
      </header>

      {/* Mobile menu overlay */}
      {mobileMenu && (
        <div
          className="menu-in md:hidden fixed inset-0 z-40 bg-[#0a0a0a] text-[#f1eee7] flex flex-col"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-center justify-between px-5 py-4">
            <Logo variant="bone" />
            <button
              aria-label="Close menu"
              onClick={() => setMobileMenu(false)}
              className="text-3xl leading-none px-2 py-1 -mr-2"
            >×</button>
          </div>
          <nav className="menu-stagger flex-1 flex flex-col px-5 pt-8 gap-1 text-[#f1eee7]">
            {[
              { to: "/", label: t.nav.home },
              { to: "/agents", label: t.nav.agents },
              { to: "https://slippay.gitbook.io/slippay-docs", label: t.nav.docs },
              { to: "/login", label: t.nav.login },
            ].map(l => (
              l.to.startsWith("http") ? (
                <a
                  key={l.to} href={l.to}
                  className="py-4 text-3xl font-medium tracking-tight border-b border-[#f1eee7]/15"
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.to} to={l.to}
                  onClick={() => setMobileMenu(false)}
                  className="py-4 text-3xl font-medium tracking-tight border-b border-[#f1eee7]/15"
                >
                  {l.label}
                </Link>
              )
            ))}
            <Link
              to="/signup"
              onClick={() => setMobileMenu(false)}
              className="mt-8 bg-[#FDDA24] text-[#0a0a0a] py-4 text-center text-sm uppercase tracking-[0.22em] font-medium flex items-center justify-center gap-3"
            >
              <span className="inline-block w-1.5 h-1.5 bg-[#0a0a0a]" />
              {t.nav.signup}
            </Link>
            <LangToggle lang={lang} setLang={setLang} className="mt-8 text-sm uppercase tracking-[0.22em]" />
          </nav>
          <div className="px-5 py-6 text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 font-mono">
            {t.mobileFooter}
          </div>
        </div>
      )}
      {/* Spacer to offset the now-fixed header from the hero photo. */}
      <div className="h-0" />

      {/* ───────── 1 · HERO ─────────
          Full-bleed image, then centered monumental type. One promise, one CTA.
          No spec card, no fashion SKU tag. The feeling leads. */}
      <div className="relative w-full bg-[#0a0a0a] overflow-hidden">
        <picture className="hidden md:block">
          <source srcSet="/hero.webp?v=opt1" type="image/webp" />
          <img
            src="/hero.jpg?v=opt1"
            alt="slippay · the statue of liberty blindfolded in a KLEIN green band reading slippay in gold leaf"
            className="w-full h-auto"
            loading="eager"
            decoding="async"
          />
        </picture>
        <div
          className="md:hidden w-full h-[48vh] min-h-[340px] max-h-[480px] bg-[position:center_30%]"
          style={{
            backgroundImage: "image-set(url('/hero.webp?v=opt1') type('image/webp'), url('/hero.jpg?v=opt1') type('image/jpeg'))",
            backgroundSize: "cover",
            backgroundRepeat: "no-repeat",
          }}
          aria-label="slippay · the statue of liberty blindfolded in a KLEIN green band reading slippay in gold leaf"
        />
        <div className="absolute bottom-0 left-0 right-0 h-16 md:h-12 bg-gradient-to-b from-transparent via-[#f1eee7]/40 to-[#f1eee7] pointer-events-none" />
      </div>

      {/* HERO TEXT — centered, monumental, single CTA */}
      <Reveal as="section" className="max-w-[1400px] mx-auto px-5 md:px-12 pt-10 md:pt-24 pb-20 md:pb-32 relative">
        {/* ambient lime aurora — slow drift behind the hero, editorial not gaudy */}
        <div aria-hidden className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-[90%] h-[130%] -z-0 animate-[aurora-drift_11s_ease-in-out_infinite]" style={{ background: "radial-gradient(45% 45% at 50% 30%, rgba(253,218,36,0.22), transparent 70%)", filter: "blur(6px)" }} />
        <div className="relative flex flex-col items-center text-center">
          <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 font-mono mb-6">
            <span className="flex items-center gap-2 normal-case tracking-tight">
              <span className="inline-block w-2 h-2 bg-[#FDDA24]" />
              {t.hero.badge}
            </span>
          </div>
          <h1 className="title-grad text-[9vw] sm:text-[7vw] md:text-[4.4vw] font-medium leading-[1.04] tracking-[-0.035em] max-w-[20ch] mx-auto break-words">
            {t.hero.h1}
          </h1>
          <p className="mt-7 md:mt-9 text-[16px] md:text-xl leading-[1.5] text-[#0a0a0a]/80 max-w-[48ch] mx-auto">
            {t.hero.sub}
          </p>
          <div className="mt-9 md:mt-11 flex justify-center">
            <MagneticCTA to="/signup">
              {t.hero.cta} <span>→</span>
            </MagneticCTA>
          </div>
        </div>
      </Reveal>

      {/* ───────── 1.5 · PAYMENT FLOW, animated ───────── */}
      <Reveal as="section" className="border-t border-[#0a0a0a]/15">
        <div className="max-w-[1400px] mx-auto px-5 md:px-12 py-20 md:py-28 grid md:grid-cols-2 gap-12 md:gap-16 items-center">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-5">{t.payflow.label}</div>
            <h2 className="text-4xl md:text-6xl font-medium tracking-[-0.04em] leading-[0.98] max-w-[14ch]">
              {t.payflow.h2}<span className="inline-block w-2.5 h-2.5 bg-[#FDDA24] ml-2 align-baseline" />
            </h2>
            <p className="mt-6 text-base md:text-lg text-[#0a0a0a]/75 leading-relaxed max-w-[44ch]">
              {t.payflow.body}
            </p>
            <Link to="/pay" className="lift inline-flex items-center gap-3 mt-8 bg-[#0a0a0a] text-[#f1eee7] px-7 py-4 text-[11px] uppercase tracking-[0.22em]">
              {t.payflow.cta} <span>→</span>
            </Link>
          </div>
          <div className="flex justify-center md:pr-6">
            <PayFlowDemo />
          </div>
        </div>
      </Reveal>

      {/* ───────── 2 · THE PROBLEM ─────────
          The gap, condensed and visceral. One idea per line, centered. */}
      <Reveal as="section" className="border-t border-[#0a0a0a]/15">
        <div className="max-w-[1400px] mx-auto px-5 md:px-12 py-20 md:py-32">
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 font-mono text-center mb-10">
            {t.gap.label}
          </div>
          {/* b1 opens as the gut-punch ("já chega menor"); b2 and b3 carry their
              own eyebrows so the pain scans. b3 (inverse-flow) anchors — it is
              the one line that says why no incumbent serves this person. */}
          <div className="max-w-[36ch] mx-auto text-center space-y-12">
            <p className="text-2xl md:text-4xl leading-[1.18] tracking-[-0.02em] text-[#0a0a0a]/90">
              {t.gap.b1}
            </p>
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45 font-mono">
                {t.gap.b2Label}
              </div>
              <p className="text-xl md:text-2xl leading-[1.3] tracking-[-0.01em] text-[#0a0a0a]/75">
                {t.gap.b2}
              </p>
            </div>
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#FDDA24] font-mono">
                {t.gap.b3Label}
              </div>
              <p className="text-xl md:text-2xl leading-[1.3] tracking-[-0.01em] text-[#0a0a0a]/90">
                {t.gap.b3}
              </p>
            </div>
          </div>
          {/* make the 5–12% concrete — status-quo loss only, no Slippay-saving claim */}
          <LossCalculator t={t.calc} />
        </div>
      </Reveal>

      {/* ───────── 2.5 · HOW YOU USE IT ─────────
          Plain 3-step consumer flow — answers "how does a person use this?". */}
      <Reveal as="section" className="border-t border-[#0a0a0a]/15">
        <div className="max-w-[1400px] mx-auto px-5 md:px-12 py-20 md:py-32">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 text-center mb-6">
            {t.howto.label}
          </div>
          <h2 className="title-grad text-3xl md:text-6xl font-medium tracking-[-0.035em] leading-[1.02] max-w-[16ch] mx-auto text-center">
            {t.howto.h2}
          </h2>
          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 max-w-[1100px] mx-auto">
            {t.howto.steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 100} className="lift border border-[#0a0a0a]/15 bg-white/40 p-7 md:p-9">
                <div className="flex items-center gap-3">
                  <span className="text-5xl md:text-6xl font-medium tracking-[-0.05em] tabular-nums text-[#0a0a0a]/12 leading-none">{s.n}</span>
                  <span className="inline-block w-2 h-2 bg-[#FDDA24]" />
                </div>
                <div className="text-xl md:text-2xl font-medium tracking-tight mt-5">{s.t}</div>
                <p className="mt-3 text-sm md:text-base text-[#0a0a0a]/70 leading-relaxed">{s.b}</p>
              </Reveal>
            ))}
          </div>
          <p className="mt-10 text-xs text-[#0a0a0a]/55 text-center max-w-[64ch] mx-auto leading-relaxed">{t.howto.foot}</p>
        </div>
      </Reveal>

      {/* ───────── 3 · THE PROOF, as a feeling ─────────
          "it simply can't." Condensed proof facts, then a prominent link to the
          product on stage (/x402-demo). The terminal stays as an opt-in aside. */}
      <Reveal as="section" id="proof" className="border-t border-[#0a0a0a]/15 bg-[#0a0a0a] text-[#f1eee7]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-12 py-20 md:py-32">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 text-center mb-6">
            {t.proof.kicker}
          </div>
          <h2 className="title-grad-dark text-3xl md:text-6xl font-medium tracking-[-0.035em] leading-[1.02] max-w-[18ch] mx-auto text-center">
            {t.proof.h2}
          </h2>
          <p className="mt-8 text-base md:text-lg leading-[1.65] text-[#f1eee7]/75 max-w-[60ch] mx-auto text-center">
            {t.proof.body}
          </p>

          {/* the proof, in four plain facts — condensed */}
          <div className="mt-14 grid grid-cols-1 md:grid-cols-4 gap-x-10 gap-y-10 max-w-[1000px] mx-auto">
            {/* benefit-first order: "nobody can freeze it" leads (the most
                visceral, most-understood differentiator), then cost, then Pix,
                then the seed-phrase/tech reassurance last. */}
            <ProofFact n="01" title={t.proof.certLabel} body={t.proof.certBody} />
            <ProofFact n="02" title={t.proof.proveLabel} body={t.proof.proveBody} />
            <ProofFact n="03" title={t.proof.refuseLabel} body={t.proof.refuseBody} />
            <ProofFact n="04" title={t.proof.invariantLabel} body={t.proof.invariantBody} />
          </div>

          {/* quiet handoff to the builder/agent surface — the proof artifacts,
              the axlc spend-limit certificate and the x402 backing now live on
              /agents so this page stays zero-tech. Low visual weight: the only
              high-contrast ask here remains "Entrar na lista". */}
          <div className="mt-16 flex justify-center">
            <Link to="/agents"
              className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 hover:text-[#FDDA24] transition-colors border-b border-[#f1eee7]/20 pb-1">
              {t.proof.seeItWork} <span className="group-hover:translate-x-1 transition-transform">→</span>
            </Link>
          </div>
        </div>
      </Reveal>

      {/* ───────── 4 · BRIDGE → /agents ─────────
          The single handoff from the human story (A) to the builder/agent
          surface (B). One line + one quiet button. The home stays zero-tech;
          x402 backing, the axlc certificate and the mainnet artifacts live on
          /agents for the people who came for that. */}
      <Reveal as="section" className="border-t border-[#0a0a0a]/15">
        <div className="max-w-[1400px] mx-auto px-5 md:px-12 py-20 md:py-28 text-center">
          <p className="text-2xl md:text-4xl font-medium tracking-[-0.025em] leading-[1.15] max-w-[20ch] mx-auto">
            {t.bridge.line}
          </p>
          <Link to="/agents"
            className="lift inline-flex items-center gap-3 mt-9 border border-[#0a0a0a]/30 px-7 py-4 text-[11px] uppercase tracking-[0.22em] hover:bg-[#0a0a0a] hover:text-[#f1eee7] transition-colors">
            {t.bridge.button} <span>→</span>
          </Link>
        </div>
      </Reveal>

      {/* ───────── 5 · HONEST STATUS + final CTA ─────────
          The truth out loud (test network · checked by us · outside audit +
          real money to come), then one monumental ask. */}
      <Reveal as="section" id="status" className="border-t border-[#0a0a0a]/15 bg-[#0a0a0a] text-[#f1eee7]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-12 py-20 md:py-32">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 text-center mb-6">
            {t.status.label}
          </div>
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-px bg-[#f1eee7]/15 border border-[#f1eee7]/15 overflow-hidden max-w-[1000px] mx-auto">
            <div className="group bg-[#0a0a0a] p-6 md:p-8 transition-colors duration-300 hover:bg-[#151515]">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 font-mono transition-colors duration-300 group-hover:text-[#FDDA24]">{t.status.cNetwork}</div>
              <div className="mt-3 text-sm md:text-base font-medium tracking-tight text-[#f1eee7]">{t.status.cNetworkV}</div>
            </div>
            <div className="group bg-[#0a0a0a] p-6 md:p-8 transition-colors duration-300 hover:bg-[#151515]">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 font-mono transition-colors duration-300 group-hover:text-[#FDDA24]">{t.status.cAudit}</div>
              <div className="mt-3 text-sm md:text-base font-medium tracking-tight text-[#f1eee7]">{t.status.cAuditV}</div>
            </div>
            <div className="group bg-[#0a0a0a] p-6 md:p-8 transition-colors duration-300 hover:bg-[#151515]">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 font-mono transition-colors duration-300 group-hover:text-[#FDDA24]">{t.status.cBound}</div>
              <div className="mt-3 text-sm md:text-base font-medium tracking-tight text-[#f1eee7]">{t.status.cBoundV}</div>
            </div>
            <div className="group bg-[#0a0a0a] p-6 md:p-8 transition-colors duration-300 hover:bg-[#151515]">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 font-mono transition-colors duration-300 group-hover:text-[#FDDA24]">{t.status.cChain}</div>
              <div className="mt-3 text-sm md:text-base font-medium tracking-tight text-[#f1eee7]">{t.status.cChainV}</div>
            </div>
          </div>

          {/* the live-on-mainnet artifacts moved to /agents (proof-first there).
              A quiet pointer keeps the trust signal reachable without putting
              explorer hashes on the zero-tech human page. */}
          <div className="mt-10 text-center">
            <Link to="/agents"
              className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 hover:text-[#FDDA24] transition-colors border-b border-[#f1eee7]/20 pb-1">
              {t.status.mainnetLabel} <span className="group-hover:translate-x-1 transition-transform">→</span>
            </Link>
          </div>

          {/* one final ask — monumental */}
          <div className="mt-24 md:mt-32 text-center flex flex-col items-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 mb-8 tabular-nums">
              {t.cta.kicker} <span className="inline-block w-2 h-2 bg-[#FDDA24] ml-2 align-middle" />
            </div>
            <h2 className="title-grad-dark text-[12vw] md:text-[5.2vw] font-medium tracking-[-0.04em] leading-[0.95] max-w-[14ch] mx-auto text-center">
              {t.cta.h2}
            </h2>
            <p className="mt-10 text-base md:text-lg text-[#f1eee7]/75 max-w-[50ch] mx-auto text-center">
              {t.cta.body}
            </p>
            <div className="mt-12 flex flex-col sm:flex-row items-center gap-5">
              <Link to="/signup"
                className="lift inline-flex items-center gap-3 bg-[#FDDA24] text-[#0a0a0a] px-8 py-4 text-[11px] uppercase tracking-[0.22em] font-medium hover:bg-[#c3f06a]">
                {t.cta.button} <span>→</span>
              </Link>
              <a href="https://galmanus.github.io/ssl-spec/" target="_blank" rel="noopener noreferrer"
                className="group inline-flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] border-b border-[#f1eee7] pb-1 hover:opacity-60">
                {t.cta.spec} <span className="group-hover:translate-x-1 transition-transform">↗</span>
              </a>
            </div>
          </div>
        </div>
      </Reveal>

      {/* FOOTER */}
      <footer className="border-t border-[#0a0a0a]/15 bg-[#0a0a0a] text-[#f1eee7]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-12 pt-20 pb-8">
          <div className="grid grid-cols-12 gap-6 pb-16 border-b border-[#f1eee7]/15">
            <div className="col-span-12 md:col-span-4">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 font-mono mb-4">
                {t.footer.product}
              </div>
              <ul className="space-y-2 text-sm">
                <li><Link to="/signup" className="hover:opacity-60">{t.footer.fSignup}</Link></li>
                <li><Link to="/login" className="hover:opacity-60">{t.footer.fLogin}</Link></li>
                <li><a href="#proof" className="hover:opacity-60">{t.footer.fHow}</a></li>
              </ul>
            </div>
            <div className="col-span-12 md:col-span-4">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 font-mono mb-4">
                {t.footer.resources}
              </div>
              <ul className="space-y-2 text-sm">
                <li><a href="https://slippay.gitbook.io/slippay-docs" className="hover:opacity-60">{t.footer.fApi}</a></li>
                <li><a href="https://slippay.gitbook.io/slippay-docs" className="hover:opacity-60">{t.footer.fGuides}</a></li>
                <li><a href="https://slippay.gitbook.io/slippay-docs" className="hover:opacity-60">{t.footer.fAudits}</a></li>
                <li><a href="https://slippay.gitbook.io/slippay-docs" className="hover:opacity-60">{t.footer.fX402}</a></li>
                <li><a href="https://galmanus.github.io/ssl-spec/" target="_blank" rel="noopener noreferrer" className="hover:opacity-60">{t.footer.fSsl}</a></li>
              </ul>
            </div>
            <div className="col-span-12 md:col-span-4">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 font-mono mb-4">
                {t.footer.legal}
              </div>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:opacity-60">{t.footer.fTerms}</a></li>
                <li><a href="#" className="hover:opacity-60">{t.footer.fPrivacy}</a></li>
              </ul>
            </div>
          </div>

          <div className="pt-16 pb-8 leading-none">
            <span className="block text-[#f1eee7] text-[20vw] md:text-[14vw] font-medium tracking-[-0.05em] -mb-4">
              slippay<span className="text-[#FDDA24]">.</span>
            </span>
          </div>

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 font-mono">
            <div>© 2026 · SlipPay · v0.2</div>
            <a href="https://stellar.expert/explorer/public/contract/CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN" target="_blank" rel="noopener noreferrer" className="hover:text-[#FDDA24] transition-colors">stellar · subscription contract · CBJMQ6ZY…SEVQN ↗</a>
            <div>Blumenau · BR</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
