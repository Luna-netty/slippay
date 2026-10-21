// BusinessLanding — Slippay Comex · premium on-brand page.
// Design language mirrors LandingV2: bone bg, ink text, #FDDA24 accent,
// Inter display font, grain texture, monumental uppercase headlines.

import { Link } from "react-router-dom";
import { useEffect } from "react";
import { AskSlippay } from "../../components/AskSlippay.tsx";

const display = { fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" } as const;
const GRAY = "#6f6862";

const btn =
  "lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#FDDA24] text-[#0a0a0a] font-semibold";
const sec = "border-t border-[#0a0a0a]/12";

const PROPS: [string, string, string][] = [
  ["01", "Conta corporativa", "a empresa é dona das chaves"],
  ["02", "Câmbio R$↔USD", "via parceiro licenciado pelo Banco Central"],
  ["03", "Envie e receba dólares", "USDC liquidado em segundos"],
  ["04", "Dólar parado rende", "variável, sem garantia de retorno"],
];

function Stamp({ n, label }: { n: string; label: string }) {
  return (
    <div
      className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em]"
      style={{ color: GRAY }}
    >
      <span className="text-[#0a0a0a]/70">{n}</span>
      <span className="h-px w-10 bg-current opacity-40" />
      <span>{label}</span>
    </div>
  );
}

