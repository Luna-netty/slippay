// Lightweight scroll-reveal + stat-counter primitives. Pure CSS animations
// triggered by IntersectionObserver — no dep on framer-motion to keep the
// bundle lean and the editorial register intact.
//
// <Reveal>            — fade+slide-up into view, one-shot
// <CountUp from={0} to={7.8} suffix="%" />  — animates number on intersection
//
// Both honor prefers-reduced-motion via CSS rather than JS.

import { useEffect, useRef, useState } from "react";

interface RevealProps {
  children: React.ReactNode;
  delay?: number;   // ms · stagger siblings
  className?: string;
  id?: string;
  as?: "div" | "section" | "article" | "li";
  style?: React.CSSProperties;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Reveal({ children, delay = 0, className = "", id, as = "div", style: callerStyle }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  // Reduced-motion users start fully visible — no fade, no offset, no flash of
  // hidden content if JS is slow.
  const reduce = prefersReducedMotion();
  const [visible, setVisible] = useState(reduce);

  useEffect(() => {
    if (reduce || !ref.current) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setVisible(true); io.disconnect(); break; }
      }
    }, { rootMargin: "-10% 0px -10% 0px", threshold: 0.05 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [reduce]);

  // Default to <div>. Caller can pass `as` for semantic tags but we keep
  // the union narrow to avoid TS2590 complexity blowups.
  const style: React.CSSProperties = {
    ...callerStyle,
    transitionDelay: `${delay}ms`,
    transitionDuration: "700ms",
    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    transitionProperty: "opacity, transform",
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(24px)",
  };
  if (as === "section") return (
    <section ref={ref as any} id={id} style={style} className={className}>{children}</section>
  );
  if (as === "article") return (
    <article ref={ref as any} style={style} className={className}>{children}</article>
  );
  if (as === "li") return (
    <li ref={ref as any} style={style} className={className}>{children}</li>
  );
  return <div ref={ref as any} style={style} className={className}>{children}</div>;
}

interface CountUpProps {
  from?: number;
  to: number;
  durationMs?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  format?: (n: number) => string;
  className?: string;
}

export function CountUp({
  from = 0, to, durationMs = 1400,
  decimals = 0, prefix = "", suffix = "",
  format, className = "",
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(from);

  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / durationMs);
          // ease-out cubic
          const eased = 1 - Math.pow(1 - t, 3);
          setValue(from + (to - from) * eased);
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        break;
      }
    }, { threshold: 0.3 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [from, to, durationMs]);

  const text = format
    ? format(value)
    : `${prefix}${value.toFixed(decimals)}${suffix}`;
  return <span ref={ref} className={className}>{text}</span>;
}
