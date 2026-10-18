// Landing — Slippay identity system. DNA: sovereignty ("nobody freezes it, it's
// yours"). Helvetica-brutalist (Inter), monumental caps, mono index labels,
// #FDDA24 as the only accent, the blindfolded statue as the symbol. Bilingual.

import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { AccountDemo } from "../components/AccountDemo.tsx";
import { MandateDemo } from "../components/MandateDemo.tsx";
import { AskSlippay } from "../components/AskSlippay.tsx";
import { GoldWaves } from "../components/GoldWaves.tsx";
import { LiveProof } from "../components/LiveProof.tsx";

const display = { fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" } as const;
const GRAY = "#6f6862";
const ZK_MAINNET_TX = "4ffedf70df2c1c0665b04a03b689244e38d27cd8b27dd699399447228c0596ee";
const xurl = (p: string, id: string) => `https://stellar.expert/explorer/public/${p}/${id}`;
type Lang = "pt" | "en";

const COPY = {
  en: {
    nav: { security: "Security", pay: "Pay", receive: "Receive", cofrinho: "Cofrinho", login: "Login", tryFree: "Get started", gate: "The rules", live: "Live", investors: "Investors", manifesto: "Manifesto", builders: "Builders" },
    hero: { eyebrow: "stellar mainnet · zk proof · non-custodial", h1: "Your dollars, in Pix.", mark: "dollars", sub: "Send a Pix, get real dollars in about 10 seconds. They sit in your wallet, not a bank's. No one can freeze them.", cta: "Get started", note: "no card · 2 min · biometrics", liveTag: "live · mainnet", metrics: [["stellar mainnet", "live contract, verify now"], ["zk proof", "no data revealed"], ["~10s", "pix → usdc"]] as [string, string][] },
    yours: { n: "001", stamp: "yours", h: "Yours. For real.", items: [
      ["Only your fingerprint opens it", "Your face or fingerprint approves every move. No password, no recovery phrase to memorize. No one else."],
      ["Nobody freezes it", "The money lives in your wallet, never on a bank's balance sheet. It can't be blocked, held, or seized."],
      ["Real dollars, in hand", "A dollar balance that's yours. Withdraw, send, or spend anytime. Nothing is locked."],
    ] as [string, string][] },
    how: { n: "002", stamp: "how", h: "From Pix to dollars.", steps: [
      ["Send a Pix", "In reais, as always."],
      ["It becomes dollars", "Your reais become digital dollars in ~10s."],
      ["In your wallet", "Ready to use worldwide."],
    ] as [string, string][], foot: "~1.9% vs ~5% at a bank. The rest stays yours." },
    control: { n: "003", stamp: "control", h: "It pays on its own. Never against you.", body: "Set the rule once, like 'pay Maria, up to R$500 a month'. It executes on time. Anything above, or an address you never approved, locks on the spot.", gateLink: "How the rules work →" },
    business: { n: "006", stamp: "for business", h: "For your company.", body: "For businesses we build an AI agent that pays your bills, suppliers, subscriptions, payroll, on time and inside the limits you set. Built and tuned for your operation, not a template. It can't overspend, and it proves it didn't.", cta: "Get a custom solution →" },
    zk: { n: "004", stamp: "the proof", h: "It proves it behaved. Without showing your money.", body: "The agent can now prove, on Stellar, anyone can check, that every payment it made followed your rules, without revealing the amounts or who got paid. And only an authorized regulator, holding a key, can ever open the real numbers. Nobody else.", link: "See it live on mainnet →" },
    proof: { n: "005", stamp: "proof", h: "Proven on-chain.", lead: "Real, verifiable transfers. Not custody: it's yours, and you can check.", shots: ["your account · mainnet", "confirm with a touch", "verified on-chain receipt"], btnReal: "See a real payment ↗", btnContract: "The live contract ↗" },
    faq: { n: "007", stamp: "questions", h: "Before you ask.", items: [
      ["Can I withdraw in dollars?", "Yes. The balance is real dollars and it's yours. Send or move it to any wallet anytime. Nothing is locked."],
      ["I have a large amount. Can I use it?", "Yes. The money stays in your hands, never ours. For large deposits and withdrawals, conversion routes through a Banco Central–licensed partner, with identity verification and FX compliance."],
      ["Can it really not be frozen?", "Right. Slippay never holds your money, so there's nothing for us, or a bank, to freeze. Only your biometrics move it."],
    ] as [string, string][] },
    mcp: { n: "007", stamp: "for agents", h: "Your AI agent can pay. By itself.", body: "Slippay ships as an MCP server: any AI agent gets the payment rail as tools, pay, set a recurring subscription, and re-verify a spending-bound certificate offline. Non-custodial and backend-free: the agent holds its own wallet key, signs straight to Stellar. Slippay never holds funds, never signs.", cmd: "npx -y @slippay/mcp", cta: "Read the docs →", discover: "live at /.well-known/mcp" },
    cta: { n: "008", stamp: "start", h: "Start now.", lines: ["From a Pix to dollars in seconds.", "Yours. No one can freeze them."], btn: "Get started", note: "No card · 2 minutes · biometrics",
      footer: "slippay · your money, yours · live, real money" },
  },
  pt: {
    nav: { security: "Segurança", pay: "Pagar", receive: "Receber", cofrinho: "Cofrinho", login: "Entrar", tryFree: "Começar", gate: "As regras", live: "Ao vivo", investors: "Investidores", manifesto: "Manifesto", builders: "Builders" },
    hero: { eyebrow: "stellar mainnet · prova zk · não-custodial", h1: "Seus dólares, no Pix.", mark: "dólares", sub: "Faça um Pix e receba dólar de verdade em ~10s. Fica na sua carteira, não na de um banco. Ninguém congela.", cta: "Começar", note: "sem cartão · 2 min · biometria", liveTag: "ao vivo · mainnet", metrics: [["stellar mainnet", "contrato verificável agora"], ["prova zk", "sem revelar nada"], ["~10s", "pix → usdc"]] as [string, string][] },
    yours: { n: "001", stamp: "é seu", h: "É seu. De verdade.", items: [
      ["Só a sua digital abre", "O seu rosto ou digital aprova cada movimento. Sem senha e sem código pra decorar. Mais ninguém."],
      ["Ninguém congela", "O dinheiro fica na sua carteira, nunca no balanço de um banco. Não dá pra bloquear, segurar ou tomar."],
      ["Dólar de verdade, na mão", "Um saldo em dólar que é seu. Saque, envie ou gaste quando quiser. Nada fica preso."],
    ] as [string, string][] },
    how: { n: "002", stamp: "como", h: "Do Pix ao dólar.", steps: [
      ["Faça um Pix", "Em reais, como sempre."],
      ["Vira dólar", "Seu real vira dólar digital em ~10s."],
      ["Na sua carteira", "Pronto pra usar no mundo."],
    ] as [string, string][], foot: "~1,9% contra ~5% de banco. O resto fica com você." },
    control: { n: "003", stamp: "controle", h: "Paga sozinho. Nunca contra você.", body: "Você define a regra uma vez, tipo 'pode pagar a Maria, até R$500 por mês'. Ele executa no prazo. Qualquer valor acima, ou um endereço que você não autorizou, trava na hora.", gateLink: "Como as regras funcionam →" },
    business: { n: "006", stamp: "para empresas", h: "Para a sua empresa.", body: "Para empresas, a gente constrói um agente de IA que paga as suas contas (fornecedores, assinaturas, folha) no prazo e dentro dos limites que você define. Feito e ajustado pra sua operação, não um template. Ele não consegue gastar a mais, e prova que não gastou.", cta: "Quero uma solução personalizada →" },
    zk: { n: "004", stamp: "a prova", h: "Ele prova que se comportou. Sem mostrar o seu dinheiro.", body: "Agora o agente consegue provar, na Stellar, que qualquer um confere que cada pagamento seguiu as suas regras, sem revelar os valores nem pra quem pagou. E só um regulador autorizado, com uma chave, pode abrir os números de verdade. Mais ninguém.", link: "Ver no ar na mainnet →" },
    proof: { n: "005", stamp: "prova", h: "Provado on-chain.", lead: "Transferências reais, verificáveis. Não é custódia: é seu, e dá pra conferir.", shots: ["sua conta · mainnet", "confirmar com um toque", "comprovante verificado on-chain"], btnReal: "Ver um pagamento real ↗", btnContract: "O contrato no ar ↗" },
    faq: { n: "007", stamp: "perguntas", h: "Antes de perguntar.", items: [
      ["Posso sacar em dólar?", "Pode. O saldo é dólar de verdade e é seu. Envie ou leve pra qualquer carteira quando quiser. Nada fica preso."],
      ["Tenho um valor alto. Posso usar?", "Pode. O dinheiro fica na sua mão, nunca na nossa. Para entradas e saídas grandes, a conversão passa por um parceiro licenciado pelo Banco Central, com verificação de identidade e câmbio em conformidade."],
      ["Não congela mesmo?", "Isso. A Slippay nunca segura o seu dinheiro, então não há o que nós, ou um banco, congelar. Só a sua biometria move."],
    ] as [string, string][] },
    mcp: { n: "007", stamp: "para agentes", h: "Seu agente de IA paga. Sozinho.", body: "O Slippay vem como um servidor MCP: qualquer agente de IA ganha o rail de pagamento como ferramentas, pagar, criar uma assinatura recorrente e re-verificar um certificado de limite de gasto offline. Non-custodial e sem backend: o agente segura a própria chave da carteira e assina direto na Stellar. O Slippay nunca segura fundo, nunca assina.", cmd: "npx -y @slippay/mcp", cta: "Ler a documentação →", discover: "no ar em /.well-known/mcp" },
    cta: { n: "008", stamp: "comece", h: "Comece agora.", lines: ["De um Pix a dólar em segundos.", "Seu. Ninguém congela."], btn: "Começar", note: "Sem cartão · 2 minutos · biometria",
      footer: "slippay · seu dinheiro, seu · no ar, dinheiro de verdade" },
  },
} as const;

function Stamp({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] justify-center md:justify-start" style={{ color: GRAY }}>
      <span className="text-[#0a0a0a]/70">{n}</span><span className="h-px w-10 bg-current opacity-40" /><span>{label}</span>
    </div>
  );
}

