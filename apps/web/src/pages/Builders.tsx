// /builders — the engineering surface. Speaks to Stellar/Soroban devs, not
// consumers. Leads with the thing no one else ships: agent payments whose
// limit is PROVEN on-chain, non-custodial, live on Stellar mainnet. Every
// claim is a verifiable artifact (contract id / tx hash) — devs will click,
// so honesty (mainnet vs testnet) is the credibility, not a liability.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { V3Ribbon } from "../components/V3Ribbon.tsx";
import { Logo } from "../components/Logo.tsx";
import { LivePaymentCard } from "../components/LivePaymentCard.tsx";
import { RuleSandbox } from "../components/RuleSandbox.tsx";

const display = { fontFamily: "'DM Sans', sans-serif" } as const;
const GRAY = "#6f6862";

// ── Verifiable on-chain artifacts ────────────────────────────────────────────
const RAIL_MAINNET = "CD2RFNOLMIKZN4EETDCGULGMD4ANS56IIUDIBLOE24P4JRZM2GCVFV2U"; // recurring rail, live
const BOUND_MAINNET = "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN"; // attested charge contract
const PREAUTH_TESTNET = "CBWGRLJNJ4WK2XLCQS32HXDCFAPGH42N5QRBJ674L7XLLS6TFDTQGME3"; // v0.2 pre-auth (authorize/autocharge/revoke)
const REAL_TX = "5da9741f554294a196376088ebd8f753f466a03cf657e67248533d78e0e3edf6"; // settled on mainnet
const pub = (p: string, id: string) => `https://stellar.expert/explorer/public/${p}/${id}`;
const test = (p: string, id: string) => `https://stellar.expert/explorer/testnet/${p}/${id}`;
const trunc = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;

const sec = "border-t border-[#0a0a0a]/12";
const wrap = "max-w-[1000px] mx-auto px-6 md:px-12";

function Eyebrow({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.28em]" style={{ color: GRAY }}>
      <span className="text-[#0a0a0a]/55">{n}</span><span className="h-px w-8 bg-current opacity-40" /><span>{label}</span>
    </div>
  );
}

function Artifact({ label, id, href, net }: { label: string; id: string; href: string; net: "mainnet" | "testnet" }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="group flex items-center justify-between gap-4 rounded-xl border border-[#0a0a0a]/12 px-4 py-3.5 hover:border-[#0a0a0a]/40 transition-colors">
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: GRAY }}>{label}</div>
        <div className="font-mono text-[13px] text-[#0a0a0a] truncate">{trunc(id)}</div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`font-mono text-[9px] uppercase tracking-[0.14em] px-2 py-1 rounded ${net === "mainnet" ? "bg-[#0a0a0a] text-[#2563eb]" : "bg-[#0a0a0a]/[0.06] text-[#0a0a0a]/55"}`}>{net}</span>
        <span className="text-[#0a0a0a]/40 group-hover:text-[#0a0a0a] transition-colors">↗</span>
      </div>
    </a>
  );
}

const code = "font-mono text-[12.5px] leading-relaxed bg-[#0a0a0a] text-[#f1eee7] rounded-2xl p-5 overflow-x-auto";

