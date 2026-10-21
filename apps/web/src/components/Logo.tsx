import { Link } from "react-router-dom";

interface LogoProps {
  to?: string;
  variant?: "ink" | "bone";
  size?: "sm" | "md";
}

export function Logo({ to = "/", variant = "ink", size = "md" }: LogoProps) {
  // Integrity-seal mark — a bold ring (the seal) + geometric slip "S", with one
  // gold "verdict node" at 12 o'clock for the on-chain proof. Ring + S recolor
  // with the surface (ink on light, bone on dark); the gold punctum is constant.
  const fg = variant === "ink" ? "#0a0a0a" : "#f1eee7";
  const dim = size === "sm" ? 20 : 26;
  const text = size === "sm" ? "text-base" : "text-xl";
  const gap = size === "sm" ? "gap-2" : "gap-2.5";

  const inner = (
    <span className={`inline-flex items-center ${gap}`}>
      <svg width={dim} height={dim} viewBox="0 0 32 32" fill="none" className="block shrink-0" aria-hidden="true">
        {/* integrity seal — bold ring */}
        <circle cx="16" cy="16" r="12.6" stroke={fg} strokeWidth="3" />
        {/* the slip "S" — bold, geometric */}
        <path d="M20.8 11.3c-2.7-2.1-7.6-1.6-7.6 2.1 0 3.6 6.8 2.6 6.8 6.3 0 3.7-4.9 4.2-7.6 2.2"
              stroke={fg} strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round" />
        {/* verdict node — the single gold punctum (on-chain proof) */}
        <circle cx="16" cy="3.4" r="2.5" fill="#A16207" />
      </svg>
      <span className={`${text} tracking-[-0.04em] font-semibold leading-none`} style={{ color: fg }}>
        slippay
      </span>
    </span>
  );

  return to ? <Link to={to} className="inline-block">{inner}</Link> : inner;
}
