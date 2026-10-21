// Count-up number that animates from 0 to `to` the first time it scrolls into
// view. Decorative only — respects prefers-reduced-motion (renders the final
// value immediately). Pass a `format` to control how the running number reads.
import { useEffect, useRef, useState } from "react";

export function CountUp({
  to,
  duration = 1200,
  format = (n: number) => Math.round(n).toLocaleString("pt-BR"),
  className,
}: {
  to: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [val, setVal] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setVal(to); return; }

    let raf = 0;
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        setVal(to * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
        else setVal(to);
      };
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        if (e.isIntersecting && !done.current) {
          done.current = true;
          run();
          io.unobserve(e.target);
        }
      }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to, duration]);

  return <span ref={ref} className={className}>{format(val)}</span>;
}
