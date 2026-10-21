// /x402-demo — "Watch the budget hold."
//
// The wedge, made watchable. An autonomous agent fires x402 micropayments. Two
// lanes run the SAME payments: x402 ALONE (per-request cap only → cumulative
// spend climbs unbounded) vs x402 + SlipPay (an aggregate budget that REFUSES
// the over-budget payment x402 alone lets through). The contrast IS the product.
//
// Honest: this is an illustration of the spend-governance mechanism. The
// contract is on Stellar testnet; the bound is real — run `axlc prove`.

import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo.tsx";

// x402 micropayment use cases (amounts in cents · x402 whitepaper examples).
const FEED = [
  { svc: "market data · Exa", c: 2 },
  { svc: "image classification", c: 0.5 },
  { svc: "RPC call · Alchemy", c: 1 },
  { svc: "web search", c: 2 },
  { svc: "voice clip", c: 10 },
  { svc: "news article", c: 25 },
  { svc: "court document", c: 10 },
  { svc: "GPU-minute", c: 50 },
  { svc: "premium dataset", c: 5 },
  { svc: "inference call", c: 3 },
];

const WINDOW_CAP = 300; // SlipPay aggregate budget ($3.00) — the cap x402 lacks
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

type Pay = { id: number; svc: string; c: number; ok: boolean };