export default function BusinessLanding() {
  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    root.classList.add("js-reveal");
    const io = new IntersectionObserver(
      (ents) => {
        for (const e of ents)
          if (e.isIntersecting) {
            e.target.classList.add("reveal-in");
            io.unobserve(e.target);
          }
      },
      { rootMargin: "-8% 0px -8% 0px", threshold: 0.06 }
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      root.classList.remove("js-reveal");
    };
  }, []);

  return (
    <div
      className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain overflow-x-hidden"
      style={display}
    >
      <style>{`html{scroll-behavior:smooth}::selection{background:#FDDA24;color:#0a0a0a}`}</style>

      {/* HEADER */}
      <header className="px-6 md:px-12 py-4 flex items-center justify-between border-b border-[#0a0a0a]/8 bg-[#f1eee7] grain sticky top-0 z-40">
        <Link
          to="/"
          className="text-2xl md:text-3xl lowercase text-[#0a0a0a]"
          style={{ ...display, fontWeight: 800, letterSpacing: "-0.04em" }}
        >
          slippay<span className="text-[#FDDA24]">.</span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="font-mono text-[9px] uppercase tracking-[0.24em] bg-[#FDDA24] text-[#0a0a0a] px-3 py-1.5 font-semibold">
            EM PILOTO PRIVADO
          </span>
          <Link
            to="/"
            className="hidden md:inline font-mono text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/50 hover:text-[#0a0a0a] transition-colors"
          >
            ← voltar
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="bg-[#f5f3ee]">
        <div className="max-w-[1100px] mx-auto px-6 md:px-12 pt-24 md:pt-36 pb-20 md:pb-32">
          <div data-reveal className="flex flex-col items-start">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#0a0a0a]/50 mb-8">
              SLIPPAY · COMEX
            </span>
            <h1
              className="font-black uppercase tracking-[-0.04em] leading-[0.88] text-[clamp(2.6rem,9vw,6rem)] max-w-[16ch]"
              style={display}
            >
              Tesouraria em dólar para importação e exportação
            </h1>
            <p className="mt-8 text-lg md:text-xl text-[#0a0a0a]/65 max-w-[48ch] leading-relaxed">
              Conta da empresa, câmbio R$↔USD e rendimento — sem custódia. Sua empresa controla, ninguém mais.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
              <a
                href="mailto:comex@slippay.cc?subject=Slippay%20comex%20—%20acesso"
                className={btn}
                onMouseMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px,${(e.clientY - r.top - r.height / 2) * 0.32}px)`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "";
                }}
              >
                Solicitar acesso
              </a>
              <Link
                to="/"
                className="md:hidden font-mono text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/50 hover:text-[#0a0a0a] transition-colors"
              >
                ← voltar
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* VALUE PROPS — 01/02/03/04 editorial grid */}
      <section className={sec}>
        <div data-reveal className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-36">
          <Stamp n="001" label="o que é" />
          <h2
            className="mt-10 font-black uppercase tracking-[-0.04em] leading-[0.88] text-[clamp(2rem,6vw,4rem)] max-w-[18ch]"
            style={display}
          >
            Tudo que a tesouraria precisa.
          </h2>
          <div className="mt-16 grid md:grid-cols-2 gap-px bg-[#0a0a0a]/10 border border-[#0a0a0a]/10 rounded-2xl overflow-hidden">
            {PROPS.map(([n, title, sub]) => (
              <div key={n} className="bg-[#f1eee7] p-8 md:p-10 flex flex-col gap-3">
                <span className="font-mono text-[13px] font-semibold" style={{ color: "#FDDA24" }}>
                  {n}
                </span>
                <div
                  className="text-2xl md:text-[28px] font-bold tracking-[-0.025em] leading-[1.05]"
                  style={display}
                >
                  {title}
                </div>
                <p className="text-[15px] leading-relaxed text-[#0a0a0a]/60">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ARCHITECTURE — dark band, non-custodial proof */}
      <section className="px-4 md:px-6 py-2">
        <div
          data-reveal
          className="bg-[#0a0a0a] text-[#f1eee7] rounded-[1.75rem] md:rounded-[2.5rem] max-w-[1200px] mx-auto px-6 md:px-14 py-24 md:py-36"
        >
          <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#f1eee7]/40">
            <span className="text-[#FDDA24]">002</span>
            <span className="h-px w-8 bg-[#f1eee7]/30" />
            <span>arquitetura</span>
          </div>
          <h2
            className="mt-10 font-black uppercase tracking-[-0.04em] leading-[0.88] text-[clamp(2.5rem,8vw,5.5rem)] max-w-[14ch]"
            style={display}
          >
            A empresa é dona das chaves. Sempre.
          </h2>
          <p className="mt-8 text-lg md:text-2xl text-[#f1eee7]/65 leading-relaxed max-w-[52ch]">
            Non-custodial significa que a Slippay nunca guarda o seu dinheiro. As chaves da carteira
            corporativa ficam com a empresa — câmbio e liquidação passam por parceiro licenciado pelo
            Banco Central. Nenhum banco intermediário, nenhuma burocracia de semanas.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-px bg-[#f1eee7]/10 border border-[#f1eee7]/10 rounded-xl overflow-hidden max-w-[560px]">
            {(
              [
                ["USDC", "moeda de liquidação"],
                ["Base", "rede de liquidação"],
                ["BCB", "câmbio licenciado"],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="bg-[#0a0a0a] px-4 py-5 text-center">
                <div
                  className="font-mono text-[10px] uppercase tracking-[0.14em] font-semibold"
                  style={{ color: "#FDDA24" }}
                >
                  {k}
                </div>
                <div className="mt-1 text-[11px] text-[#f1eee7]/45 leading-tight">{v}</div>
              </div>
            ))}
          </div>
          <a
            href="mailto:comex@slippay.cc?subject=Slippay%20comex%20—%20acesso"
            className="mt-12 lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#FDDA24] text-[#0a0a0a] font-semibold"
          >
            Solicitar acesso
          </a>
        </div>
      </section>

      {/* CLOSING BAND */}
      <section className={sec}>
        <div className="max-w-[1100px] mx-auto px-6 md:px-12 py-28 md:py-44">
          <Stamp n="003" label="acesso" />
          <h2
            className="mt-10 font-black uppercase tracking-[-0.055em] leading-[0.8] text-[clamp(3rem,14vw,10rem)]"
            style={display}
          >
            Começar.
          </h2>
          <p className="mt-6 text-lg md:text-xl text-[#0a0a0a]/60 max-w-[44ch] leading-relaxed">
            Piloto privado. Entre em contato para avaliação e acesso antecipado.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-6">
            <a
              href="mailto:comex@slippay.cc?subject=Slippay%20comex%20—%20acesso"
              className={btn}
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                e.currentTarget.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px,${(e.clientY - r.top - r.height / 2) * 0.32}px)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "";
              }}
            >
              Solicitar acesso
            </a>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/40">
              comex@slippay.cc
            </span>
          </div>

          {/* Footer */}
          <div className="mt-16 pt-8 border-t border-[#0a0a0a]/10 font-mono text-[10px] uppercase tracking-[0.28em] text-[#0a0a0a]/30">
            non-custodial · câmbio via parceiro licenciado · USDC
          </div>
        </div>
      </section>
      <AskSlippay />
    </div>
  );
}