export default function Builders() {
  // Scroll-reveal — also guarantees data-reveal content is never stuck hidden
  // if the root carries .js-reveal from a prior SPA route.
  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("reveal-in"));
      return;
    }
    root.classList.add("js-reveal");
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) { e.target.classList.add("reveal-in"); io.unobserve(e.target); }
    }, { rootMargin: "-8% 0px -8% 0px", threshold: 0.06 });
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="relative min-h-screen bg-transparent text-[#0a0a0a] grain">
      <V3Ribbon />
      {/* header */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-[#f1eee7]/80 border-b border-[#0a0a0a]/8">
        <div className="max-w-[1100px] mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
          <Link to="/"><Logo /></Link>
          <div className="flex items-center gap-6 text-[12px] uppercase tracking-[0.16em]">
            <a href="#proof" className="hidden sm:inline text-[#0a0a0a]/55 hover:text-[#0a0a0a]">Proof</a>
            <a href="#mechanism" className="hidden sm:inline text-[#0a0a0a]/55 hover:text-[#0a0a0a]">Mechanism</a>
            <a href="https://slippay.gitbook.io/slippay-docs" target="_blank" rel="noreferrer" className="text-[#0a0a0a]/55 hover:text-[#0a0a0a]">Docs ↗</a>
            <Link to="/" className="text-[#0a0a0a]/55 hover:text-[#0a0a0a]">For people →</Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="px-6 md:px-12 pt-14 md:pt-20 pb-16 md:pb-24">
        <div className="max-w-[1100px] mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#0a0a0a]/35">for builders · live on stellar mainnet</div>
            <h1 className="mt-6 font-bold uppercase tracking-[-0.04em] leading-[0.95] text-[clamp(2.2rem,5.5vw,4rem)]" style={display}>
              Payment rails for <em className="not-italic" style={{ color: "#1d4ed8" }}>autonomous agents.</em>
            </h1>
            <p className="mt-7 text-xl md:text-2xl leading-snug max-w-[30ch]" style={display}>
              An agent pays on its own — and <strong>can't exceed the limit you set</strong>. We prove that bound on-chain, not in a slide. Non-custodial. Live on mainnet.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-3">
              <a href={pub("tx", REAL_TX)} target="_blank" rel="noreferrer" className="lift inline-flex items-center rounded-full px-8 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#0a0a0a] text-white">Verify a real payment ↗</a>
              <a href="#mechanism" className="text-[12px] uppercase tracking-[0.18em] border-b border-[#0a0a0a]/20 hover:border-[#0a0a0a] pb-1" style={{ color: GRAY }}>How it works ↓</a>
            </div>
          </div>
          <div className="w-full max-w-[420px] mx-auto"><LivePaymentCard /></div>
        </div>
      </section>

      {/* THE GAP */}
      <section className={sec}><div data-reveal className={`${wrap} py-20 md:py-28`}>
        <Eyebrow n="001" label="the gap" />
        <h2 className="mt-8 font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(1.8rem,5vw,3.25rem)] max-w-[20ch]" style={display}>
          Agents can pay. Nobody can prove they won't overpay.
        </h2>
        <div className="mt-10 grid md:grid-cols-3 gap-8 md:gap-10">
          {[
            ["The problem", "An autonomous agent with a wallet can drain it — wrong recipient, wrong amount, a prompt-injected instruction. “Trust the agent” is not a security model."],
            ["The usual answer", "Off-chain allowlists and rate limits. They live in a database the agent's own runtime controls. Compromise the runtime, bypass the rule."],
            ["Slippay", "The bound is enforced where the money moves: on-chain, in the contract, and attested by an independent signer. The agent literally cannot execute outside it."],
          ].map(([h, b], i) => (
            <div key={i}>
              <div className="font-mono text-[11px] text-[#2563eb] bg-[#0a0a0a] inline-block px-2 py-0.5 rounded">{`0${i + 1}`}</div>
              <div className="mt-3 font-bold text-lg" style={display}>{h}</div>
              <p className="mt-2 text-[#0a0a0a]/65 leading-relaxed">{b}</p>
            </div>
          ))}
        </div>
      </div></section>

      {/* PROOF — verifiable artifacts */}
      <section id="proof" className={sec}><div data-reveal className={`${wrap} py-20 md:py-28`}>
        <Eyebrow n="002" label="verify, don't trust" />
        <h2 className="mt-8 font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(1.8rem,5vw,3.25rem)] max-w-[18ch]" style={display}>
          It's on the ledger. Click and check.
        </h2>
        <p className="mt-6 text-lg text-[#0a0a0a]/60 max-w-[52ch]">Real contracts, a real settled payment. Mainnet where it's production, testnet where it's still hardening — labeled honestly, because you can verify either way.</p>
        <div className="mt-10 grid md:grid-cols-2 gap-4">
          <Artifact label="recurring rail — settled payment" id={REAL_TX} href={pub("tx", REAL_TX)} net="mainnet" />
          <Artifact label="recurring rail contract" id={RAIL_MAINNET} href={pub("contract", RAIL_MAINNET)} net="mainnet" />
          <Artifact label="attested-charge contract" id={BOUND_MAINNET} href={pub("contract", BOUND_MAINNET)} net="mainnet" />
          <Artifact label="pre-auth v0.2 (authorize / autocharge / revoke)" id={PREAUTH_TESTNET} href={test("contract", PREAUTH_TESTNET)} net="testnet" />
        </div>
        <p className="mt-5 font-mono text-[11px] text-[#0a0a0a]/40">these prove the mechanism works on-chain — not a traction metric.</p>
      </div></section>

      {/* MECHANISM */}
      <section id="mechanism" className={sec}><div data-reveal className={`${wrap} py-20 md:py-28`}>
        <Eyebrow n="003" label="the mechanism" />
        <h2 className="mt-8 font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(1.8rem,5vw,3.25rem)] max-w-[20ch]" style={display}>
          Three layers, all fail-closed.
        </h2>
        <div className="mt-12 flex flex-col gap-10">
          <div className="grid md:grid-cols-[200px_1fr] gap-4 md:gap-10">
            <div className="font-bold text-lg" style={display}>1 · On-chain pre-auth</div>
            <div>
              <p className="text-[#0a0a0a]/70 leading-relaxed">The buyer signs <span className="font-mono text-[13px]">authorize(id, max_total)</span> once and grants the contract a SEP-41 allowance. After that the scheduler calls <span className="font-mono text-[13px]">autocharge(id)</span> with <strong>no per-charge signature</strong> — and the contract can only pull funds within the cumulative ceiling the buyer set. Over the ceiling, it reverts. <span className="font-mono text-[13px]">revoke(id)</span> kills it instantly.</p>
            </div>
          </div>
          <div className="grid md:grid-cols-[200px_1fr] gap-4 md:gap-10">
            <div className="font-bold text-lg" style={display}>2 · Attester oracle</div>
            <div>
              <p className="text-[#0a0a0a]/70 leading-relaxed">An agent commits a <em>surface</em> up front: allowed recipients, allowed tools, a max amount. Before any charge the attester checks the action against that surface. In-surface → it signs an ed25519 attestation. Off-surface → it refuses and flags <span className="font-mono text-[13px]">compromised: true</span>. The signed message is <strong>byte-for-byte identical</strong> to what Soroban verifies, so one attestation proves the bound both on-chain and off.</p>
            </div>
          </div>
          <div className="grid md:grid-cols-[200px_1fr] gap-4 md:gap-10">
            <div className="font-bold text-lg" style={display}>3 · Non-custodial wallet</div>
            <div>
              <p className="text-[#0a0a0a]/70 leading-relaxed">Funds live in the user's passkey-controlled smart wallet. The relayer sponsors gas only — it can never move funds to an arbitrary recipient, and it rejects any tx that isn't an approved deploy or a capped transfer. Slippay holds nothing. <strong>Not a custodian, not a VASP</strong> — the licensed partner carries those obligations, not us.</p>
            </div>
          </div>
        </div>
      </div></section>

      {/* PRIMITIVES — code */}
      <section className={sec}><div data-reveal className={`${wrap} py-20 md:py-28`}>
        <Eyebrow n="004" label="the primitives" />
        <h2 className="mt-8 font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(1.8rem,5vw,3.25rem)] max-w-[18ch]" style={display}>
          Bound a spend in three calls.
        </h2>
        <div className="mt-10 grid md:grid-cols-2 gap-6">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] mb-3" style={{ color: GRAY }}>soroban contract</div>
            <pre className={code}>{`// buyer authorizes a ceiling, once
authorize(id, max_total)

// scheduler charges within it, no signature
autocharge(id) -> next_due
  // reverts if spent + amount > max_total
  // reverts if not Active / period not elapsed

// buyer cuts it off, instantly
revoke(id)`}</pre>
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] mb-3" style={{ color: GRAY }}>attester · fail-closed</div>
            <pre className={code}>{`POST /attest
{ agent_id, recipient, amount }

// in-surface  -> { ok: true,  signature }
// off-surface -> { ok: false,
//                  compromised: true,
//                  reason: "recipient" }

// one signature verifies the same on-chain
// and off — fail-closed, surface-bound.`}</pre>
          </div>
        </div>
      </div></section>

      {/* SECURITY GUARANTEES — properties, not source */}
      <section className={sec}><div data-reveal className={`${wrap} py-20 md:py-28`}>
        <Eyebrow n="004b" label="the guarantees" />
        <h2 className="mt-8 font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(1.8rem,5vw,3.25rem)] max-w-[20ch]" style={display}>
          Provable, not promised.
        </h2>
        <p className="mt-6 text-lg text-[#0a0a0a]/60 max-w-[56ch]">The implementation is ours. The guarantees are yours to verify — every one resolves on-chain, not on our word.</p>
        <div className="mt-10 grid sm:grid-cols-2 gap-5 md:gap-7">
          {[
            ["Bounded", "A charge can never exceed the ceiling you set. Enforced in the contract; over it, the transaction reverts."],
            ["Fail-closed", "Any ambiguity, it refuses. It never pays when in doubt."],
            ["No custody", "Funds only ever move to the exact recipient, for the exact amount, within the cap. Nothing else is possible."],
            ["Independent", "The limit is verified by a signer the agent's runtime can't reach. Owning the agent doesn't lift it."],
            ["Replay-proof", "Every authorization is bound to a sequence and an expiry. A stale one is dead on arrival."],
            ["Self-revocable", "You kill it instantly, on-chain. No ticket, no waiting."],
          ].map(([h, b], i) => (
            <div key={i} className="rounded-xl border border-[#0a0a0a]/12 px-5 py-4">
              <div className="font-bold text-lg" style={display}>{h}</div>
              <p className="mt-1.5 text-[14px] text-[#0a0a0a]/60 leading-relaxed">{b}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-[14px] text-[#0a0a0a]/65 leading-relaxed max-w-[60ch]"><b>Proven on a real host (audit-002 F5):</b> a third party — not the owner — triggered a charge with zero owner signatures, and the funds moved within the bound. <a className="underline decoration-[#0a0a0a]/30 hover:decoration-[#0a0a0a]" target="_blank" rel="noreferrer" href={test("tx", "16295b0ea33b1a3996b88bd7de414dab2f0e76cbaa43a3033a6a996a97c87cb2")}>see the testnet tx ↗</a></p>
      </div></section>

      {/* INTERACTIVE — set a rule, watch it block */}
      <section className={sec}><div data-reveal className={`${wrap} py-20 md:py-28`}>
        <Eyebrow n="005" label="try the bound" />
        <h2 className="mt-8 font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(1.8rem,5vw,3.25rem)] max-w-[20ch]" style={display}>
          Set a rule. Watch it refuse.
        </h2>
        <div className="mt-10 max-w-[520px]"><RuleSandbox /></div>
      </div></section>

      {/* WHY STELLAR */}
      <section className={sec}><div data-reveal className={`${wrap} py-20 md:py-28`}>
        <Eyebrow n="006" label="why stellar" />
        <h2 className="mt-8 font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(1.8rem,5vw,3.25rem)] max-w-[22ch]" style={display}>
          The agent-payment flagship Stellar needs.
        </h2>
        <div className="mt-10 grid md:grid-cols-3 gap-8 md:gap-10 text-[#0a0a0a]/70 leading-relaxed">
          <p><strong className="text-[#0a0a0a]">x402, native.</strong> Agent-to-agent payments are the race every chain is running. Slippay ships the bounded version on Soroban — real settlement, sub-5s, fractions of a cent.</p>
          <p><strong className="text-[#0a0a0a]">Mainnet, not a demo.</strong> The rail settles on Stellar PUBLIC today. Every claim here resolves to a contract id or a tx hash you can open right now.</p>
          <p><strong className="text-[#0a0a0a]">Distribution built in.</strong> The same engine powers a consumer dollar account in Brazil — so the agent rail rides real Pix→USDC volume, not a testnet faucet.</p>
        </div>
      </div></section>

      {/* STACK STATUS — honest */}
      <section className={sec}><div data-reveal className={`${wrap} py-20 md:py-28`}>
        <Eyebrow n="007" label="what's live, what's hardening" />
        <h2 className="mt-8 font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(1.8rem,5vw,3.25rem)] max-w-[16ch]" style={display}>
          No vaporware.
        </h2>
        <div className="mt-10 grid sm:grid-cols-2 gap-4 max-w-[760px]">
          {[
            ["Recurring rail", "mainnet", "Live. Settles real USDC on Stellar PUBLIC."],
            ["Attester oracle", "live", "Running. ed25519, fail-closed, surface-bound."],
            ["Non-custodial wallet + relayer", "mainnet", "Live. Passkey smart wallet, gas-only relayer."],
            ["Pre-auth v0.2 (autocharge)", "testnet", "Deployed + tested. Mainnet pending an outside audit."],
            ["USDC ↔ Pix ramp", "integrated", "Built against a BCB-licensed partner; activates on key."],
            ["Attestation-as-compliance", "roadmap", "Proof + reporting as a paid tier."],
          ].map(([h, tag, b], i) => (
            <div key={i} className="rounded-xl border border-[#0a0a0a]/12 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-bold" style={display}>{h}</div>
                <span className={`font-mono text-[9px] uppercase tracking-[0.14em] px-2 py-1 rounded ${tag === "mainnet" || tag === "live" ? "bg-[#0a0a0a] text-[#2563eb]" : "bg-[#0a0a0a]/[0.06] text-[#0a0a0a]/55"}`}>{tag}</span>
              </div>
              <p className="mt-2 text-[14px] text-[#0a0a0a]/60 leading-relaxed">{b}</p>
            </div>
          ))}
        </div>
      </div></section>

      {/* THREAT MODEL — the AI-security depth */}
      <section className={sec}><div data-reveal className={`${wrap} py-20 md:py-28`}>
        <Eyebrow n="008" label="threat model" />
        <h2 className="mt-8 font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(1.8rem,5vw,3.25rem)] max-w-[20ch]" style={display}>
          Assume the agent is already owned.
        </h2>
        <p className="mt-6 text-lg text-[#0a0a0a]/65 max-w-[60ch] leading-relaxed">
          We run <strong>Wave</strong>, our own autonomous agent, in production. So we don't pretend agents are safe — we assume they get prompt-injected, redirected, and compromised, and we make sure the money survives it anyway. The bound lives <em>outside</em> the agent's reach: on-chain and in an independent signer the agent's runtime can't touch.
        </p>
        <div className="mt-10 rounded-2xl border border-[#0a0a0a]/12 overflow-hidden">
          <div className="grid grid-cols-[1fr_1.3fr] sm:grid-cols-[1fr_1.6fr]">
            <div className="bg-[#0a0a0a]/[0.04] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: GRAY }}>attack</div>
            <div className="bg-[#0a0a0a]/[0.04] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: GRAY }}>why it fails against Slippay</div>
            {[
              ["Prompt injection → pay attacker", "The payee must be in the pre-committed surface. The attacker's address isn't → attester refuses, on-chain bound never executes."],
              ["Recipient redirection", "Recipient whitelist is signed up front. Swap it → off-surface → compromised: true, charge blocked."],
              ["Amount inflation", "The spend cap is enforced in the contract and in the surface. Over it, the charge reverts on-chain."],
              ["Tool poisoning", "allowed_tools is committed. An off-surface tool call is refused before any signature is issued."],
              ["Replay / stale attestation", "The signed message binds charges_done + not_after. A replayed attestation is already expired or out of sequence."],
              ["Full runtime compromise", "The cap isn't in the agent's database — it's on-chain and in an independent attester. Owning the agent doesn't lift its own limit."],
            ].map(([a, d], i) => (
              <div key={i} className="contents">
                <div className={`px-4 py-4 text-[14px] sm:text-[15px] flex items-center ${i % 2 ? "bg-[#0a0a0a]/[0.02]" : ""}`} style={display}>{a}</div>
                <div className={`px-4 py-4 text-[13px] sm:text-[14px] text-[#0a0a0a]/65 leading-relaxed flex items-center ${i % 2 ? "bg-[#0a0a0a]/[0.02]" : ""}`}>{d}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-6 font-mono text-[11px] text-[#0a0a0a]/40">fail-closed by default: when in doubt, it refuses and flags — it never pays.</p>
      </div></section>

      {/* CTA */}
      <section className={sec}><div data-reveal className={`${wrap} py-24 md:py-32 text-center`}>
        <h2 className="font-bold tracking-[-0.04em] leading-[0.95] text-[clamp(2rem,6vw,4rem)] max-w-[16ch] mx-auto" style={display}>
          Open the contract. See for yourself.
        </h2>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
          <a href={pub("contract", RAIL_MAINNET)} target="_blank" rel="noreferrer" className="lift inline-flex items-center rounded-full px-9 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#0a0a0a] text-white">The live contract ↗</a>
          <a href={pub("tx", REAL_TX)} target="_blank" rel="noreferrer" className="text-[12px] uppercase tracking-[0.18em] border-b border-[#0a0a0a]/20 hover:border-[#0a0a0a] pb-1" style={{ color: GRAY }}>A real payment ↗</a>
        </div>
        <div className="mt-12 font-mono text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/35">slippay · provable agent payments · stellar mainnet</div>
      </div></section>
    </div>
  );
}
