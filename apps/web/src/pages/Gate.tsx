// /gate — the integrity gate, in detail. The moat: pay only when it's proven
// safe (verify-then-pay), live on mainnet. Bilingual (PT/EN, shares the landing's
// language choice). Premium dark editorial register.

import { Link } from "react-router-dom";
import { useEffect, useState } from "react";

const display = { fontFamily: "'DM Sans', sans-serif" } as const;
const CONTRACT = "CCT3KJXRUO3HJJ2GLTW2MISSQVUEKOPUG3B4YQH75TCGKAOC4P6FIKUF";
const TX_ATTESTED = "ede13fb6230334af91b2af1cfab92f86f8f44e8a7755acb57d92891d68a3e957";
const TX_AUTONOMOUS = "b030230e81b0fa40eb899b03840884222e0ce7e4fba43f5976afe9f5e939597d";
const xc = (p: string, id: string) => `https://stellar.expert/explorer/public/${p}/${id}`;
type Lang = "pt" | "en";

const C = {
  en: {
    home: "Home", stamp: "the integrity gate",
    h1a: "Pay only when it's ", h1acc: "proven safe.",
    intro: "Every other agent rail settles on authorization alone. If the agent is approved, the money moves — even if that agent has been compromised. SlipPay refuses. A payment settles only when a fresh, valid integrity attestation passes, verified on-chain. No proof, no payment.",
    propsTitle: "Three properties that make it a moat, not a feature.",
    props: [
      ["Inescapable", "Once a subscription binds an attester, the ungated path refuses on-chain. There is no back door — we proved it: a plain charge on a gated subscription is rejected by the contract itself."],
      ["Bound", "The attestation is signed over the contract's domain, the subscription id, a single-use counter, and a freshness window. It can't be replayed across subscriptions, contracts or chains, and it can't be reused for the next charge."],
      ["Autonomous", "A scheduler produces the attestation and charges on a cadence, no human in the loop. The agent pays itself — but only ever through the gate."],
    ] as [string, string][],
    proofTitle: "Live on mainnet. Verify it yourself.",
    proofAttested: "An attested charge that settled →",
    proofAuto: "The scheduler charging itself, gated →",
    proofContract: "The live contract →",
    whyTitle: "Why nobody else has this.",
    why: "The research frontier is racing toward exactly this — \"verify-then-pay\", binding payment to proof of correct execution (A402, TessPay, 2026). Their designs lean on trusted hardware (TEE) and remain proposals. SlipPay does it in a public smart contract, no special hardware, live.",
    honestTitle: "What it does and doesn't guarantee.",
    honest: "The gate guarantees no settlement without a fresh, valid, bound attestation. It does not detect compromise itself — that is the attester's job. The contract makes the attestation inescapable, not optional. That distinction is the whole point.",
    cta: "Try it", seeContract: "See the contract ↗",
  },
  pt: {
    home: "Início", stamp: "o gate de integridade",
    h1a: "Só paga quando é ", h1acc: "provado seguro.",
    intro: "Todo outro trilho de agente liquida só com autorização. Se o agente foi aprovado, o dinheiro sai — mesmo que esse agente esteja comprometido. O SlipPay recusa. Um pagamento só liquida quando uma atestação de integridade fresca e válida passa, verificada on-chain. Sem prova, sem pagamento.",
    propsTitle: "Três propriedades que fazem disso um fosso, não uma feature.",
    props: [
      ["Inescapável", "Quando uma assinatura liga um atestador, o caminho sem gate recusa on-chain. Não existe porta dos fundos — provamos: uma cobrança simples numa assinatura com gate é recusada pelo próprio contrato."],
      ["Amarrado", "A atestação é assinada sobre o domínio do contrato, o id da assinatura, um contador de uso único e uma janela de validade. Não dá pra replicar entre assinaturas, contratos ou redes, nem reusar na próxima cobrança."],
      ["Autônomo", "Um scheduler produz a atestação e cobra na cadência, sem humano no meio. O agente se cobra sozinho — mas sempre passando pelo gate."],
    ] as [string, string][],
    proofTitle: "No ar na mainnet. Confere você mesmo.",
    proofAttested: "Uma cobrança atestada que liquidou →",
    proofAuto: "O scheduler se cobrando, com gate →",
    proofContract: "O contrato no ar →",
    whyTitle: "Por que ninguém mais tem isso.",
    why: "A fronteira da pesquisa corre exatamente atrás disso — \"verify-then-pay\", amarrar o pagamento à prova de execução correta (A402, TessPay, 2026). Os desenhos deles dependem de hardware confiável (TEE) e seguem como propostas. O SlipPay faz num smart contract público, sem hardware especial, ao vivo.",
    honestTitle: "O que garante e o que não garante.",
    honest: "O gate garante que não há liquidação sem uma atestação fresca, válida e amarrada. Ele não detecta o comprometimento sozinho — isso é trabalho do atestador. O contrato torna a atestação inescapável, não opcional. Essa distinção é o ponto inteiro.",
    cta: "Testar", seeContract: "Ver o contrato ↗",
  },
} as const;

