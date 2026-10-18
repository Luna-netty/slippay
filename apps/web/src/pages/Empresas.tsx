// /empresas (+/b2b) — B2B payout/collection: the real money (stolen: BlindPay,
// $900K -> $450M TPV in 14mo via "0% até R$X" + API-first agent-discovery).
// Receive from / pay to abroad in dollars, settle in minutes, 0.98%, non-custodial.
// Target ICP: freelancer/PJ recebendo do exterior, empresa pagando fornecedor,
// marketplace pagando sellers. Same design system as the rest of the funnel.

import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Waitlist } from "../components/Waitlist.tsx";
import { V3Ribbon } from "../components/V3Ribbon.tsx";

const display = { fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" } as const;
const GRAY = "#6f6862";
const ACCENT = "#FDDA24";
const LIVE_CONTRACT = "CCT3KJXRUO3HJJ2GLTW2MISSQVUEKOPUG3B4YQH75TCGKAOC4P6FIKUF";
const xurl = (p: string, id: string) => `https://stellar.expert/explorer/public/${p}/${id}`;

type Lang = "pt" | "en";

const COPY = {
  pt: {
    nav: { cofrinho: "Cofrinho", receive: "Receber", api: "API", login: "Entrar", cta: "Falar com a gente" },
    hero: {
      eyebrow: "para empresas · payout em dólar",
      h1: "Receba e pague em dólar. Em minutos, não dias.",
      sub: "Freelancer, PJ, agência, marketplace: mova dólar pra dentro e pra fora do Brasil via Pix↔USDC, com liquidação em minutos e 0,98% na cara. Non-custodial, o dinheiro nunca passa pelo nosso balanço.",
      cta: "Falar com a gente",
      ctaApi: "Ver a API →",
      note: "0% até R$50 mil liquidados · sem setup · sem mensalidade",
    },
    pain: {
      stamp: "o custo de hoje",
      h: "Banco e corretora cobram caro e demoram.",
      items: [
        ["~5% por operação", "IOF de 3,5% mais spread escondido em cada câmbio. Some no fim do mês."],
        ["Dias de espera", "Receber do exterior e converter leva dias. O dólar de volta pro real, mais ainda."],
        ["Conta pode travar", "Conta custodiada congela ou fecha sem aviso. Seu fluxo de caixa refém."],
      ] as [string, string][],
    },
    use: {
      stamp: "para quem",
      h: "Quem vive de dólar.",
      items: [
        ["Freelancer & PJ", "Recebe de cliente lá fora. O Pix/USDC cai na sua carteira em minutos, não em dias."],
        ["Empresa", "Paga fornecedor, SaaS e folha no exterior, dentro do limite que você define, com recibo de cada um."],
        ["Marketplace & plataforma", "Paga centenas de sellers em USDC via uma API. Embarca sob a sua marca."],
      ] as [string, string][],
    },
    fee: {
      stamp: "preço",
      h: "0% pra começar. 0,98% depois.",
      rows: [
        ["Banco / corretora", "~5%", false],
        ["PSP de cartão", "~2,6–3,5%", false],
        ["Slippay", "0,98%", true],
      ] as [string, string, boolean][],
      foot: "0% até R$50 mil liquidados, pra você provar sem risco. Depois, 0,98% na cara, travado na confirmação.",
    },
    api: {
      stamp: "para devs",
      h: "Uma API. Os agentes te acham sozinhos.",
      body: "Pix→USDC payout e collection por REST. Recibo on-chain em cada transação. Endpoints de descoberta (.well-known/mcp + llms.txt) pra agentes de IA integrarem o seu rail sem você levantar a mão. Compatível com x402.",
      bullets: ["REST simples + webhooks", "Recibo on-chain verificável", "MCP + x402 nativos", "Sandbox grátis"],
      cta: "Quero a chave de API →",
    },
    proof: {
      stamp: "a prova",
      h: "Provado on-chain. Auditável agora.",
      lead: "Cada liquidação deixa recibo na mainnet Stellar. Não é a nossa palavra, é o explorer.",
      contractBtn: "Ver o contrato no ar ↗",
      tag: "ao vivo · mainnet stellar",
    },
    cta: { h: "Mova dólar de verdade.", lines: ["Em minutos. 0,98%. Seu.", "Comece com 0% até R$50 mil."], btn: "Falar com a gente", note: "resposta em 24h · sem compromisso" },
    footer: "slippay · payout em dólar para empresas · non-custodial",
  },
  en: {
    nav: { cofrinho: "Cofrinho", receive: "Receive", api: "API", login: "Login", cta: "Talk to us" },
    hero: {
      eyebrow: "for business · dollar payouts",
      h1: "Receive and pay in dollars. In minutes, not days.",
      sub: "Freelancers, companies, agencies, marketplaces: move dollars in and out of Brazil via Pix↔USDC, settling in minutes at 0.98% on the face. Non-custodial, the money never touches our balance sheet.",
      cta: "Talk to us",
      ctaApi: "See the API →",
      note: "0% up to R$50k settled · no setup · no monthly fee",
    },
    pain: {
      stamp: "today's cost",
      h: "Banks and brokers charge a lot and take forever.",
      items: [
        ["~5% per operation", "3.5% IOF plus hidden spread on every FX. It adds up by month-end."],
        ["Days of waiting", "Receiving from abroad and converting takes days. Dollars back to reais, even longer."],
        ["Accounts can freeze", "Custodial accounts freeze or close without notice. Your cash flow held hostage."],
      ] as [string, string][],
    },
    use: {
      stamp: "for whom",
      h: "Whoever lives on dollars.",
      items: [
        ["Freelancers & SMBs", "Get paid by clients abroad. Pix/USDC lands in your wallet in minutes, not days."],
        ["Companies", "Pay suppliers, SaaS and payroll abroad, within the limit you set, with a receipt for each."],
        ["Marketplaces & platforms", "Pay hundreds of sellers in USDC via one API. Embed under your brand."],
      ] as [string, string][],
    },
    fee: {
      stamp: "pricing",
      h: "0% to start. 0.98% after.",
      rows: [
        ["Bank / broker", "~5%", false],
        ["Card PSP", "~2.6–3.5%", false],
        ["Slippay", "0.98%", true],
      ] as [string, string, boolean][],
      foot: "0% up to R$50k settled, so you prove it risk-free. Then 0.98% on the face, locked at confirmation.",
    },
    api: {
      stamp: "for devs",
      h: "One API. Agents find you on their own.",
      body: "Pix→USDC payout and collection over REST. On-chain receipt per transaction. Discovery endpoints (.well-known/mcp + llms.txt) so AI agents integrate your rail without you lifting a hand. x402-compatible.",
      bullets: ["Simple REST + webhooks", "Verifiable on-chain receipt", "Native MCP + x402", "Free sandbox"],
      cta: "Get an API key →",
    },
    proof: {
      stamp: "the proof",
      h: "Proven on-chain. Auditable now.",
      lead: "Every settlement leaves a receipt on Stellar mainnet. Not our word, the explorer.",
      contractBtn: "See the live contract ↗",
      tag: "live · stellar mainnet",
    },
    cta: { h: "Move real dollars.", lines: ["In minutes. 0.98%. Yours.", "Start with 0% up to R$50k."], btn: "Talk to us", note: "reply in 24h · no commitment" },
    footer: "slippay · dollar payouts for business · non-custodial",
  },
} as const;

function Stamp({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] justify-center md:justify-start" style={{ color: GRAY }}>
      <span className="h-px w-10 bg-current opacity-40" /><span>{label}</span>
    </div>
  );
}

