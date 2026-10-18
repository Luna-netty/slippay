// PayFlowDemo — cinematic, auto-looping device animation of the Slippay flow:
//   scan QR  →  Face ID  →  paid (verified on-chain)
// Pure CSS/React, IntersectionObserver-gated, honors prefers-reduced-motion.
// Editorial-restrained (BONE/INK + lime), not gaudy. The real flow lives at
// /pay + /cobrar; the paid screen links to the actual mainnet biometric tx.

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { encodeRequest } from "../lib/slippayqr";

type Phase = "scan" | "face" | "paid";
const ORDER: Phase[] = ["scan", "face", "paid"];
const DUR: Record<Phase, number> = { scan: 2600, face: 2400, paid: 3400 };
const BIO_TX = "d9a7d17a18719ece53535d51423b8951f37b163e170a7bea2cb4d9588471ec31";

function prefersReduced() {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function PayFlowDemo() {
  const [phase, setPhase] = useState<Phase>("scan");
  const [qr, setQr] = useState<string | null>(null);
  const [inView, setInView] = useState(false);
  const [paidAmt, setPaidAmt] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const reduce = prefersReduced();
  const animate = inView && !reduce;

  useEffect(() => {
    QRCode.toDataURL(encodeRequest({ to: "GANJ32T5VD2LDSQDT4A72LXSYG5IRLVMGJ5BQGTW3RRNJCEH3Y4HZ65K", amount: "3000000", label: "Slippay" }),
      { margin: 0, width: 240, color: { dark: "#0a0a0a", light: "#00000000" } }).then(setQr).catch(() => {});
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver((es) => setInView(es[0]?.isIntersecting ?? false), { threshold: 0.3 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || reduce) return;
    timer.current = window.setTimeout(() => {
      setPhase((p) => ORDER[(ORDER.indexOf(p) + 1) % ORDER.length]!);
    }, DUR[phase]);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [phase, inView, reduce]);

  // amount counts up 0 → 0.30 on the paid screen
  useEffect(() => {
    if (phase !== "paid") { setPaidAmt(0); return; }
    if (reduce) { setPaidAmt(0.30); return; }
    const start = performance.now(); const dur = 1000; let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      setPaidAmt(0.30 * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, reduce]);

  const step = ORDER.indexOf(phase);
  const money = (n: number) => n.toFixed(2).replace(".", ",");

  return (
    <div ref={ref} className="relative flex flex-col items-center" style={{ perspective: "1300px" }}>
      {/* ambient lime stage glow — intensifies on paid */}
      <div aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -z-0 rounded-full"
        style={{
          width: 420, height: 420,
          background: phase === "paid"
            ? "radial-gradient(circle, rgba(253,218,36,0.42), transparent 66%)"
            : "radial-gradient(circle, rgba(253,218,36,0.20), transparent 66%)",
          filter: "blur(18px)",
          transition: "background 700ms ease",
          animation: animate ? "pf-glow 7s ease-in-out infinite" : "none",
        }} />

      {/* floating device */}
      <div style={{ transformStyle: "preserve-3d", animation: animate ? "pf-bob 6.5s ease-in-out infinite" : "none" }}>
        <div className="relative w-[264px] h-[548px] bg-[#070707] rounded-[2.7rem] p-[10px]
                        shadow-[0_50px_120px_-30px_rgba(10,10,10,0.65),0_8px_30px_-10px_rgba(10,10,10,0.5)]
                        ring-1 ring-white/10">
          {/* titanium top edge highlight */}
          <div aria-hidden className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent rounded-full" />
          {/* dynamic island */}
          <div className="absolute top-[14px] left-1/2 -translate-x-1/2 w-[86px] h-[26px] bg-black rounded-full z-30 ring-1 ring-white/5" />

          <div className="relative w-full h-full rounded-[2.05rem] overflow-hidden bg-[#f1eee7]">
            {/* glass glare sweep */}
            {animate && (
              <div aria-hidden className="pointer-events-none absolute -inset-y-4 left-0 w-1/2 z-20"
                style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)", animation: "pf-glare 6.5s ease-in-out infinite" }} />
            )}

            {/* SCAN ───────────────────────────── */}
            <Screen active={phase === "scan"}>
              <div className="h-full bg-[#0a0a0a] flex flex-col items-center justify-center px-6 relative">
                <StatusBar tone="light" />
                <div className="absolute top-12 left-0 right-0 text-center text-[9px] uppercase tracking-[0.26em] text-[#f1eee7]/55 font-mono">aponta no QR</div>
                <div className="relative w-[186px] h-[186px] flex items-center justify-center">
                  {qr && <img src={qr} alt="" className="w-[150px] h-[150px]" style={{ filter: "invert(1)" }} />}
                  {/* breathing corner brackets */}
                  {(["tl", "tr", "bl", "br"] as const).map((c) => (
                    <span key={c} aria-hidden
                      className={"absolute w-7 h-7 border-[#FDDA24] " +
                        (c === "tl" ? "left-0 top-0 border-l-2 border-t-2" :
                         c === "tr" ? "right-0 top-0 border-r-2 border-t-2" :
                         c === "bl" ? "left-0 bottom-0 border-l-2 border-b-2" :
                                      "right-0 bottom-0 border-r-2 border-b-2")}
                      style={{ animation: phase === "scan" ? "pf-bracket 1.6s ease-in-out infinite" : "none" }} />
                  ))}
                  {phase === "scan" && (
                    <span aria-hidden className="absolute left-1 right-1 h-[2px] bg-[#FDDA24]"
                      style={{ boxShadow: "0 0 16px 2px #FDDA24", animation: "pf-sweep 1.5s ease-in-out infinite" }} />
                  )}
                </div>
                <div className="mt-9 text-[#f1eee7] text-3xl font-medium tabular-nums tracking-[-0.03em]">
                  <span className="text-sm text-[#f1eee7]/50">US$ </span>0,30
                </div>
              </div>
            </Screen>

            {/* FACE ───────────────────────────── */}
            <Screen active={phase === "face"}>
              <div className="h-full bg-[#0a0a0a] flex flex-col items-center justify-center px-6 relative overflow-hidden">
                <StatusBar tone="light" />
                <div className="relative w-[140px] h-[140px] flex items-center justify-center">
                  {/* concentric pulse rings */}
                  {phase === "face" && [0, 0.5, 1].map((d) => (
                    <span key={d} aria-hidden className="absolute w-[120px] h-[120px] rounded-full border border-[#FDDA24]/60"
                      style={{ animation: `pf-ring 1.8s ease-out ${d}s infinite` }} />
                  ))}
                  {/* progress arc */}
                  <span aria-hidden className="absolute inset-0 rounded-full border-2 border-[#f1eee7]/12" />
                  {phase === "face" && (
                    <span aria-hidden className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#FDDA24] border-r-[#FDDA24]"
                      style={{ animation: "pf-spin 0.95s linear infinite" }} />
                  )}
                  {/* faint dot mesh over the face */}
                  <div aria-hidden className="absolute inset-3 grid grid-cols-6 gap-[7px] opacity-40">
                    {Array.from({ length: 36 }).map((_, i) => (
                      <span key={i} className="w-[3px] h-[3px] rounded-full bg-[#FDDA24]/70" />
                    ))}
                  </div>
                  {/* face glyph */}
                  <svg width="58" height="58" viewBox="0 0 56 56" fill="none" className="relative text-[#f1eee7]">
                    <circle cx="20" cy="23" r="3" fill="currentColor" /><circle cx="36" cy="23" r="3" fill="currentColor" />
                    <path d="M19 36c3 3 15 3 18 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                  {/* scan bar */}
                  {phase === "face" && (
                    <span aria-hidden className="absolute left-2 right-2 h-[2px] bg-[#FDDA24]/90"
                      style={{ boxShadow: "0 0 14px 1px #FDDA24", animation: "pf-mesh 1.7s ease-in-out infinite" }} />
                  )}
                </div>
                <div className="mt-9 text-[#f1eee7]/85 text-sm uppercase tracking-[0.24em] font-mono">autorizando</div>
                <div className="mt-1.5 text-[#f1eee7]/40 text-[10px] tracking-wide">sem senha · só o seu rosto</div>
              </div>
            </Screen>

            {/* PAID ───────────────────────────── */}
            <Screen active={phase === "paid"}>
              <div className="h-full bg-[#f1eee7] flex flex-col items-center justify-center px-6 relative">
                <StatusBar tone="dark" />
                <div className="relative flex items-center justify-center">
                  {/* success burst ring */}
                  {phase === "paid" && (
                    <span aria-hidden className="absolute w-[96px] h-[96px] rounded-full border-2 border-[#FDDA24]"
                      style={{ animation: "pf-burst 0.9s var(--ease-out-expo) forwards" }} />
                  )}
                  <div className="w-[92px] h-[92px] bg-[#FDDA24] flex items-center justify-center"
                    style={{ animation: phase === "paid" ? "pf-pop 0.5s var(--ease-out-expo) both" : "none" }}>
                    <svg width="46" height="46" viewBox="0 0 44 44" fill="none">
                      <path d="M11 23l8 8 14-16" stroke="#0a0a0a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
                        style={phase === "paid" ? { strokeDasharray: 48, strokeDashoffset: 48, animation: "pf-draw 0.5s 0.18s var(--ease-out-expo) forwards" } : undefined} />
                    </svg>
                  </div>
                </div>
                <div className="mt-6 text-2xl font-medium tracking-[-0.02em]" style={phase === "paid" ? { animation: "pf-rise 0.5s 0.15s both" } : undefined}>Pago</div>
                <div className="mt-1 text-3xl font-medium tabular-nums tracking-[-0.03em]">
                  <span className="text-base text-[#0a0a0a]/45">US$ </span>{money(paidAmt)}
                </div>
                <div className="mt-5 text-[9px] uppercase tracking-[0.22em] font-mono text-[#0a0a0a]/45 flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 bg-[#FDDA24] animate-pulse" /> verificado on-chain
                </div>
                {/* the real mainnet biometric tx — ties the demo to the proof */}
                <a href={`https://stellar.expert/explorer/public/tx/${BIO_TX}`} target="_blank" rel="noopener noreferrer"
                  className="mt-2 font-mono text-[9px] tracking-tight text-[#0a0a0a]/35 hover:text-[#0a0a0a]/70 transition-colors">
                  d9a7d17a…1ec31 ↗
                </a>
              </div>
            </Screen>
          </div>
        </div>
      </div>

      {/* progress line + label */}
      <div className="mt-9 flex items-center gap-2">
        {ORDER.map((p, i) => (
          <span key={p} className="h-1.5 transition-all duration-500"
            style={{ width: i === step ? 30 : 8, background: i === step ? "#FDDA24" : "rgba(10,10,10,0.18)" }} />
        ))}
      </div>
      <div className="mt-3 text-[10px] uppercase tracking-[0.24em] font-mono text-[#0a0a0a]/55">
        {["aponta no QR", "toca o rosto", "pago · on-chain"][step]}
      </div>
    </div>
  );
}

// faux iOS status bar — time + signal/battery, for device realism
function StatusBar({ tone }: { tone: "light" | "dark" }) {
  const c = tone === "light" ? "text-[#f1eee7]/70" : "text-[#0a0a0a]/55";
  return (
    <div className={"absolute top-[18px] left-0 right-0 px-6 flex items-center justify-between text-[10px] font-mono tabular-nums " + c}>
      <span>9:41</span>
      <span className="flex items-center gap-1">
        <span className="inline-flex items-end gap-[1.5px]">
          <i className="inline-block w-[2px] h-[4px] bg-current rounded-[1px]" />
          <i className="inline-block w-[2px] h-[6px] bg-current rounded-[1px]" />
          <i className="inline-block w-[2px] h-[8px] bg-current rounded-[1px]" />
        </span>
        <span className="inline-block w-[16px] h-[8px] border border-current rounded-[2px] relative">
          <span className="absolute inset-[1.5px] right-[5px] bg-current rounded-[1px]" />
        </span>
      </span>
    </div>
  );
}

function Screen({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 transition-all duration-[600ms]"
      style={{
        opacity: active ? 1 : 0,
        transform: active ? "translateX(0) scale(1)" : "translateX(6%) scale(0.97)",
        pointerEvents: active ? "auto" : "none",
        transitionTimingFunction: "var(--ease-out-expo)",
      }}
    >
      {children}
    </div>
  );
}
