// /receber — receberPix: link your Pix key, every incoming Pix auto-becomes USDC
// in YOUR biometric wallet. Receiving IS activation (stolen: Bipa/BitPix → R$4bn).
// Acquisition funnel + hackathon demo centerpiece. B2B payout section folded in
// (freelancer/PJ receiving from abroad = the real money, stolen: BlindPay).
//
// Design cloned from LandingV2/Cofrinho: Inter monumental, BONE/INK, single
// #22d3ee accent, bilingual, reveal-on-scroll. Proof via a REAL mainnet tx hash
// (verifiable) — no fabricated data, no flaky live fetch.

import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Waitlist } from "../components/Waitlist.tsx";
import { DarkGlow } from "../components/DarkGlow.tsx";

const display = { fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" } as const;
const GRAY = "#8a93ad";
const ACCENT = "#22d3ee";
const LIVE_CONTRACT = "CCT3KJXRUO3HJJ2GLTW2MISSQVUEKOPUG3B4YQH75TCGKAOC4P6FIKUF";
const REAL_TX = "ede13fb6230334af91b2af1cfab92f86f8f44e8a7755acb57d92891d68a3e957";
const xurl = (p: string, id: string) => `https://stellar.expert/explorer/public/${p}/${id}`;

type Lang = "pt" | "en";

const COPY = {
  pt: {
    nav: { cofrinho: "Cofrinho", pay: "Pagar", login: "Entrar", cta: "Conectar meu Pix" },
    hero: {
      eyebrow: "receberPix · em dólar",
      h1: "Todo Pix que cair vira dólar.",
      sub: "Conecte a sua chave Pix uma vez. A partir daí, cada Pix que você recebe vira dólar digital na sua carteira, automático, na hora, sem você tocar em nada. E o dólar é seu: ninguém congela.",
      cta: "Conectar meu Pix",
      note: "biometria · sem cartão · sem seed phrase",
    },
    how: {
      stamp: "como funciona",
      h: "Receber já é ter dólar.",
      steps: [
        ["Conecte seu Pix", "Aponte a sua chave Pix pro Slippay. Uma vez só."],
        ["O Pix cai", "Quem te paga manda um Pix normal, em real."],
        ["Vira dólar na sua carteira", "Em segundos, virou dólar digital, na sua mão, não na nossa."],
      ] as [string, string][],
      foot: "Sem decisão de compra, sem corretora. O recebimento é a conta de dólar.",
    },
    b2b: {
      stamp: "o dinheiro grande",
      h: "Recebe do exterior? O dólar chega em minutos.",
      body: "Freelancer, PJ, agência: quem fatura lá fora perde dias e ~5% em banco e corretora. No Slippay o pagamento vira dólar na sua carteira em minutos, com 0,98% na cara, e você saca, guarda ou converte quando quiser.",
      bullets: [
        "Liquida em minutos, não em dias",
        "0,98% transparente vs ~5% escondido",
        "Non-custodial: o dólar nunca passa pelo nosso balanço",
      ],
      cta: "Quero receber do exterior →",
    },
    fee: {
      stamp: "a conta limpa",
      h: "0,98% na cara. Você fica com o resto.",
      rows: [
        ["Banco / corretora", "~5%", false],
        ["Outras fintechs", "~1,5%", false],
        ["Slippay", "0,98%", true],
      ] as [string, string, boolean][],
      foot: "Taxa travada na confirmação. Sem mensalidade, sem letra miúda.",
    },
    proof: {
      stamp: "a prova",
      h: "Não confie. Confira.",
      lead: "Cada conversão deixa um recibo on-chain. Não é custódia, é seu, e dá pra auditar agora, sem pedir licença.",
      txBtn: "Ver um pagamento real ↗",
      contractBtn: "O contrato no ar ↗",
      tag: "ao vivo · mainnet stellar",
    },
    cta: { h: "Conecte seu Pix.", lines: ["Todo Pix vira dólar.", "Seu, do seu jeito."], btn: "Conectar meu Pix", note: "2 minutos · biometria" },
    footer: "slippay · receberPix em dólar · seu dinheiro, seu",
  },
  en: {
    nav: { cofrinho: "Cofrinho", pay: "Pay", login: "Login", cta: "Connect my Pix" },
    hero: {
      eyebrow: "receberPix · in dollars",
      h1: "Every Pix you receive becomes dollars.",
      sub: "Connect your Pix key to Slippay once. From then on, every Pix you receive turns into digital dollars in your wallet, automatic, instant, zero touch. And the dollars are yours: nobody freezes them.",
      cta: "Connect my Pix",
      note: "biometrics · no card · no seed phrase",
    },
    how: {
      stamp: "how it works",
      h: "Receiving already means dollars.",
      steps: [
        ["Connect your Pix", "Link your Pix key to Slippay. Just once."],
        ["The Pix lands", "Whoever pays you sends a normal Pix, in reais."],
        ["Dollars in your wallet", "In seconds it's digital dollars, in your hands, not ours."],
      ] as [string, string][],
      foot: "No buy decision, no exchange. Receiving is the dollar account.",
    },
    b2b: {
      stamp: "the real money",
      h: "Get paid from abroad? Dollars arrive in minutes.",
      body: "Freelancers, companies, agencies billing overseas lose days and ~5% to banks and brokers. With Slippay the payment becomes dollars in your wallet in minutes, 0.98% on the face, withdraw, hold, or convert whenever.",
      bullets: [
        "Settles in minutes, not days",
        "0.98% transparent vs ~5% hidden",
        "Non-custodial: dollars never touch our balance sheet",
      ],
      cta: "I want to get paid from abroad →",
    },
    fee: {
      stamp: "the clean math",
      h: "0.98% on the face. You keep the rest.",
      rows: [
        ["Bank / broker", "~5%", false],
        ["Other fintechs", "~1.5%", false],
        ["Slippay", "0.98%", true],
      ] as [string, string, boolean][],
      foot: "Fee locked at confirmation. No monthly fee, no fine print.",
    },
    proof: {
      stamp: "the proof",
      h: "Don't trust. Verify.",
      lead: "Every conversion leaves an on-chain receipt. Not custody, it's yours, and you can audit it now, no permission needed.",
      txBtn: "See a real payment ↗",
      contractBtn: "The live contract ↗",
      tag: "live · stellar mainnet",
    },
    cta: { h: "Connect your Pix.", lines: ["Every Pix becomes dollars.", "Yours, your way."], btn: "Connect my Pix", note: "2 minutes · biometrics" },
    footer: "slippay · receberPix in dollars · your money, yours",
  },
} as const;

function Stamp({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] justify-center md:justify-start" style={{ color: GRAY }}>
      <span className="h-px w-10 bg-current opacity-40" /><span>{label}</span>
    </div>
  );
}

