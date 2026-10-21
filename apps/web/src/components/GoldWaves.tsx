// Flowing gold line-art — hand-written canvas, no lib. Thin gold STROKE waves
// (not filled areas, which turn to a low-contrast smudge on bone), drifting like
// silk threads / an audio waveform. Premium, defined. Killed under reduced-motion.

import { useEffect, useRef } from "react";

const N = 14;                 // number of thread lines
const GOLD = "253,218,36";    // brand gold rgb

export function GoldWaves({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0, h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const drawFrame = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < N; i++) {
        const p = i / (N - 1);                 // 0..1 across the band
        const baseY = h * (0.18 + p * 0.64);
        const amp = 26 + 40 * Math.sin(p * Math.PI);   // fatter in the middle
        const speed = 0.00018 + p * 0.00012;
        const phase = p * 6.0;
        // fade lines toward the edges of the band for a soft "beam"
        const alpha = 0.10 + 0.28 * Math.sin(p * Math.PI);
        ctx.strokeStyle = `rgba(${GOLD},${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 5) {
          const y = baseY
            + amp * Math.sin(x * 0.0016 + t * speed + phase)
            + amp * 0.45 * Math.sin(x * 0.0041 + t * speed * 1.8 + phase * 1.3);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { drawFrame(0); ro.disconnect(); return; }

    let raf = 0;
    const loop = (t: number) => { drawFrame(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
