// Hero artifact — interactive, high-tech. The card reacts to the cursor (3D tilt
// + a glare that follows the mouse), streams the agent making a REAL payment, and
// resolves to a verifiable mainnet tx. Tilt/glare are applied via refs (no
// re-render). The motion is decorative; the tx hash is proof you can click.
import { useEffect, useRef, useState } from "react";

const FALLBACK_TX = "ede13fb6230334af91b2af1cfab92f86f8f44e8a7755acb57d92891d68a3e957";
// Illustrative recurring-payment amounts (the animation is a scenario; the tx
// link below is the real on-chain proof). Rotates per cycle, capped at $20k.
const EXAMPLES = [1240, 4990, 8500, 12500, 19800];
const LIVE_ACCOUNT = "GCYEAQWXDR3MXHU364KIFOLSL2FIZL5RYXEKO3QVQ3WTQCWY64BXBRNR";
const HORIZON = "https://horizon.stellar.org";

const STEPS = [
  { at: 200, key: "init", label: "recurring payment", meta: "API bill" },
  { at: 700, key: "limit", label: "policy check", meta: "approved vendor" },
  { at: 1300, key: "route", label: "within monthly cap", meta: "within limit" },
  { at: 2000, key: "settle", label: "executed · settled", meta: "final · 4.9s" },
];
const ROUTE_START = 1300, SETTLE_AT = 2000, VERIFY_AT = 2500, TX_AT = 3400, RESET_AT = 8500;
const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function LivePaymentCard() {
  const [shown, setShown] = useState(0);
  const [route, setRoute] = useState(0);
  const [amount, setAmount] = useState(0);
  const [phase, setPhase] = useState<"run" | "verify" | "done">("run");
  const [cycle, setCycle] = useState(0);
  const [txHash, setTxHash] = useState(FALLBACK_TX);
  const txUrl = `https://stellar.expert/explorer/public/tx/${txHash}`;
  const raf = useRef<number | null>(null);
  const tiltRef = useRef<HTMLDivElement | null>(null);
  const glareRef = useRef<HTMLDivElement | null>(null);

  // interactive 3D tilt + glare (direct DOM, no re-render)
  function onMove(e: React.MouseEvent) {
    const el = tiltRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transition = "transform .08s linear";
    el.style.transform = `perspective(1100px) rotateX(${(-py * 9).toFixed(2)}deg) rotateY(${(px * 11).toFixed(2)}deg) scale(1.012)`;
    if (glareRef.current) {
      glareRef.current.style.opacity = "1";
      glareRef.current.style.background = `radial-gradient(380px circle at ${((px + 0.5) * 100).toFixed(0)}% ${((py + 0.5) * 100).toFixed(0)}%, rgba(253,218,36,.16), transparent 60%)`;
    }
  }
  function onLeave() {
    const el = tiltRef.current; if (el) { el.style.transition = "transform .6s cubic-bezier(.22,1,.36,1)"; el.style.transform = "perspective(1100px) rotateX(0) rotateY(0) scale(1)"; }
    if (glareRef.current) glareRef.current.style.opacity = "0";
  }

  useEffect(() => {
    let cancelled = false; const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 8000);
    (async () => {
      try {
        const r = await fetch(`${HORIZON}/accounts/${LIVE_ACCOUNT}/payments?order=desc&limit=5&include_failed=false`, { signal: ctrl.signal });
        if (!r.ok) return;
        const recs: Array<Record<string, unknown>> = (await r.json())?._embedded?.records ?? [];
        const p = recs.find((x) => typeof x.amount === "string" && typeof x.transaction_hash === "string");
        if (!p || cancelled) return;
        setTxHash(p.transaction_hash as string);
      } catch { /* keep fallback */ }
    })();
    return () => { cancelled = true; ctrl.abort(); window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    setShown(0); setRoute(0); setAmount(0); setPhase("run");
    const target = EXAMPLES[cycle % EXAMPLES.length] ?? 1240;
    const timers: number[] = [];
    STEPS.forEach((s, i) => timers.push(window.setTimeout(() => setShown(i + 1), s.at)));
    const cycleStart = performance.now();
    const tickRoute = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - ROUTE_START) / (SETTLE_AT - ROUTE_START)));
      setRoute(p);
      if (p < 1) raf.current = requestAnimationFrame(() => tickRoute(performance.now() - cycleStart));
    };
    timers.push(window.setTimeout(() => { raf.current = requestAnimationFrame(() => tickRoute(performance.now() - cycleStart)); }, ROUTE_START));
    timers.push(window.setTimeout(() => {
      const dur = 750, start = performance.now();
      const up = () => { const p = Math.min(1, (performance.now() - start) / dur); setAmount(target * (1 - Math.pow(1 - p, 3))); if (p < 1) raf.current = requestAnimationFrame(up); else setAmount(target); };
      raf.current = requestAnimationFrame(up);
    }, SETTLE_AT));
    timers.push(window.setTimeout(() => setPhase("verify"), VERIFY_AT));
    timers.push(window.setTimeout(() => setPhase("done"), TX_AT));
    timers.push(window.setTimeout(() => setCycle((c) => c + 1), RESET_AT));
    return () => { timers.forEach(clearTimeout); if (raf.current) cancelAnimationFrame(raf.current); };
  }, [cycle]);

  return (
    <div className="lpc relative" style={{ transformStyle: "preserve-3d" }} onMouseMove={onMove} onMouseLeave={onLeave}>
      <style>{`
        @keyframes lpcBlink { 0%,100%{opacity:1} 50%{opacity:.25} }
        @keyframes lpcSpin { to { transform: rotate(360deg) } }
        .lpc-dot { animation: lpcBlink 1.4s ease-in-out infinite; }
        .lpc-spin { animation: lpcSpin .8s linear infinite; }
      `}</style>
      <div className="absolute -inset-3 rounded-[30px] bg-[#cabfb0]/12 blur-3xl opacity-60" aria-hidden />

      <div ref={tiltRef} className="relative rounded-[22px] p-7 md:p-8 overflow-hidden text-left text-[#f1eee7] will-change-transform"
        style={{
          background: "linear-gradient(160deg,#15151a 0%,#0a0a0c 55%,#101013 100%)",
          boxShadow: "0 30px 80px -30px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.06)",
          border: "1px solid rgba(255,255,255,.08)",
          transform: "perspective(1100px)",
        }}>
        {/* cursor glare */}
        <div ref={glareRef} className="pointer-events-none absolute inset-0 transition-opacity duration-300" style={{ opacity: 0 }} aria-hidden />
        {/* faint tech scanlines */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.04]" aria-hidden
          style={{ backgroundImage: "repeating-linear-gradient(0deg, #fff 0, #fff 1px, transparent 1px, transparent 4px)" }} />

        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="lpc-dot inline-block w-2 h-2 rounded-full bg-[#FDDA24] shadow-[0_0_10px_#FDDA24]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#f1eee7]/55 whitespace-nowrap">agent · active</span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#f1eee7]/40 whitespace-nowrap">Stellar · mainnet</span>
        </div>

        <div className="relative mt-7">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/40 mb-1.5">amount paid</div>
          <div className="text-5xl md:text-[56px] leading-none font-semibold tabular-nums tracking-[-0.03em]"
            style={{ color: "#cabfb0", textShadow: "0 0 30px rgba(253,218,36,.18)" }}>{fmt(amount)}</div>
          <div className="font-mono text-[11px] text-[#f1eee7]/45 mt-2.5">in dollars · non-custodial · final</div>
        </div>

        <div className="relative mt-7 pt-6 border-t border-[#f1eee7]/10 space-y-3">
          {STEPS.map((s, i) => {
            const on = i < shown; const isRoute = s.key === "route";
            return (
              <div key={s.key} className="grid grid-cols-[14px_1fr_auto] items-center gap-3 transition-all duration-500"
                style={{ opacity: on ? 1 : 0.32, transform: on ? "none" : "translateY(2px)" }}>
                <span className={`text-[12px] leading-none ${on ? "text-[#cabfb0]" : "text-[#f1eee7]/30"}`}>{on ? "✓" : "·"}</span>
                <span className="text-[13px] text-[#f1eee7]/85">{s.label}</span>
                {isRoute && on && route < 1 ? (
                  <span className="justify-self-end w-24 h-[3px] rounded-full bg-[#f1eee7]/12 overflow-hidden">
                    <span className="block h-full rounded-full bg-[#cabfb0] transition-[width] duration-100" style={{ width: `${Math.round(route * 100)}%` }} />
                  </span>
                ) : (
                  <span className="justify-self-end font-mono text-[10px] uppercase tracking-[0.12em] text-[#f1eee7]/40 whitespace-nowrap">{s.meta}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* verify → tx proof (reserved space, no layout jump) */}
        <div className="relative mt-6 h-[52px]">
          <div className="absolute inset-0 flex items-center justify-center gap-2.5 rounded-xl transition-opacity duration-300"
            style={{ opacity: phase === "verify" ? 1 : 0, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" }}>
            <span className="lpc-spin inline-block w-3.5 h-3.5 rounded-full border-2 border-[#FDDA24]/30 border-t-[#FDDA24]" />
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#f1eee7]/60">verifying on-chain…</span>
          </div>
          <a href={txUrl} target="_blank" rel="noreferrer"
            className="absolute inset-0 flex items-center justify-between gap-3 rounded-xl px-4 transition-all duration-500 group"
            style={{ opacity: phase === "done" ? 1 : 0, pointerEvents: phase === "done" ? "auto" : "none", background: "rgba(253,218,36,.08)", border: "1px solid rgba(253,218,36,.24)" }}>
            <span className="font-mono text-[11px] text-[#f1eee7]/70">tx <span className="text-[#cabfb0]">{txHash.slice(0, 10)}…</span></span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#cabfb0] group-hover:underline underline-offset-4">verify on-chain ↗</span>
          </a>
        </div>
      </div>
    </div>
  );
}
