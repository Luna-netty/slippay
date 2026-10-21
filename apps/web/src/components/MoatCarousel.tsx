// Dynamic moat carousel for the agent-commerce landing. Self-contained, no
// animation library (CSS transitions only, matching the codebase convention).
// Dark slide (ink bg) so the lime accent + the headline carry the drama.
//
// Auto-advances; pauses on hover/focus so a reader is never cut off; manual
// dots + arrows; a lime progress bar that fills over the dwell time and
// restarts per slide. Each slide carries a VERIFIABLE proof affordance — the
// claims are code-true (see the moat-verification pass), so we invite the
// visitor to check, not just trust.

import { useState, useEffect, useCallback } from "react";

export interface MoatSlide {
  tag: string;        // short kicker, e.g. "Proven, not promised"
  headline: string;   // <= ~8 words
  subline: string;    // one verifiable sentence
  proof?: { label: string; href?: string }; // demonstrable artifact
}

export function MoatCarousel({ slides, interval = 6500 }: { slides: MoatSlide[]; interval?: number }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  const go = useCallback((to: number) => setI(((to % n) + n) % n), [n]);

  useEffect(() => {
    if (paused || n <= 1) return;
    const t = setTimeout(() => setI((x) => (x + 1) % n), interval);
    return () => clearTimeout(t);
  }, [i, paused, n, interval]);

  if (n === 0) return null;
  const pad2 = (x: number) => String(x + 1).padStart(2, "0");

  return (
    <div
      className="relative bg-[#0a0a0a] text-[#f1eee7] overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* faint grid / glow for depth */}
      <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(253,218,36,0.16), transparent)" }} />

      <div className="relative max-w-[1100px] mx-auto px-5 md:px-10 py-16 md:py-20">
        <div className="flex items-center justify-between mb-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/45">
            ┃ technical moats
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/45 tabular-nums">
            moat {pad2(i)} <span className="text-[#f1eee7]/25">/ {pad2(n - 1)}</span>
          </div>
        </div>

        {/* slide stage */}
        <div className="relative min-h-[260px] md:min-h-[230px]">
          {slides.map((s, idx) => {
            const active = idx === i;
            return (
              <div
                key={idx}
                aria-hidden={!active}
                className="absolute inset-0 transition-all duration-[600ms]"
                style={{
                  opacity: active ? 1 : 0,
                  transform: active ? "translateY(0)" : "translateY(10px)",
                  pointerEvents: active ? "auto" : "none",
                  transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)",
                }}
              >
                <div className="text-[#FDDA24] font-mono text-[11px] uppercase tracking-[0.22em] mb-4">{s.tag}</div>
                <h3 className="text-3xl md:text-5xl font-medium tracking-[-0.035em] leading-[1.02] max-w-[20ch]">
                  {s.headline}
                </h3>
                <p className="mt-5 text-base md:text-lg text-[#f1eee7]/70 leading-relaxed max-w-[58ch]">
                  {s.subline}
                </p>
                {s.proof && (
                  s.proof.href ? (
                    <a href={s.proof.href} target="_blank" rel="noopener noreferrer"
                      className="mt-5 inline-block text-xs font-mono uppercase tracking-[0.18em] text-[#FDDA24] underline underline-offset-4 hover:opacity-80">
                      {s.proof.label} ↗
                    </a>
                  ) : (
                    <div className="mt-5 text-xs font-mono uppercase tracking-[0.18em] text-[#f1eee7]/45">
                      {s.proof.label}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>

        {/* controls: progress + dots + arrows */}
        <div className="mt-10 flex items-center gap-5">
          <div className="flex gap-2">
            {slides.map((_, idx) => (
              <button
                key={idx}
                aria-label={`moat ${idx + 1}`}
                onClick={() => go(idx)}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: idx === i ? 28 : 8,
                  background: idx === i ? "#FDDA24" : "rgba(241,238,231,0.25)",
                }}
              />
            ))}
          </div>
          <div className="flex-1 h-px bg-[#f1eee7]/10 relative overflow-hidden">
            <div
              key={`${i}-${paused}`}
              className="absolute inset-y-0 left-0 bg-[#FDDA24]/60"
              style={{
                width: "100%",
                transform: "translateX(-100%)",
                animation: paused ? "none" : `moatfill ${interval}ms linear forwards`,
              }}
            />
          </div>
          <div className="flex gap-2 font-mono text-sm">
            <button onClick={() => go(i - 1)} aria-label="previous" className="opacity-50 hover:opacity-100 transition-opacity">←</button>
            <button onClick={() => go(i + 1)} aria-label="next" className="opacity-50 hover:opacity-100 transition-opacity">→</button>
          </div>
        </div>
      </div>

      <style>{`@keyframes moatfill { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
    </div>
  );
}