export default function LandingV2() {
  const [menuOpen, setMenuOpen] = useState(false);
  // Transparent header over the full-bleed hero image; turns solid bone on scroll
  // so the dark nav text stays legible over the cream sections below.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [lang, setLang] = useState<Lang>(() => {
    try { const s = localStorage.getItem("slippay.lang"); if (s === "pt" || s === "en") return s; } catch { /* */ }
    return "pt";
  });
  useEffect(() => { try { localStorage.setItem("slippay.lang", lang); } catch { /* */ } }, [lang]);
  const t = COPY[lang];

  const NAV: [string, string][] = [[t.nav.receive, "/receber"], [t.nav.pay, "/pay"], [t.nav.login, "/account"]];
  const NAV_MORE: [string, string][] = [[t.nav.gate, "/gate"], [t.nav.live, "/cockpit"], [t.nav.investors, "/investors"], [t.nav.manifesto, "/manifesto"], [t.nav.builders, "/builders"]];

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
  const btn = "lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#FDDA24] text-[#0a0a0a] font-semibold";
  const sec = "border-t border-[#0a0a0a]/12";
  const h2 = "font-black uppercase tracking-[-0.04em] leading-[0.88] text-center md:text-left mx-auto md:mx-0";

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain overflow-x-hidden pb-56" style={display}>
      <style>{`html{scroll-behavior:smooth}::selection{background:#FDDA24;color:#0a0a0a}`}</style>

      {/* HEADER — transparent over the hero image, solid bone on scroll */}
      <header className={"fixed top-0 left-0 right-0 z-40 px-6 md:px-12 py-4 flex items-center justify-between transition-colors duration-300 " + (scrolled ? "backdrop-blur-md bg-[#f1eee7]/85 border-b border-[#0a0a0a]/8" : "bg-transparent")}>
        <Link to="/" className="text-2xl md:text-3xl lowercase text-[#0a0a0a]" style={{ ...display, fontWeight: 800, letterSpacing: "-0.04em" }}>slippay<span className="text-[#FDDA24]">.</span></Link>
        <nav className="flex items-center gap-5 text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/55">
          {NAV.map(([label, href]) => <Link key={href} to={href} className="hidden md:inline transition-opacity hover:opacity-70">{label}</Link>)}
          <a href="/zk/" className="hidden md:inline-flex items-center gap-1 transition-opacity hover:opacity-70 text-[#0a0a0a]"><span className="w-1.5 h-1.5 rounded-full bg-[#FDDA24]" />ZK</a>
          <Link to="/builders" className="hidden md:inline transition-opacity hover:opacity-70">Builders</Link>
          <a href="https://slippay.gitbook.io/slippay-docs" target="_blank" rel="noreferrer" className="hidden md:inline transition-opacity hover:opacity-70">Docs</a>
          <Link to="/comex" className="hidden md:inline transition-opacity hover:opacity-70">comex</Link>
          <span className="hidden md:inline"><LangToggle /></span>
          <Link to="/account" className="hidden md:inline-flex items-center rounded-full px-5 py-2.5 bg-[#FDDA24] text-[#0a0a0a] font-semibold hover:opacity-90">{t.nav.tryFree}</Link>
          <button onClick={() => setMenuOpen((v) => !v)} aria-label="Menu" className="md:hidden flex flex-col gap-[5px] p-1">
            <span className={`block w-6 h-[2px] transition-all bg-[#0a0a0a] ${menuOpen ? "translate-y-[7px] rotate-45" : ""}`} />
            <span className={`block w-6 h-[2px] transition-all bg-[#0a0a0a] ${menuOpen ? "opacity-0" : ""}`} />
            <span className={`block w-6 h-[2px] transition-all bg-[#0a0a0a] ${menuOpen ? "-translate-y-[7px] -rotate-45" : ""}`} />
          </button>
        </nav>
        {menuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 z-50 bg-[#f1eee7] border-y border-[#0a0a0a]/10 px-6 py-4 flex flex-col gap-1 text-[12px] uppercase tracking-[0.18em]">
            {NAV.map(([label, href]) => <Link key={href} to={href} onClick={() => setMenuOpen(false)} className="py-3 border-b border-[#0a0a0a]/8">{label}</Link>)}
            <a href="/zk/" onClick={() => setMenuOpen(false)} className="py-3 border-b border-[#0a0a0a]/8 inline-flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#FDDA24]" />ZK · prova sem revelar</a>
            <Link to="/builders" onClick={() => setMenuOpen(false)} className="py-3 border-b border-[#0a0a0a]/8">Builders</Link>
            <a href="https://slippay.gitbook.io/slippay-docs" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)} className="py-3 border-b border-[#0a0a0a]/8">Docs</a>
            <Link to="/comex" onClick={() => setMenuOpen(false)} className="py-3 border-b border-[#0a0a0a]/8">comex</Link>
            <div className="py-3 border-b border-[#0a0a0a]/8"><LangToggle /></div>
            <Link to="/account" onClick={() => setMenuOpen(false)} className="mt-2 inline-flex items-center justify-center rounded-full px-5 py-3 bg-[#FDDA24] text-[#0a0a0a] font-semibold">{t.nav.tryFree}</Link>
          </div>
        )}
      </header>

      {/* HERO — 2-col: text left, phone right. Stellar + ZK leads above the fold.
          GoldWaves drift behind the content (pointer-events off, z-0); content z-10. */}
      <section className="relative overflow-hidden bg-[#f5f3ee] text-[#0a0a0a]">
        <GoldWaves className="pointer-events-none absolute inset-0 z-0 opacity-60" />
        <div className="relative z-10 max-w-[1200px] mx-auto px-6 pt-32 md:pt-40 pb-16 md:pb-24 grid md:grid-cols-[1fr_auto] gap-10 md:gap-20 items-center">
          <div className="flex flex-col items-center md:items-start text-center md:text-left">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/55">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#FDDA24" }} />{t.hero.eyebrow}
            </span>
            <h1 className="mt-7 font-black uppercase tracking-[-0.04em] leading-[0.9] text-[clamp(2.6rem,9vw,6rem)] max-w-[13ch]" style={display}>{t.hero.h1}</h1>
            <p className="mt-6 text-lg md:text-xl text-[#0a0a0a]/70 max-w-[44ch] leading-relaxed">{t.hero.sub}</p>
            <div className="mt-8 grid grid-cols-3 gap-px bg-[#0a0a0a]/10 border border-[#0a0a0a]/10 rounded-xl overflow-hidden w-full max-w-[420px]">
              {t.hero.metrics.map(([k, v]) => (
                <div key={k} className="bg-[#f5f3ee] px-2 py-3 text-center">
                  <div className="font-mono text-[9px] uppercase tracking-[0.12em] font-semibold" style={{ color: "#FDDA24" }}>{k}</div>
                  <div className="mt-0.5 text-[10px] text-[#0a0a0a]/50 leading-tight">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center md:justify-start gap-x-6 gap-y-4">
              <Link
                to="/account"
                className={btn}
                onMouseMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px, ${(e.clientY - r.top - r.height / 2) * 0.32}px)`;
                }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
              >{t.hero.cta}</Link>
              <a href={xurl("tx", ZK_MAINNET_TX)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] border-b-2 pb-1 hover:opacity-70" style={{ borderColor: "#FDDA24", color: "#0a0a0a" }}>{lang === "pt" ? "ver prova on-chain ↗" : "see on-chain proof ↗"}</a>
            </div>
            <span className="mt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">{t.hero.note}</span>
          </div>
          <div className="mx-auto md:mx-0 max-w-[290px]">
            <AccountDemo lang={lang} />
          </div>
        </div>
        {/* Live mainnet pulse — real Horizon data, graceful when offline */}
        <div className="relative z-10 max-w-[1200px] mx-auto px-6 pb-16 md:pb-24">
          <LiveProof prominent lang={lang} />
        </div>
      </section>

      {/* 001 · ZK — proof first: most technically impressive, leads for judges */}
      <section className={sec}><div data-reveal className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-36">
        <Stamp n={t.zk.n} label={t.zk.stamp} />
        <h2 className={`mt-10 ${h2} text-[clamp(2.25rem,7vw,5rem)] max-w-[18ch]`} style={display}>{t.zk.h}</h2>
        <p className="mt-8 text-lg md:text-2xl text-[#0a0a0a]/70 leading-relaxed max-w-[54ch] mx-auto md:mx-0">{t.zk.body}</p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#0a0a0a]/[0.04] border border-[#0a0a0a]/10 px-4 py-3 font-mono text-[11px] text-[#0a0a0a]/50 select-all max-w-full overflow-x-auto">
          <span style={{ color: "#FDDA24" }}>tx</span><span className="truncate">{ZK_MAINNET_TX}</span>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <a href="/zk/" className="inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-[#0a0a0a] border-b-2 border-[#FDDA24] hover:opacity-70 pb-1">{lang === "pt" ? "Ver a demonstração →" : "See the demo →"}</a>
          <a href={xurl("tx", ZK_MAINNET_TX)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] border-b border-[#0a0a0a]/20 hover:border-[#0a0a0a] pb-1" style={{ color: GRAY }}>{t.zk.link}</a>
        </div>
      </div></section>

      {/* 002 · YOURS — sovereignty, the spine */}
      <section className={sec}><div data-reveal className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-36">
        <Stamp n={t.yours.n} label={t.yours.stamp} />
        <h2 className={`mt-10 ${h2} text-[clamp(2.5rem,8vw,5.5rem)] max-w-[16ch]`} style={display}>{t.yours.h}</h2>
        <div className="mt-16 grid md:grid-cols-3 gap-x-12 gap-y-12">
          {t.yours.items.map(([h, b], i) => (
            <div key={h} className="border-t-2 border-[#0a0a0a] pt-6">
              <div className="font-mono text-[11px] tracking-[0.2em] text-[#FDDA24]">0{i + 1}</div>
              <div className="mt-3 text-2xl md:text-[28px] font-bold tracking-[-0.02em] leading-[1.05]" style={display}>{h}</div>
              <p className="mt-3 text-[15px] leading-relaxed text-[#0a0a0a]/60 max-w-[40ch]">{b}</p>
            </div>
          ))}
        </div>
      </div></section>

      {/* 003 · HOW — Pix to dollars, the entry ticket, minimal */}
      <section className={sec}><div data-reveal className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-36">
        <Stamp n={t.how.n} label={t.how.stamp} />
        <h2 className={`mt-10 ${h2} text-[clamp(2.5rem,9vw,6rem)]`} style={display}>{t.how.h}</h2>
        <div className="mt-14 grid md:grid-cols-3 gap-px bg-[#0a0a0a]/12 border border-[#0a0a0a]/12 rounded-2xl overflow-hidden">
          {t.how.steps.map(([h, b], i) => (
            <div key={i} className="bg-[#f1eee7] p-7 md:p-9">
              <span className="font-mono text-[12px]" style={{ color: GRAY }}>{String(i + 1).padStart(2, "0")}</span>
              <div className="mt-4 text-2xl md:text-3xl font-bold tracking-[-0.02em]" style={display}>{h}</div>
              <p className="mt-2 text-[15px] text-[#0a0a0a]/60">{b}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-lg md:text-xl font-medium tracking-[-0.01em]">{t.how.foot}</p>
      </div></section>

      {/* 004 · CONTROL — it pays on its own, never breaks your rule */}
      <section className={sec}><div data-reveal className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-36 grid md:grid-cols-2 gap-12 md:gap-16 items-center">
        <div>
          <Stamp n={t.control.n} label={t.control.stamp} />
          <h2 className={`mt-10 ${h2} text-[clamp(2.25rem,6.5vw,4.5rem)] max-w-[15ch]`} style={display}>{t.control.h}</h2>
          <p className="mt-6 text-lg md:text-xl text-[#0a0a0a]/70 leading-relaxed max-w-[46ch]">{t.control.body}</p>
          <Link to="/gate" className="mt-8 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] border-b border-[#0a0a0a]/20 hover:border-[#0a0a0a] pb-1" style={{ color: GRAY }}>{t.control.gateLink}</Link>
        </div>
        <div className="w-full max-w-[440px] mx-auto md:justify-self-end"><MandateDemo lang={lang} /></div>
      </div></section>

      {/* 006 · BUSINESS — for companies: a custom agent that pays your bills */}
      <section className="px-4 md:px-6 py-2"><div data-reveal className="bg-[#0a0a0a] text-[#f1eee7] rounded-[1.75rem] md:rounded-[2.5rem] max-w-[1200px] mx-auto px-6 md:px-14 py-24 md:py-36">
        <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#f1eee7]/40">
          <span className="text-[#FDDA24]">{t.business.n}</span><span className="h-px w-8 bg-[#f1eee7]/30" /><span>{t.business.stamp}</span>
        </div>
        <h2 className="mt-10 font-black uppercase tracking-[-0.04em] leading-[0.88] text-[clamp(2.5rem,8vw,5.5rem)] max-w-[15ch]" style={display}>{t.business.h}</h2>
        <p className="mt-8 text-lg md:text-2xl text-[#f1eee7]/70 leading-relaxed max-w-[52ch]">{t.business.body}</p>
        <Link to="/builders" className="mt-10 lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#FDDA24] text-[#0a0a0a] font-semibold">{t.business.cta}</Link>
      </div></section>

      {/* FAQ — three objections that block the first deposit */}
      <section className={sec}><div data-reveal className="max-w-[900px] mx-auto px-6 md:px-12 py-24 md:py-36">
        <Stamp n={t.faq.n} label={t.faq.stamp} />
        <h2 className={`mt-10 ${h2} text-[clamp(2.25rem,7vw,4.5rem)]`} style={display}>{t.faq.h}</h2>
        <div className="mt-12 flex flex-col">
          {t.faq.items.map(([q, a], i) => (
            <div key={i} className="border-t border-[#0a0a0a]/12 py-7">
              <div className="text-xl md:text-2xl font-bold tracking-[-0.02em]" style={display}>{q}</div>
              <p className="mt-2 text-[16px] leading-relaxed text-[#0a0a0a]/60 max-w-[60ch]">{a}</p>
            </div>
          ))}
        </div>
      </div></section>

      {/* 007 · MCP — the agent rail, last section before the CTA */}
      <section className="px-4 md:px-6 py-2"><div data-reveal className="bg-[#0a0a0a] text-[#f1eee7] rounded-[1.75rem] md:rounded-[2.5rem] max-w-[1200px] mx-auto px-6 md:px-14 py-24 md:py-36">
        <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#f1eee7]/40">
          <span className="text-[#FDDA24]">{t.mcp.n}</span><span className="h-px w-8 bg-[#f1eee7]/30" /><span>{t.mcp.stamp}</span>
        </div>
        <h2 className="mt-10 font-black uppercase tracking-[-0.04em] leading-[0.88] text-[clamp(2.5rem,8vw,5.5rem)] max-w-[15ch]" style={display}>{t.mcp.h}</h2>
        <p className="mt-8 text-lg md:text-2xl text-[#f1eee7]/70 leading-relaxed max-w-[56ch]">{t.mcp.body}</p>
        <div className="mt-10 inline-flex items-center gap-3 rounded-xl bg-[#f1eee7]/[0.06] border border-[#f1eee7]/15 px-5 py-3.5 font-mono text-[13px] md:text-[15px]">
          <span className="text-[#FDDA24]">$</span><span className="text-[#f1eee7]/90 select-all">{t.mcp.cmd}</span>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3">
          <a href="https://slippay.gitbook.io/slippay-docs" target="_blank" rel="noreferrer" className="lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#FDDA24] text-[#0a0a0a] font-semibold">{t.mcp.cta}</a>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#f1eee7]/40 inline-flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#FDDA24] animate-pulse" />{t.mcp.discover}</span>
        </div>
      </div></section>

      {/* 008 · CTA */}
      <section className={sec}><div className="max-w-[1200px] mx-auto px-6 md:px-12 py-28 md:py-44">
        <Stamp n={t.cta.n} label={t.cta.stamp} />
        <h2 className="mt-10 font-black uppercase tracking-[-0.055em] leading-[0.8] text-[clamp(3.5rem,16vw,12rem)] text-center md:text-left" style={display}>{t.cta.h}</h2>
        <div className="mt-8 flex flex-col gap-1 text-xl md:text-2xl text-[#0a0a0a]/65 text-center md:text-left">{t.cta.lines.map((l) => <span key={l}>{l}</span>)}</div>
        <div className="mt-12 flex flex-wrap items-center gap-6 justify-center md:justify-start"><Link to="/account" className={btn}>{t.cta.btn}</Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#0a0a0a]/40">{t.cta.note}</span>
        </div>

        <div className="mt-16 flex flex-wrap gap-x-6 gap-y-2 text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/45">
          {NAV_MORE.map(([label, href]) => <Link key={href} to={href} className="hover:text-[#0a0a0a]">{label}</Link>)}
        </div>
        <div className="mt-6 font-mono text-[10px] uppercase tracking-[0.28em] text-[#0a0a0a]/30">{t.cta.footer}</div>
      </div></section>
      <AskSlippay />
    </div>
  );
}
