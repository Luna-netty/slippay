// Hand-drawn sketches spread across the landing — charming, almost-childlike, but
// precise. Pure inline SVG (no CDN). The hand-drawn wobble is a feTurbulence +
// feDisplacementMap filter applied to clean stroke paths. `tone` switches stroke
// color for light vs dark sections. Accent = KLEIN-green (#FDDA24).

type Name =
  | "plan" | "approve" | "recurring"
  | "nochargeback" | "fee" | "fast" | "noncustodial" | "agent" | "verify"
  | "mcp" | "shield";

const ACCENT = "#FDDA24";

function Wobble({ id }: { id: string }) {
  return (
    <filter id={id} x="-25%" y="-25%" width="150%" height="150%">
      <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed={id.length} result="n" />
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  );
}

export function Sketch({ name, tone = "light", size = 76 }: { name: Name; tone?: "light" | "dark"; size?: number }) {
  const fid = `sk-${name}-${tone}`;
  const STROKE = tone === "dark" ? "#f1eee7" : "#0a0a0a";
  const c = { fill: "none", stroke: STROKE, strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const a = { ...c, stroke: ACCENT, strokeWidth: 3 };
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-hidden="true">
      <Wobble id={fid} />
      <g filter={`url(#${fid})`}>
        {name === "plan" && (<>
          <path d="M30 18 h34 a4 4 0 0 1 4 4 v52 a4 4 0 0 1 -4 4 h-34 a4 4 0 0 1 -4 -4 v-52 a4 4 0 0 1 4 -4 z" {...c} />
          <path d="M38 34 h24 M38 46 h24 M38 58 h14" {...c} />
          <path d="M52 24 v-8" {...a} /><circle cx="52" cy="14" r="3" {...a} />
        </>)}
        {name === "approve" && (<>
          <path d="M22 64 q10 -14 20 -4 q8 8 16 -6 q5 -8 12 -2" {...c} />
          <path d="M30 78 h40" {...c} />
          <path d="M60 30 l7 8 l14 -18" {...a} />
        </>)}
        {name === "recurring" && (<>
          <circle cx="44" cy="50" r="22" {...c} /><path d="M44 50 v-12 M44 50 l10 6" {...c} />
          <path d="M70 30 a26 26 0 0 1 4 30" {...a} /><path d="M70 60 l5 2 l1 -6" {...a} />
          <circle cx="74" cy="76" r="9" {...a} /><path d="M74 71 v10 M71 74 h6" {...a} />
        </>)}
        {name === "nochargeback" && (<>
          {/* a clawback arrow, struck out — money doesn't come back */}
          <path d="M64 40 h-26 a10 10 0 0 0 0 20 h10" {...c} />
          <path d="M50 48 l-12 -8 l12 -8" {...c} />
          <path d="M24 26 l52 52" {...a} />
        </>)}
        {name === "fee" && (<>
          {/* a coin with a tiny slice taken — a fraction */}
          <circle cx="50" cy="50" r="26" {...c} />
          <path d="M50 24 a26 26 0 0 1 18 8 l-18 18 z" {...a} />
          <path d="M44 44 h12 M44 56 h12 M50 38 v24" {...c} />
        </>)}
        {name === "fast" && (<>
          {/* a lightning bolt + speed lines — paid in seconds */}
          <path d="M52 18 l-16 30 h14 l-8 24 28 -34 h-14 z" {...a} />
          <path d="M20 40 h12 M16 54 h16 M22 68 h10" {...c} />
        </>)}
        {name === "noncustodial" && (<>
          {/* a key in an open hand — you hold the keys */}
          <circle cx="38" cy="40" r="9" {...a} /><path d="M44 46 l16 16 M54 56 l6 6 M58 52 l6 6" {...a} />
          <path d="M24 70 q6 -6 14 -4 q10 2 18 -2" {...c} /><path d="M22 70 v6 q0 4 4 4 h30 q4 0 4 -4 v-2" {...c} />
        </>)}
        {name === "agent" && (<>
          {/* a friendly little robot — works for agents too */}
          <rect x="32" y="38" width="36" height="28" rx="6" {...c} />
          <circle cx="43" cy="52" r="3.5" {...a} /><circle cx="57" cy="52" r="3.5" {...a} />
          <path d="M50 38 v-8" {...c} /><circle cx="50" cy="26" r="3" {...a} />
          <path d="M32 50 h-6 M68 50 h6 M40 66 v8 M60 66 v8" {...c} />
        </>)}
        {name === "verify" && (<>
          {/* a magnifier with a check — every charge is verifiable */}
          <circle cx="44" cy="44" r="18" {...c} /><path d="M58 58 l16 16" {...c} />
          <path d="M36 44 l6 7 l11 -14" {...a} />
        </>)}
        {name === "mcp" && (<>
          {/* a plug / one-paste connector */}
          <path d="M40 30 v14 M60 30 v14" {...c} />
          <rect x="32" y="44" width="36" height="16" rx="4" {...c} />
          <path d="M50 60 v12 a8 8 0 0 1 -8 8 h-4" {...a} />
        </>)}
        {name === "shield" && (<>
          {/* a shield with a check — the gate refuses a compromised agent */}
          <path d="M50 20 l24 8 v18 q0 22 -24 34 q-24 -12 -24 -34 v-18 z" {...c} />
          <path d="M40 50 l7 8 l14 -18" {...a} />
        </>)}
      </g>
    </svg>
  );
}
