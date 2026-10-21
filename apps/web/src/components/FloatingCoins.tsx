// Floating USDC coins — real DOM objects with Motion spring physics (not a
// hand-drawn canvas smudge). A few large metallic gold coins drift + slowly spin
// in 3D on the right of the hero, with depth blur. Calm, expensive, not a coin
// rain. Respects reduced-motion (renders them static).

import { motion, useReducedMotion } from "motion/react";

const COINS = [
  { size: 168, x: "58%", y: "10%", dur: 13, delay: 0.4, blur: 0 },
  { size: 124, x: "82%", y: "46%", dur: 11, delay: 1.6, blur: 0.5 },
  { size: 96,  x: "40%", y: "62%", dur: 10, delay: 0.9, blur: 1.5 },
  { size: 64,  x: "70%", y: "78%", dur: 12, delay: 2.2, blur: 2 },
  { size: 54,  x: "30%", y: "22%", dur: 9,  delay: 1.2, blur: 2.5 },
];

function Coin({ size, blur }: { size: number; blur: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%",
        background: "radial-gradient(circle at 32% 26%, #fff7d6 0%, #FDDA24 46%, #cf9f14 100%)",
        boxShadow:
          "inset 0 -7px 16px rgba(150,104,8,0.45), inset 0 5px 12px rgba(255,255,255,0.7), 0 14px 34px rgba(207,159,20,0.30)",
        filter: blur ? `blur(${blur}px)` : undefined,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, color: "rgba(120,82,6,0.4)", fontSize: size * 0.36,
        fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "-0.02em",
        userSelect: "none",
      }}
    >$</div>
  );
}

export function FloatingCoins({ className = "" }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={className} aria-hidden>
      {COINS.map((c, i) => (
        <motion.div
          key={i}
          style={{ position: "absolute", left: c.x, top: c.y, transformStyle: "preserve-3d" }}
          animate={reduce ? undefined : { y: [0, -24, 0], x: [0, 12, 0], rotateY: [0, 360] }}
          transition={reduce ? undefined : { duration: c.dur, delay: c.delay, repeat: Infinity, ease: "easeInOut" }}
        >
          <Coin size={c.size} blur={c.blur} />
        </motion.div>
      ))}
    </div>
  );
}
