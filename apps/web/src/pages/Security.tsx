// /security — the user-facing safety page ("is my money safe?"). Calm, bone,
// editorial. Distinct from /gate (the technical moat deep-dive): this answers the
// human question — non-custodial, you hold the key, fail-safe, public, verifiable.
// Bilingual (PT/EN, shares the landing's language choice).

import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { V3Ribbon } from "../components/V3Ribbon.tsx";

const display = { fontFamily: "'DM Sans', sans-serif" } as const;
const CONTRACT = "CCT3KJXRUO3HJJ2GLTW2MISSQVUEKOPUG3B4YQH75TCGKAOC4P6FIKUF";
const TX = "ede13fb6230334af91b2af1cfab92f86f8f44e8a7755acb57d92891d68a3e957";
const xc = (p: string, id: string) => `https://stellar.expert/explorer/public/${p}/${id}`;
type Lang = "pt" | "en";

const C = {
  en: {
    home: "Home", stamp: "security",
    h1a: "Is my money safe? ", h1acc: "Yes.",
    intro: "The simplest reason: we never hold it. Your money lives in a wallet only you control, opened by your biometrics. Not even SlipPay can move it — we automate payments, never custody them.",
    simpleTitle: "Why it's safe, in plain words.",
    simple: [
      ["🔑", "Only your finger opens it. The key is yours, on your device. Not even we can open it."],
      ["🏠", "The money sits in YOUR piggy bank, not our bank. We can't freeze it, block it, or move it."],
      ["🛑", "If a payment falls outside the rule you set, it locks instantly. There's no half-payment."],
      ["🔎", "Everything is recorded in a public place anyone can check. You don't have to trust us, you can look."],
    ] as [string, string][],
    techTitle: "The technical version.",
    props: [
      ["Non-custodial", "Funds stay in a wallet only you control. SlipPay has no unilateral access to your money, ever."],
      ["Rules enforced in the contract", "Spend limits, approved recipients and conditions live in the smart contract — not in our policy or a manual decision."],
      ["Fail-safe", "If a payment is outside your rules, it doesn't execute. There is no half-payment, no undefined in-between state."],
      ["Signed, never replayable", "Every authorization is cryptographically bound to one contract, one charge, once. It can't be replayed across subscriptions, contracts or chains."],
      ["Public & verifiable", "Every payment is a public, auditable transaction. Anyone can verify what happened, with no internal report to trust."],
    ] as [string, string][],
    gateTitle: "How it can pay on its own and still be safe.",
    gate: "The agent never decides — it executes inside your rules, and only after an on-chain integrity check passes. If something looks off, the payment is refused.",
    gateLink: "Read about the integrity gate →",
    honestTitle: "What we're still hardening (honest).",
    honest: "Today your account is bound to your device. Account recovery across devices (synced passkeys / guardians) is on the roadmap — until then, treat it like a device-held key.",
    proofTitle: "Verify it yourself.",
    proofTx: "A real payment →", proofContract: "The live contract →",
    cta: "Try it",
  },
  pt: {
    home: "Início", stamp: "segurança",
    h1a: "Meu dinheiro está seguro? ", h1acc: "Sim.",
    intro: "O motivo mais simples: a gente nunca segura. Seu dinheiro fica numa carteira que só você controla, aberta pela sua biometria. Nem o SlipPay move — a gente automatiza pagamento, nunca a custódia.",
    simpleTitle: "Por que é seguro, em palavras simples.",
    simple: [
      ["🔑", "Só o seu dedo abre. A chave é sua, fica no seu aparelho. Nem a gente abre."],
      ["🏠", "O dinheiro fica no SEU cofrinho, não no nosso banco. A gente não congela, não bloqueia, não move."],
      ["🛑", "Se um pagamento sair da regra que você definiu, ele trava na hora. Não existe meio pagamento."],
      ["🔎", "Tudo fica registrado num lugar público que qualquer um confere. Você não precisa confiar, pode olhar."],
    ] as [string, string][],
    techTitle: "A versão técnica.",
    props: [
      ["Non-custodial", "Os fundos ficam numa carteira que só você controla. O SlipPay não tem acesso unilateral ao seu dinheiro, nunca."],
      ["Regras no contrato", "Tetos de gasto, destinatários aprovados e condições vivem no smart contract — não na nossa política nem numa decisão manual."],
      ["Fail-safe", "Se um pagamento está fora das suas regras, ele não executa. Não existe meio pagamento, nem estado intermediário indefinido."],
      ["Assinado, sem replay", "Cada autorização é amarrada por criptografia a um contrato, uma cobrança, uma vez. Não dá pra replicar entre assinaturas, contratos ou redes."],
      ["Público e verificável", "Cada pagamento é uma transação pública e auditável. Qualquer um confere o que aconteceu, sem depender de relatório interno."],
    ] as [string, string][],
    gateTitle: "Como ele paga sozinho e ainda assim é seguro.",
    gate: "O agente nunca decide — ele executa dentro das suas regras, e só depois de passar por uma checagem de integridade on-chain. Se cheirar a problema, o pagamento é recusado.",
    gateLink: "Leia sobre o gate de integridade →",
    honestTitle: "O que ainda estamos endurecendo (honesto).",
    honest: "Hoje sua conta está ligada ao seu aparelho. Recuperação entre dispositivos (passkeys sincronizadas / guardiões) está no roadmap — até lá, trate como uma chave guardada no aparelho.",
    proofTitle: "Confere você mesmo.",
    proofTx: "Um pagamento real →", proofContract: "O contrato no ar →",
    cta: "Testar",
  },
} as const;