export default function Receber() {
  const [scrolled, setScrolled] = useState(false);
  const [lang, setLang] = useState<Lang>(() => {
    try { const s = localStorage.getItem("slippay.lang"); if (s === "pt" || s === "en") return s; } catch { /* */ }
    return (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("pt")) ? "pt" : "en";
  });
  useEffect(() => { try { localStorage.setItem("slippay.lang", lang); } catch { /* */ } }, [lang]);
  const t = COPY[lang];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    root.classList.add("js-reveal");
    const io = new IntersectionObserver((ents) => { for (const e of ents) if (e.isIntersecting) { e.target.classList.add("reveal-in"); io.unobserve(e.target); } }, { rootMargin: "-8% 0px -8% 0px", threshold: 0.06 });
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => { io.disconnect(); root.classList.remove("js-reveal"); };
  }, []);

  const LangToggle = () => {
    const active = "text-[#f3f5fb] font-medium";
    return (
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#f3f5fb]/45">
        <button onClick={() => setLang("pt")} className={lang === "pt" ? active : "hover:opacity-80"}>PT</button>
        <span className="opacity-30 mx-1">/</span>
        <button onClick={() => setLang("en")} className={lang === "en" ? active : "hover:opacity-80"}>EN</button>
      </div>
    );
  };

  const btn = "lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#22d3ee] text-[#f3f5fb] font-semibold";
  const sec = "border-t border-white/10";
  const h2 = "font-black uppercase tracking-[-0.04em] leading-[0.88] text-center md:text-left mx-auto md:mx-0";

  return (
    <div className="relative min-h-screen bg-[#0a0e1a] text-[#f3f5fb] overflow-x-hidden" style={display}>
      <DarkGlow />
      <style>{`html{scroll-behavior:smooth}::selection{background:${ACCENT};color:#0a0e1a} .dk-content{position:relative;z-index:1}`}</style>

      <header className={"fixed top-0 left-0 right-0 z-40 px-6 md:px-12 py-4 flex items-center justify-between transition-colors duration-300 " + (scrolled ? "backdrop-blur-md bg-[#0a0e1a]/85 border-b border-white/10" : "bg-transparent")}>
        <Link to="/" className="text-2xl md:text-3xl lowercase text-[#f3f5fb]" style={{ ...display, fontWeight: 800, letterSpacing: "-0.04em" }}>slippay<span style={{ color: ACCENT }}>.</span></Link>
        <nav className="flex items-center gap-5 text-[10px] uppercase tracking-[0.2em] text-[#f3f5fb]/55">
          <Link to="/pay" className="hidden md:inline transition-opacity hover:opacity-70">{t.nav.pay}</Link>
          <span className="hidden md:inline"><LangToggle /></span>
          <Link to="/account" className="inline-flex items-center rounded-full px-5 py-2.5 bg-[#22d3ee] text-[#f3f5fb] font-semibold hover:opacity-90">{t.nav.cta}</Link>
        </nav>
      </header>

      {/* HERO — receberPix */}
      <section className="bg-[#0d1322] text-[#f3f5fb]">
        <div className="max-w-[940px] mx-auto px-6 pt-32 md:pt-44 pb-20 md:pb-28 flex flex-col items-center text-center">
          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 border border-white/15 font-mono text-[10px] uppercase tracking-[0.22em] text-[#f3f5fb]/55"><span className="w-1.5 h-1.5 rounded-full" style={{ background: ACCENT }} />{lang === "pt" ? "em breve · entre na lista" : "coming soon · join the list"}</span>
          <span className="mt-4 font-mono text-[10px] uppercase tracking-[0.24em] text-[#f3f5fb]/45">{t.hero.eyebrow}</span>
          <h1 className="mt-7 font-black uppercase tracking-[-0.03em] leading-[0.88] text-[clamp(2.2rem,8.5vw,5.75rem)] max-w-[14ch]" style={display}>{t.hero.h1}</h1>
          <p className="mt-7 text-base md:text-xl text-[#f3f5fb]/65 max-w-[38ch] md:max-w-[48ch] leading-relaxed">{t.hero.sub}</p>
          <a href="#lista" className={btn + " mt-9"}>{t.hero.cta}</a>
          <span className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-[#f3f5fb]/45">{t.hero.note}</span>
        </div>
      </section>

      {/* HOW — receiving is activation */}
      <section className={sec}><div data-reveal className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-32">
        <Stamp label={t.how.stamp} />
        <h2 className={`mt-10 ${h2} text-[clamp(2.25rem,8vw,5rem)]`} style={display}>{t.how.h}</h2>
        <div className="mt-14 grid md:grid-cols-3 gap-px bg-[#0d1322]/12 border border-white/10 rounded-2xl overflow-hidden">
          {t.how.steps.map(([h, b], i) => (
            <div key={i} className="bg-[#0a0e1a] p-7 md:p-9">
              <span className="font-mono text-[12px]" style={{ color: GRAY }}>{String(i + 1).padStart(2, "0")}</span>
              <div className="mt-4 text-2xl md:text-3xl font-bold tracking-[-0.02em]" style={display}>{h}</div>
              <p className="mt-2 text-[15px] text-[#f3f5fb]/60">{b}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-lg md:text-xl font-medium tracking-[-0.01em]">{t.how.foot}</p>
      </div></section>

      {/* B2B — the real money (inverted INK) */}
      <section className="px-4 md:px-6 py-2"><div data-reveal className="bg-[#0d1322] text-[#f3f5fb] rounded-[1.75rem] md:rounded-[2.5rem] max-w-[1200px] mx-auto px-6 md:px-14 py-24 md:py-36">
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#f3f5fb]/40">
          <span className="h-px w-8 bg-[#0a0e1a]/30" /><span>{t.b2b.stamp}</span>
        </div>
        <h2 className="mt-10 font-black uppercase tracking-[-0.04em] leading-[0.88] text-[clamp(2.25rem,7vw,5rem)] max-w-[16ch]" style={display}>{t.b2b.h}</h2>
        <p className="mt-8 text-lg md:text-2xl text-[#f3f5fb]/70 leading-relaxed max-w-[54ch]">{t.b2b.body}</p>
        <ul className="mt-10 flex flex-col gap-3 max-w-[48ch]">
          {t.b2b.bullets.map((b) => (
            <li key={b} className="flex items-start gap-3 text-[15px] md:text-[17px] text-[#f3f5fb]/85">
              <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ACCENT }} />{b}
            </li>
          ))}
        </ul>
        <Link to="/account" className="mt-10 lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#22d3ee] text-[#f3f5fb] font-semibold">{t.b2b.cta}</Link>
      </div></section>

      {/* FEE anchor */}
      <section className={sec}><div data-reveal className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-32">
        <Stamp label={t.fee.stamp} />
        <h2 className={`mt-10 ${h2} text-[clamp(2.25rem,7vw,4.75rem)] max-w-[16ch]`} style={display}>{t.fee.h}</h2>
        <div className="mt-12 max-w-[640px] flex flex-col">
          {t.fee.rows.map(([who, rate, hot], i) => (
            <div key={i} className={"flex items-center justify-between py-5 border-t " + (hot ? "border-white/15" : "border-white/10")}>
              <span className={"text-lg md:text-2xl tracking-[-0.01em] " + (hot ? "font-bold" : "text-[#f3f5fb]/60")} style={display}>{who}</span>
              <span className={"font-mono text-xl md:text-3xl tabular-nums " + (hot ? "font-black" : "text-[#f3f5fb]/55")} style={hot ? { background: ACCENT, padding: "2px 10px", borderRadius: "8px" } : undefined}>{rate}</span>
            </div>
          ))}
        </div>
        <p className="mt-8 text-lg md:text-xl font-medium tracking-[-0.01em]">{t.fee.foot}</p>
      </div></section>

      {/* PROOF — real on-chain tx */}
      <section className={sec}><div data-reveal className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-32">
        <Stamp label={t.proof.stamp} />
        <h2 className={`mt-10 ${h2} text-[clamp(2.5rem,8vw,5.5rem)]`} style={display}>{t.proof.h}</h2>
        <p className="mt-6 text-lg md:text-xl text-[#f3f5fb]/65 max-w-[52ch] mx-auto md:mx-0">{t.proof.lead}</p>
        <div className="mt-8 inline-flex items-center gap-2 rounded-full px-4 py-2 border border-white/15">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#f3f5fb]/55">{t.proof.tag}</span>
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4">
          <a href={xurl("tx", REAL_TX)} target="_blank" rel="noreferrer" className={btn}>{t.proof.txBtn}</a>
          <a href={xurl("contract", LIVE_CONTRACT)} target="_blank" rel="noreferrer" className="text-[12px] uppercase tracking-[0.18em] border-b border-white/20 hover:border-white/15 pb-1" style={{ color: GRAY }}>{t.proof.contractBtn}</a>
        </div>
      </div></section>

      {/* CTA — waitlist */}
      <section id="lista" className={sec}><div className="max-w-[1200px] mx-auto px-6 md:px-12 py-28 md:py-40">
        <h2 className="font-black uppercase tracking-[-0.055em] leading-[0.82] text-[clamp(3rem,14vw,11rem)] text-center md:text-left" style={display}>{t.cta.h}</h2>
        <div className="mt-8 flex flex-col gap-1 text-xl md:text-2xl text-[#f3f5fb]/65 text-center md:text-left">{t.cta.lines.map((l) => <span key={l}>{l}</span>)}</div>
        <div className="mt-12 flex flex-col items-center md:items-start gap-5">
          <Waitlist source="receber" lang={lang} />
          <Link to="/account" className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#f3f5fb]/45 border-b border-white/20 hover:border-white/15 pb-0.5">{lang === "pt" ? "ver o app ao vivo →" : "see the live app →"}</Link>
        </div>
        <div className="mt-20 font-mono text-[10px] uppercase tracking-[0.28em] text-[#f3f5fb]/30">{t.footer}</div>
      </div></section>
    </div>
  );
}
