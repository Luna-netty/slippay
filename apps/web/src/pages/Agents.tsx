// Agents (Narrativa B) — the builder / investor / Stellar-ecosystem surface.
// Split out of the human landing so the dollar-account story (A) stays zero-tech
// and converts, while the technical credibility lives here for people who came
// for x402 / agents / on-chain proof and will explore on their own.
//
// Order is deliberate: LEAD with the verifiable mainnet artifacts (proof, not
// promise), then the machine-proven agent spend-limit, then the x402 backing.
// Framing is WITH Stellar's passkey primitive — never "first biometric payment".

import { Link } from "react-router-dom";
import { Logo } from "../components/Logo.tsx";
import { Reveal } from "../components/Reveal.tsx";
import { X402Carousel } from "../components/X402Carousel.tsx";
import { useLang } from "../lib/lang.ts";
import { homeCopy } from "../copy/home.tsx";
import { V3Ribbon } from "../components/V3Ribbon.tsx";

const MAINNET_CONTRACT = "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN";
const MAINNET_TX = "05ae429b926d94770166e3425c77210260d2db0083fa81053059612775e510be";
const MAINNET_BIO = "d9a7d17a18719ece53535d51423b8951f37b163e170a7bea2cb4d9588471ec31";

export default function Agents() {
  const [lang, setLang] = useLang();
  const t = homeCopy[lang];

  return (
    <div className="min-h-screen relative bg-transparent text-[#0a0a0a] grain overflow-x-hidden">
      <V3Ribbon />
      {/* header — simple, ink-on-bone (no hero-aware scroll behavior needed) */}
      <header className="sticky top-0 z-30 bg-[#f1eee7]/85 backdrop-blur-md border-b border-[#0a0a0a]/10">
        <div className="max-w-[1400px] mx-auto px-5 md:px-10 py-4 md:py-5 flex items-center justify-between">
          <Link to="/" aria-label="Slippay — início"><Logo variant="ink" /></Link>
          <nav className="flex items-center gap-4 md:gap-7 text-[10px] uppercase tracking-[0.22em]">
            <Link to="/" className="hover:opacity-60 transition-opacity">{t.agents.back}</Link>
            <Link to="/x402-demo" className="hidden sm:inline hover:opacity-60 transition-opacity">x402 demo</Link>
            <Link to="/login" className="hidden sm:inline hover:opacity-60 transition-opacity">{t.nav.login}</Link>
            <button
              onClick={() => setLang(lang === "pt" ? "en" : "pt")}
              className="opacity-60 hover:opacity-100 transition-opacity tabular-nums"
              aria-label="toggle language"
            >{lang === "pt" ? "EN" : "PT"}</button>
            <Link to="/signup"
              className="lift bg-[#0a0a0a] text-white px-4 py-2 hover:bg-[#a8d949] flex items-center gap-2 font-medium">
              <span className="inline-block w-1 h-1 bg-[#0a0a0a]" />{t.nav.signup}
            </Link>
          </nav>
        </div>
      </header>

      {/* HERO — agent payments, built on Stellar's passkey primitive, honest stage */}
      <Reveal as="section" className="max-w-[1400px] mx-auto px-5 md:px-12 pt-16 md:pt-28 pb-14 md:pb-20 relative">
        <div aria-hidden className="pointer-events-none absolute -top-10 left-0 w-[70%] h-[120%] -z-0 animate-[aurora-drift_11s_ease-in-out_infinite]"
          style={{ background: "radial-gradient(45% 45% at 30% 30%, rgba(253,218,36,0.18), transparent 70%)", filter: "blur(6px)" }} />
        <div className="relative">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 font-mono mb-6">
            <span className="inline-block w-2 h-2 bg-[#2563eb]" /> {t.agents.badge}
          </div>
          <h1 className="title-grad text-[10vw] sm:text-[7vw] md:text-[4.6vw] font-medium leading-[1.02] tracking-[-0.04em] max-w-[18ch]">
            {t.agents.h1}
          </h1>
          <p className="mt-7 md:mt-9 text-[16px] md:text-xl leading-[1.55] text-[#0a0a0a]/80 max-w-[62ch]">
            {t.agents.sub}
          </p>
        </div>
      </Reveal>

      {/* 1 · LEAD — the verifiable mainnet artifacts. Proof, not promise. */}
      <Reveal as="section" className="border-t border-[#0a0a0a]/15 bg-[#0a0a0a] text-[#f1eee7]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-12 py-16 md:py-24">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#2563eb] mb-6 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 bg-[#2563eb] animate-pulse" /> {t.agents.liveLabel}
          </div>
          <p className="text-base md:text-lg text-[#f1eee7]/80 leading-relaxed max-w-[68ch]">{t.status.mainnetBody}</p>
          <div className="mt-7 grid sm:grid-cols-3 gap-px bg-[#f1eee7]/15 border border-[#f1eee7]/15 overflow-hidden max-w-[1000px]">
            <a href={`https://stellar.expert/explorer/public/contract/${MAINNET_CONTRACT}`} target="_blank" rel="noopener noreferrer"
              className="group bg-[#0a0a0a] p-6 md:p-7 hover:bg-[#151515] transition-colors">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 font-mono group-hover:text-[#2563eb] transition-colors">{t.status.mainnetContract} ↗</div>
              <div className="mt-3 font-mono text-xs text-[#f1eee7]/70 break-all">CBJMQ6ZY…SEVQN</div>
            </a>
            <a href={`https://stellar.expert/explorer/public/tx/${MAINNET_TX}`} target="_blank" rel="noopener noreferrer"
              className="group bg-[#0a0a0a] p-6 md:p-7 hover:bg-[#151515] transition-colors">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 font-mono group-hover:text-[#2563eb] transition-colors">{t.status.mainnetTx} ↗</div>
              <div className="mt-3 font-mono text-xs text-[#f1eee7]/70 break-all">05ae429b…510be</div>
            </a>
            <a href={`https://stellar.expert/explorer/public/tx/${MAINNET_BIO}`} target="_blank" rel="noopener noreferrer"
              className="group bg-[#0a0a0a] p-6 md:p-7 hover:bg-[#151515] transition-colors">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 font-mono group-hover:text-[#2563eb] transition-colors">{t.status.mainnetBio} ↗</div>
              <div className="mt-3 font-mono text-xs text-[#f1eee7]/70 break-all">d9a7d17a…1ec31</div>
            </a>
          </div>
          <p className="mt-5 text-xs text-[#f1eee7]/45 italic max-w-[64ch]">{t.status.mainnetNote}</p>
        </div>
      </Reveal>

      {/* 2 · the machine-proven agent spend-limit (axlc), shown open */}
      <Reveal as="section" className="border-t border-[#0a0a0a]/15">
        <div className="max-w-[1400px] mx-auto px-5 md:px-12 py-16 md:py-24">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-6">{t.agents.certLabel}</div>
          <p className="text-base md:text-lg text-[#0a0a0a]/75 leading-relaxed max-w-[64ch] mb-8">{t.proof.codeAside}</p>
          <pre className="bg-[#0a0a0a] text-[#f1eee7]/90 px-5 md:px-8 py-6 overflow-x-auto font-mono text-[11px] md:text-[13px] leading-[1.7] whitespace-pre max-w-[78ch]">
{t.proof.code}
          </pre>
          <div className="mt-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/60 font-mono max-w-[78ch]">
            <span className="flex items-center gap-2"><span className="inline-block w-2 h-2 bg-[#2563eb]" />{t.proof.runline}</span>
            <a href="https://galmanus.github.io/ssl-spec/" target="_blank" rel="noopener noreferrer" className="hover:text-[#0a0a0a] underline underline-offset-4">{t.proof.specLink}</a>
          </div>
        </div>
      </Reveal>

      {/* 3 · the x402 standard that makes agent payments possible */}
      <Reveal as="section" className="border-t border-[#0a0a0a]/15">
        <div className="max-w-[1400px] mx-auto px-5 md:px-12 py-16 md:py-24">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-6">{t.agents.standardLabel}</div>
          <h2 className="text-[6vw] md:text-[2.2vw] font-medium leading-[1.12] tracking-[-0.02em] max-w-[26ch]">{t.standard.h2}</h2>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45 font-mono mt-10 mb-6">{t.standard.backersLabel}</div>
          <X402Carousel />
          <p className="text-[11px] leading-relaxed text-[#0a0a0a]/50 mt-4 max-w-[62ch]">{t.standard.source}</p>
          <p className="mt-6 text-base md:text-lg leading-[1.5] text-[#0a0a0a]/85 max-w-[56ch]">{t.standard.bridge}</p>
        </div>
      </Reveal>

      {/* CTA — into the live demo; back to the human account */}
      <Reveal as="section" className="border-t border-[#0a0a0a]/15 bg-[#0a0a0a] text-[#f1eee7]">
        <div className="max-w-[1400px] mx-auto px-5 md:px-12 py-20 md:py-28 flex flex-col items-center text-center">
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <Link to="/x402-demo"
              className="lift inline-flex items-center gap-3 bg-[#0a0a0a] text-white px-8 py-4 text-[11px] uppercase tracking-[0.22em] font-medium hover:bg-[#c3f06a]">
              {t.agents.demoCta} <span>→</span>
            </Link>
            <Link to="/"
              className="group inline-flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] border-b border-[#f1eee7] pb-1 hover:opacity-60">
              {t.agents.back}
            </Link>
          </div>
          <a href="https://stellar.expert/explorer/public/contract/CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN"
            target="_blank" rel="noopener noreferrer"
            className="mt-10 font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/55 hover:text-[#2563eb] transition-colors">
            stellar · subscription contract · CBJMQ6ZY…SEVQN ↗
          </a>
        </div>
      </Reveal>
    </div>
  );
}