export default function Security() {
  const [lang, setLang] = useState<Lang>(() => {
    try { const s = localStorage.getItem("slippay.lang"); if (s === "pt" || s === "en") return s; } catch { /* */ }
    return (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("pt")) ? "pt" : "en";
  });
  useEffect(() => { try { localStorage.setItem("slippay.lang", lang); } catch { /* */ } }, [lang]);
  const t = C[lang];

  return (
    <div className="relative min-h-screen bg-transparent text-[#0a0a0a] grain overflow-x-hidden">
      <V3Ribbon />
      <header className="px-6 md:px-12 py-7 flex items-center justify-between border-b border-[#0a0a0a]/10">
        <Link to="/" className="text-xl font-bold tracking-[-0.06em] lowercase" style={display}>slippay<span className="text-[#2563eb]">.</span></Link>
        <div className="flex items-center gap-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">
            <button onClick={() => setLang("pt")} className={lang === "pt" ? "text-[#0a0a0a]" : "hover:opacity-80"}>PT</button>
            <span className="opacity-30 mx-1">/</span>
            <button onClick={() => setLang("en")} className={lang === "en" ? "text-[#0a0a0a]" : "hover:opacity-80"}>EN</button>
          </div>
          <Link to="/" className="text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]">{t.home}</Link>
        </div>
      </header>

      <main className="max-w-[920px] mx-auto px-6 md:px-12 pt-14 md:pt-24 pb-28">
        <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#0a0a0a]/45">
          <span className="text-[#0a0a0a]/70">001</span><span className="h-px w-8 bg-current opacity-40" /><span>{t.stamp}</span>
        </div>
        <h1 className="mt-10 font-bold uppercase tracking-[-0.05em] leading-[0.85] text-[clamp(2.5rem,9vw,6.5rem)]" style={display}>
          {t.h1a}<span className="text-[#6f6862]">{t.h1acc}</span>
        </h1>
        <p className="mt-10 text-xl md:text-2xl leading-relaxed max-w-[56ch] text-[#0a0a0a]/75">{t.intro}</p>

        {/* plain words first — everyone understands why it's safe */}
        <h2 className="mt-20 font-bold tracking-[-0.03em] text-[clamp(1.75rem,5vw,3rem)]" style={display}>{t.simpleTitle}</h2>
        <div className="mt-10 flex flex-col gap-7 max-w-[640px]">
          {t.simple.map(([, text], i) => (
            <div key={i} className="flex gap-4 items-start">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2563eb] shrink-0 mt-2.5" />
              <p className="text-lg md:text-xl leading-relaxed text-[#0a0a0a]/75">{text}</p>
            </div>
          ))}
        </div>

        {/* the technical version — depth for the skeptic / investor */}
        <h2 className="mt-24 font-mono text-[12px] uppercase tracking-[0.24em]" style={{ color: "#6f6862" }}>{t.techTitle}</h2>
        <div className="mt-8 flex flex-col gap-9">
          {t.props.map(([h, b], i) => (
            <div key={i} className="flex gap-5 md:gap-7 items-baseline border-t border-[#0a0a0a]/12 pt-7">
              <span className="font-mono text-[13px] text-[#6f6862] shrink-0 w-8">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <div className="text-2xl md:text-3xl font-semibold tracking-[-0.02em]" style={display}>{h}</div>
                <p className="mt-2 text-[16px] md:text-[17px] text-[#0a0a0a]/60 leading-relaxed max-w-[60ch]">{b}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-20 rounded-2xl bg-[#0a0a0a] text-[#f1eee7] p-8 md:p-12">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-[-0.02em]" style={display}>{t.gateTitle}</h2>
          <p className="mt-4 text-lg leading-relaxed max-w-[56ch] text-[#f1eee7]/70">{t.gate}</p>
          <Link to="/gate" className="mt-5 inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.18em] text-[#f1eee7]/80 border-b border-[#f1eee7]/30 hover:border-[#f1eee7] pb-1">{t.gateLink}</Link>
        </div>

        <h2 className="mt-20 text-xl md:text-2xl font-semibold tracking-[-0.02em] text-[#0a0a0a]/80" style={display}>{t.honestTitle}</h2>
        <p className="mt-4 text-[16px] md:text-[17px] leading-relaxed max-w-[58ch] text-[#0a0a0a]/55">{t.honest}</p>

        <h2 className="mt-20 text-2xl md:text-4xl font-semibold tracking-[-0.03em]" style={display}>{t.proofTitle}</h2>
        <div className="mt-6 flex flex-col gap-3">
          {[[t.proofTx, xc("tx", TX)], [t.proofContract, xc("contract", CONTRACT)]].map(([label, href]) => (
            <a key={href} href={href} target="_blank" rel="noreferrer" className="group flex items-baseline justify-between gap-4 border-t border-[#0a0a0a]/12 py-4 hover:bg-[#0a0a0a]/[0.02] transition-colors">
              <span className="text-[16px] md:text-lg text-[#0a0a0a]/85">{label}</span>
              <span className="font-mono text-[11px] text-[#6f6862] group-hover:underline shrink-0">↗</span>
            </a>
          ))}
        </div>

        <div className="mt-16">
          <Link to="/account" className="lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#0a0a0a] text-white">{t.cta}</Link>
        </div>
      </main>
    </div>
  );
}