export default function Gate() {
  const [lang, setLang] = useState<Lang>(() => {
    try { const s = localStorage.getItem("slippay.lang"); if (s === "pt" || s === "en") return s; } catch { /* */ }
    return (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("pt")) ? "pt" : "en";
  });
  useEffect(() => { try { localStorage.setItem("slippay.lang", lang); } catch { /* */ } }, [lang]);
  const t = C[lang];

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] overflow-x-hidden">
      <header className="px-6 md:px-12 py-7 flex items-center justify-between border-b border-[#0a0a0a]/10">
        <Link to="/" className="text-xl font-bold tracking-[-0.06em] lowercase" style={display}>slippay<span className="text-[#FDDA24]">.</span></Link>
        <div className="flex items-center gap-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/50">
            <button onClick={() => setLang("pt")} className={lang === "pt" ? "text-[#0a0a0a]" : "hover:opacity-80"}>PT</button>
            <span className="opacity-30 mx-1">/</span>
            <button onClick={() => setLang("en")} className={lang === "en" ? "text-[#0a0a0a]" : "hover:opacity-80"}>EN</button>
          </div>
          <Link to="/" className="text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]">{t.home}</Link>
        </div>
      </header>

      <main className="max-w-[920px] mx-auto px-6 md:px-12 pt-14 md:pt-24 pb-28">
        <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#6f6862]">
          <span className="text-[#0a0a0a]/70">001</span><span className="h-px w-8 bg-current opacity-40" /><span>{t.stamp}</span>
        </div>
        <h1 className="mt-10 font-bold uppercase tracking-[-0.05em] leading-[0.85] text-[clamp(2.75rem,10vw,7rem)]" style={display}>
          {t.h1a}<span className="text-[#6f6862]">{t.h1acc}</span>
        </h1>
        <p className="mt-10 text-xl md:text-2xl leading-relaxed max-w-[58ch] text-[#0a0a0a]/65">{t.intro}</p>

        {/* three properties */}
        <h2 className="mt-24 text-2xl md:text-4xl font-semibold tracking-[-0.03em] max-w-[24ch]" style={display}>{t.propsTitle}</h2>
        <div className="mt-12 flex flex-col gap-10">
          {t.props.map(([h, b], i) => (
            <div key={i} className="flex gap-5 md:gap-7 items-baseline border-t border-[#0a0a0a]/12 pt-8">
              <span className="font-mono text-[13px] text-[#6f6862] shrink-0 w-8">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <div className="text-2xl md:text-3xl font-semibold tracking-[-0.02em]" style={display}>{h}</div>
                <p className="mt-2 text-[16px] md:text-[17px] text-[#0a0a0a]/60 leading-relaxed max-w-[60ch]">{b}</p>
              </div>
            </div>
          ))}
        </div>

        {/* live proof */}
        <h2 className="mt-24 text-2xl md:text-4xl font-semibold tracking-[-0.03em]" style={display}>{t.proofTitle}</h2>
        <div className="mt-8 flex flex-col gap-3">
          {[[t.proofAttested, xc("tx", TX_ATTESTED)], [t.proofAuto, xc("tx", TX_AUTONOMOUS)], [t.proofContract, xc("contract", CONTRACT)]].map(([label, href]) => (
            <a key={href} href={href} target="_blank" rel="noreferrer" className="group flex items-baseline justify-between gap-4 border-t border-[#0a0a0a]/12 py-4 hover:bg-[#0a0a0a]/[0.03] transition-colors">
              <span className="text-[16px] md:text-lg text-[#0a0a0a]/85">{label}</span>
              <span className="font-mono text-[11px] text-[#6f6862] group-hover:underline shrink-0">↗</span>
            </a>
          ))}
        </div>

        {/* why nobody else */}
        <h2 className="mt-24 text-2xl md:text-4xl font-semibold tracking-[-0.03em] text-[#6f6862]" style={display}>{t.whyTitle}</h2>
        <p className="mt-6 text-xl leading-relaxed max-w-[58ch] text-[#0a0a0a]/65">{t.why}</p>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] text-[#0a0a0a]/45">
          <a href="https://arxiv.org/abs/2603.01179" target="_blank" rel="noreferrer" className="hover:text-[#6f6862] underline underline-offset-4">A402 · 2603.01179</a>
          <a href="https://arxiv.org/html/2602.00213" target="_blank" rel="noreferrer" className="hover:text-[#6f6862] underline underline-offset-4">TessPay · 2602.00213</a>
        </div>

        {/* honest */}
        <h2 className="mt-24 text-xl md:text-2xl font-semibold tracking-[-0.02em] text-[#0a0a0a]/80" style={display}>{t.honestTitle}</h2>
        <p className="mt-4 text-[16px] md:text-[17px] leading-relaxed max-w-[58ch] text-[#0a0a0a]/55">{t.honest}</p>

        <div className="mt-20 flex flex-wrap items-center gap-7">
          <Link to="/account" className="lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#FDDA24] text-[#0a0a0a]">{t.cta}</Link>
          <a href={xc("contract", CONTRACT)} target="_blank" rel="noreferrer" className="text-[12px] uppercase tracking-[0.18em] text-[#6f6862] hover:text-[#0a0a0a] border-b border-[#0a0a0a]/20 pb-1">{t.seeContract}</a>
        </div>
      </main>
    </div>
  );
}
