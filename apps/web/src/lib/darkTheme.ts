// Shared dark theme tokens (Secuury/V3 register). Every page migrated off the
// bone design imports these so the dark look is consistent, not re-invented per
// page. Deep navy canvas, white type, electric-cyan accent.
// Static tokens only — no toggle and no persistence; see
// docs/product/locale-strategy.md ("Theme: lib/darkTheme.ts has no persistence").

export const DARK = {
  bg: "#0a0e1a",
  bg2: "#0d1322",
  ink: "#f3f5fb",
  muted: "#8a93ad",
  cyan: "#22d3ee",
  cyan2: "#38bdf8",
  line: "rgba(255,255,255,0.08)",
  ok: "#34d399",
  leak: "#fb7185",
} as const;

// Common class fragments (Tailwind arbitrary values) reused across dark pages.
export const dk = {
  page: "min-h-screen bg-[#0a0e1a] text-[#f3f5fb]",
  panel: "bg-[#0d1322] border border-white/10 rounded-2xl",
  muted: "text-[#8a93ad]",
  accent: "text-[#22d3ee]",
  // gradient cyan CTA pill
  cta: "inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-[13px] font-bold tracking-[0.02em] text-[#04121a] bg-gradient-to-r from-[#22d3ee] to-[#38bdf8] transition-transform hover:-translate-y-0.5",
  // ghost / secondary action
  ghost: "inline-flex items-center gap-2 text-[13px] text-[#f3f5fb] border-b border-[#22d3ee] pb-0.5 opacity-85 hover:opacity-100 transition-opacity",
  // mono label
  label: "font-mono text-[10px] uppercase tracking-[0.22em] text-[#8a93ad]",
  // dark card with hover glow
  card: "bg-[#0d1322] border border-white/10 rounded-2xl p-7 transition-all hover:-translate-y-1 hover:border-[#22d3ee]/40",
} as const;

// The animated glow background block, as a reusable JSX-less marker. Pages render
// <DarkGlow/> from darkGlow.tsx; the CSS ships once via that component.