export default function Empresas() {
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
    const active = "text-[#0a0a0a] font-medium";
    return (
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">
        <button onClick={() => setLang("pt")} className={lang === "pt" ? active : "hover:opacity-80"}>PT</button>
        <span className="opacity-30 mx-1">/</span>
        <button onClick={() => setLang("en")} className={lang === "en" ? active : "hover:opacity-80"}>EN</button>
      </div>
    );
  };

  const btn = "lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#0a0a0a] text-white font-semibold";
  const link = "inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] border-b-2 pb-1 hover:opacity-70";
  const sec = "border-t border-[#0a0a0a]/12";
  const h2 = "font-black uppercase tracking-[-0.04em] leading-[0.88] text-center md:text-left mx-auto md:mx-0";

  const Cards = ({ items }: { items: [string, string][] }) => (
    <div className="mt-16 grid md:grid-cols-3 gap-x-12 gap-y-12">
      {items.map(([h, b], i) => (
        <div key={h} className="border-t-2 border-[#0a0a0a] pt-6">
          <div className="font-mono text-[11px] tracking-[0.2em]" style={{ color: ACCENT }}>0{i + 1}</div>
          <div className="mt-3 text-2xl md:text-[28px] font-bold tracking-[-0.02em] leading-[1.05]" style={display}>{h}</div>
          <p className="mt-3 text-[15px] leading-relaxed text-[#0a0a0a]/60 max-w-[40ch]">{b}</p>
        </div>
      ))}
    </div>
  );

  return (
    <div className="relative min-h-screen bg-transparent text-[#0a0a0a] grain overflow-x-hidden" style={display}>
      <V3Ribbon />
      <style>{`html{scroll-behavior:smooth}::selection{background:${ACCENT};color:#0a0a0a}`}</style>

      <header className={"fixed top-0 left-0 right-0 z-40 px-6 md:px-12 py-4 flex items-center justify-between transition-colors duration-300 " + (scrolled ? "backdrop-blur-md bg-[#f1eee7]/85 border-b border-[#0a0a0a]/8" : "bg-transparent")}>
        <Link to="/" className="text-2xl md:text-3xl lowercase text-[#0a0a0a]" style={{ ...display, fontWeight: 800, letterSpacing: "-0.04em" }}>slippay<span style={{ color: ACCENT }}>.</span></Link>
        <nav className="flex items-center gap-5 text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/55">
          <Link to="/receber" className="hidden md:inline transition-opacity hover:opacity-70">{t.nav.receive}</Link>
          <a href="/x402-demo" className="hidden md:inline transition-opacity hover:opacity-70">{t.nav.api}</a>
          <span className="hidden md:inline"><LangToggle /></span>
          <Link to="/account" className="inline-flex items-center rounded-full px-5 py-2.5 bg-[#0a0a0a] text-white font-semibold hover:opacity-90">{t.nav.cta}</Link>
        </nav>
      </header>

      {/* HERO */}
      <section className="bg-[#f5f3ee] text-[#0a0a0a]">
        <div className="max-w-[960px] mx-auto px-6 pt-32 md:pt-44 pb-20 md:pb-28 flex flex-col items-center text-center">
          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 border border-[#0a0a0a]/15 font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55"><span className="w-1.5 h-1.5 rounded-full" style={{ background: ACCENT }} />{lang === "pt" ? "em breve · entre na lista" : "coming soon · join the list"}</span>
          <span className="mt-4 font-mono text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/45">{t.hero.eyebrow}</span>
          <h1 className="mt-7 font-black uppercase tracking-[-0.03em] leading-[0.88] text-[clamp(2.1rem,8vw,5.5rem)] max-w-[15ch]" style={display}>{t.hero.h1}</h1>
          <p className="mt-7 text-base md:text-xl text-[#0a0a0a]/65 max-w-[40ch] md:max-w-[50ch] leading-relaxed">{t.hero.sub}</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
            <a href="#lista" className={btn}>{t.hero.cta}</a>
            <a href="/x402-demo" className={link} style={{ borderColor: ACCENT, color: "#0a0a0a" }}>{t.hero.ctaApi}</a>
          </div>
          <span className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">{t.hero.note}</span>
        </div>
      </section>

      {/* PAIN */}
      <section className={sec}><div data-reveal className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-32">
        <Stamp label={t.pain.stamp} />
        <h2 className={`mt-10 ${h2} text-[clamp(2.25rem,7vw,4.75rem)] max-w-[18ch]`} style={display}>{t.pain.h}</h2>
        <Cards items={t.pain.items} />
      </div></section>

      {/* USE CASES */}
      <section className={sec}><div data-reveal className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-32">
        <Stamp label={t.use.stamp} />
        <h2 className={`mt-10 ${h2} text-[clamp(2.5rem,8vw,5.5rem)]`} style={display}>{t.use.h}</h2>
        <Cards items={t.use.items} />
      </div></section>

      {/* FEE */}
      <section className={sec}><div data-reveal className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-32">
        <Stamp label={t.fee.stamp} />
        <h2 className={`mt-10 ${h2} text-[clamp(2.25rem,7vw,4.75rem)]`} style={display}>{t.fee.h}</h2>
        <div className="mt-12 max-w-[640px] flex flex-col">
          {t.fee.rows.map(([who, rate, hot], i) => (
            <div key={i} className={"flex items-center justify-between py-5 border-t " + (hot ? "border-[#0a0a0a]" : "border-[#0a0a0a]/12")}>
              <span className={"text-lg md:text-2xl tracking-[-0.01em] " + (hot ? "font-bold" : "text-[#0a0a0a]/60")} style={display}>{who}</span>
              <span className={"font-mono text-xl md:text-3xl tabular-nums " + (hot ? "font-black" : "text-[#0a0a0a]/55")} style={hot ? { background: ACCENT, padding: "2px 10px", borderRadius: "8px" } : undefined}>{rate}</span>
            </div>
          ))}
        </div>
        <p className="mt-8 text-lg md:text-xl font-medium tracking-[-0.01em] max-w-[52ch]">{t.fee.foot}</p>
      </div></section>

      {/* API — inverted INK */}
      <section className="px-4 md:px-6 py-2"><div data-reveal className="bg-[#0a0a0a] text-[#f1eee7] rounded-[1.75rem] md:rounded-[2.5rem] max-w-[1200px] mx-auto px-6 md:px-14 py-24 md:py-36">
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#f1eee7]/40">
          <span className="h-px w-8 bg-[#f1eee7]/30" /><span>{t.api.stamp}</span>
        </div>
        <h2 className="mt-10 font-black uppercase tracking-[-0.04em] leading-[0.88] text-[clamp(2.25rem,7vw,5rem)] max-w-[16ch]" style={display}>{t.api.h}</h2>
        <p className="mt-8 text-lg md:text-2xl text-[#f1eee7]/70 leading-relaxed max-w-[54ch]">{t.api.body}</p>
        <ul className="mt-10 grid sm:grid-cols-2 gap-3 max-w-[640px]">
          {t.api.bullets.map((b) => (
            <li key={b} className="flex items-center gap-3 text-[15px] md:text-[17px] text-[#f1eee7]/85">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ACCENT }} />{b}
            </li>
          ))}
        </ul>
        <a href="/x402-demo" className="mt-10 lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#0a0a0a] text-white font-semibold">{t.api.cta}</a>
      </div></section>

      {/* PROOF */}
      <section className={sec}><div data-reveal className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-32">
        <Stamp label={t.proof.stamp} />
        <h2 className={`mt-10 ${h2} text-[clamp(2.5rem,8vw,5.5rem)]`} style={display}>{t.proof.h}</h2>
        <p className="mt-6 text-lg md:text-xl text-[#0a0a0a]/65 max-w-[52ch] mx-auto md:mx-0">{t.proof.lead}</p>
        <div className="mt-8 inline-flex items-center gap-2 rounded-full px-4 py-2 border border-[#0a0a0a]/15">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/55">{t.proof.tag}</span>
        </div>
        <div className="mt-10">
          <a href={xurl("contract", LIVE_CONTRACT)} target="_blank" rel="noreferrer" className={link} style={{ borderColor: ACCENT, color: "#0a0a0a" }}>{t.proof.contractBtn}</a>
        </div>
      </div></section>

      {/* CTA — waitlist */}
      <section id="lista" className={sec}><div className="max-w-[1200px] mx-auto px-6 md:px-12 py-28 md:py-40">
        <h2 className="font-black uppercase tracking-[-0.055em] leading-[0.82] text-[clamp(2.75rem,12vw,9rem)] text-center md:text-left" style={display}>{t.cta.h}</h2>
        <div className="mt-8 flex flex-col gap-1 text-xl md:text-2xl text-[#0a0a0a]/65 text-center md:text-left">{t.cta.lines.map((l) => <span key={l}>{l}</span>)}</div>
        <div className="mt-12 flex flex-col items-center md:items-start gap-5">
          <Waitlist source="empresas" lang={lang} />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#0a0a0a]/40">{t.cta.note}</span>
        </div>
        <div className="mt-20 font-mono text-[10px] uppercase tracking-[0.28em] text-[#0a0a0a]/30">{t.footer}</div>
      </div></section>
    </div>
  );
}