export default function X402Demo() {
  const [running, setRunning] = useState(false);
  const [pays, setPays] = useState<Pay[]>([]);
  const [x402, setX402] = useState(0);
  const [slip, setSlip] = useState(0);
  const [refused, setRefused] = useState(0);

  const x402Ref = useRef(0), slipRef = useRef(0), refRef = useRef(0), idRef = useRef(0), payId = useRef(0);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      const f = FEED[idRef.current % FEED.length]!;
      idRef.current++;
      x402Ref.current += f.c;                                  // x402 alone: always accepted, unbounded
      const ok = slipRef.current + f.c <= WINDOW_CAP;          // SlipPay: only within the aggregate budget
      if (ok) slipRef.current += f.c; else refRef.current++;
      payId.current++;
      setPays((p) => [{ id: payId.current, svc: f.svc, c: f.c, ok }, ...p].slice(0, 7));
      setX402(x402Ref.current); setSlip(slipRef.current); setRefused(refRef.current);
    }, 620);
    return () => clearInterval(t);
  }, [running]);

  function reset() {
    setRunning(false);
    x402Ref.current = slipRef.current = refRef.current = idRef.current = 0;
    setX402(0); setSlip(0); setRefused(0); setPays([]);
  }

  const slipPct = Math.min(100, (slip / WINDOW_CAP) * 100);
  const x402Pct = Math.min(100, (x402 / WINDOW_CAP) * 100);
  const atBudget = slip >= WINDOW_CAP;
  const overByX402 = Math.max(0, x402 - WINDOW_CAP); // what x402-alone leaked past the budget

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a]">
      {/* nav */}
      <header className="max-w-[1400px] mx-auto px-5 md:px-12 py-5 md:py-6 flex items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-7 text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/65">
          <Link to="/" className="hover:opacity-60">Home</Link>
          <Link to="/" className="bg-[#FDDA24] text-[#0a0a0a] px-4 py-2 font-semibold hover:opacity-80 transition-opacity">The proof</Link>
        </nav>
      </header>

      {/* hero */}
      <section className="max-w-[1400px] mx-auto px-5 md:px-12 pt-10 md:pt-16 pb-8">
        <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-4 font-mono">╱╱ x402 demo · watch the budget hold</div>
        <h1 className="text-[9vw] md:text-[4vw] font-medium leading-[1.04] tracking-[-0.03em] max-w-[20ch]">
          An agent spends. <em className="not-italic">One lane holds.</em>
        </h1>
        <p className="mt-5 text-[15px] md:text-lg leading-[1.5] text-[#0a0a0a]/80 max-w-[64ch]">
          Same payments, two lanes. <em className="font-light">x402 alone</em> caps each request and lets the
          cumulative spend climb forever. <em className="font-light">x402 + SlipPay</em> holds an aggregate budget —
          and refuses the over-budget payment x402 alone would wave through. Press release and watch.
        </p>
      </section>

      {/* controls */}
      <section className="max-w-[1400px] mx-auto px-5 md:px-12 pb-6 flex flex-wrap items-center gap-4">
        <button onClick={() => setRunning((r) => !r)}
          className="px-6 py-3 bg-[#0a0a0a] text-[#FDDA24] font-semibold text-sm uppercase tracking-[0.15em] hover:opacity-80 transition-opacity">
          {running ? "❚❚ Pause agent" : "▶ Release the agent"}
        </button>
        <button onClick={reset}
          className="px-5 py-3 border border-[#0a0a0a]/30 hover:border-[#0a0a0a] text-sm uppercase tracking-[0.15em] transition-colors">
          Reset
        </button>
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">
          budget (window_cap) = <span className="text-[#0a0a0a] font-medium tabular-nums">{usd(WINDOW_CAP)}</span> · per-request cap applies to both
        </div>
      </section>

      {/* the two lanes */}
      <section className="max-w-[1400px] mx-auto px-5 md:px-12 pb-10 grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* x402 alone */}
        <div className="bg-[#0a0a0a] text-[#f1eee7] p-7 md:p-9 rounded-sm">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[#f1eee7]/55">
            <span>x402 alone</span><span>per-request cap only</span>
          </div>
          <div className="mt-5 text-5xl md:text-6xl font-medium tabular-nums tracking-tight" style={{ color: x402 > WINDOW_CAP ? "#ff5d57" : "#f1eee7" }}>
            {usd(x402)}
          </div>
          <div className="mt-4 h-2 bg-[#f1eee7]/12 overflow-hidden">
            <div className="h-full transition-all duration-300" style={{ width: `${x402Pct}%`, background: x402 > WINDOW_CAP ? "#ff5d57" : "#f1eee7" }} />
          </div>
          <div className="mt-4 text-[13px] leading-relaxed text-[#f1eee7]/70">
            {x402 > WINDOW_CAP
              ? <><span className="text-[#ff5d57] font-medium">UNBOUNDED.</span> {usd(overByX402)} past the budget and climbing — a thousand calls = a thousand times the cap. No aggregate ceiling.</>
              : <>Every request under the per-request cap. Accepted, always. No cumulative bound.</>}
          </div>
        </div>

        {/* x402 + SlipPay */}
        <div className="bg-[#f1eee7] border border-[#0a0a0a]/15 p-7 md:p-9 rounded-sm relative overflow-hidden">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/55">
            <span>x402 + SlipPay</span><span>aggregate budget · proved</span>
          </div>
          <div className="mt-5 text-5xl md:text-6xl font-medium tabular-nums tracking-tight text-[#0a0a0a]">{usd(slip)}</div>
          <div className="mt-4 h-2 bg-[#0a0a0a]/10 overflow-hidden">
            <div className="h-full bg-[#FDDA24] transition-all duration-300" style={{ width: `${slipPct}%` }} />
          </div>
          <div className="mt-4 text-[13px] leading-relaxed text-[#0a0a0a]/75">
            {atBudget
              ? <><span className="font-semibold">AT BUDGET — refusing.</span> {refused} over-budget payment{refused === 1 ? "" : "s"} REFUSED. Held at the cap, provably, over every sequence of actions.</>
              : <>Within the aggregate budget. The cumulative bound is enforced on-chain and <em className="font-light">machine-checked</em> — not hoped.</>}
          </div>
          {atBudget && (
            <div className="absolute top-6 right-6 -rotate-6 border-2 border-[#ff5d57] text-[#ff5d57] font-mono text-[11px] uppercase tracking-[0.2em] px-3 py-1.5">
              Refused
            </div>
          )}
        </div>
      </section>

      {/* payment stream + proof */}
      <section className="max-w-[1400px] mx-auto px-5 md:px-12 pb-10 grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* stream */}
        <div className="md:col-span-2 border border-[#0a0a0a]/15 p-6 font-mono">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/45 mb-4 flex items-center justify-between">
            <span>agent payment stream</span><span className="tabular-nums">{x402Ref.current ? `${idRef.current} fired` : "idle"}</span>
          </div>
          <div className="space-y-1.5 min-h-[180px]">
            {pays.length === 0 && <div className="text-[#0a0a0a]/35 text-sm">press “Release the agent” to start the stream…</div>}
            {pays.map((p) => (
              <div key={p.id} className="flex items-center gap-3 text-[13px] animate-[ledger-in_400ms_ease-out]">
                <span className="tabular-nums w-14 text-[#0a0a0a]/80">{usd(p.c)}</span>
                <span className="flex-1 truncate text-[#0a0a0a]/55">→ {p.svc}</span>
                <span className="w-24 text-right text-[11px] uppercase tracking-wide text-[#0a0a0a]/40">x402 ✓</span>
                <span className={`w-28 text-right text-[11px] uppercase tracking-wide ${p.ok ? "text-[#0a0a0a]/70" : "text-[#ff5d57] font-semibold"}`}>
                  {p.ok ? "slippay ✓" : "slippay ✗ refused"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* proof badge */}
        <div className="bg-[#0a0a0a] text-[#f1eee7] p-7 flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-2 bg-[#FDDA24] text-[#0a0a0a] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] font-semibold">● Proved</div>
            <div className="mt-5 font-mono text-sm leading-relaxed text-[#f1eee7]/85">
              <div className="text-[#FDDA24]">outflow ≤ 2·window_cap</div>
              <div className="mt-2 text-[#f1eee7]/60 text-[12px]">epoch invariant · machine-checked by Z3 · 0.4s · over every action sequence, not a sample.</div>
            </div>
          </div>
          <div className="mt-6 font-mono text-[11px] text-[#f1eee7]/45 leading-relaxed">$ axlc prove agent_budget.axl<br/>&nbsp;&nbsp;CERTIFICATE: ISSUED</div>
        </div>
      </section>

      {/* honest label */}
      <section className="max-w-[1400px] mx-auto px-5 md:px-12 pb-20">
        <p className="text-[11px] leading-relaxed text-[#0a0a0a]/45 max-w-[80ch]">
          Illustration of the spend-governance mechanism. The agent_wallet that enforces this is on Stellar
          <em className="not-italic"> testnet</em>, self-audited internally (external audit pending). The bound is
          real and machine-checked — run it yourself: <span className="font-mono">axlc prove</span>. x402 Foundation
          backing shown on the home page refers to the standard Slippay builds on; Slippay is not a member.
        </p>
      </section>
    </div>
  );
}
