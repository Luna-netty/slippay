// Apple-grade Face ID scan animation for /pay. Decorative: it visualizes the
// authorization moment (the real WebAuthn prompt is the OS modal). `scanning`
// sweeps a line over a face glyph inside corner brackets; `done` morphs to a
// check and pulses. Honors prefers-reduced-motion via CSS (animations are short
// and non-essential).
export function FaceScan({ state }: { state: "scanning" | "done" }) {
  const accent = state === "done" ? "#A16207" : "#0a0a0a";
  return (
    <div className="grid place-items-center py-2">
      <div className="relative w-[120px] h-[120px]">
        {/* corner brackets */}
        <svg viewBox="0 0 120 120" className="absolute inset-0 w-full h-full" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round">
          <path d="M10 34 V16 a6 6 0 0 1 6-6 H34" />
          <path d="M86 10 H104 a6 6 0 0 1 6 6 V34" />
          <path d="M110 86 V104 a6 6 0 0 1 -6 6 H86" />
          <path d="M34 110 H16 a6 6 0 0 1 -6 -6 V86" />
        </svg>

        {/* face glyph */}
        <svg viewBox="0 0 120 120" className="absolute inset-0 w-full h-full" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" style={{ opacity: state === "done" ? 0 : 1, transition: "opacity .25s" }}>
          <circle cx="46" cy="50" r="3.2" fill={accent} stroke="none" />
          <circle cx="74" cy="50" r="3.2" fill={accent} stroke="none" />
          <path d="M60 48 V64" />
          <path d="M48 78 q12 9 24 0" />
        </svg>

        {/* scanning line */}
        {state === "scanning" && (
          <div className="absolute left-[12px] right-[12px] h-[2px] rounded-full fs-scan"
            style={{ background: "linear-gradient(90deg,transparent,#A16207,transparent)", boxShadow: "0 0 12px #A16207" }} />
        )}

        {/* success check */}
        {state === "done" && (
          <svg viewBox="0 0 120 120" className="absolute inset-0 w-full h-full fs-pop" fill="none" stroke="#A16207" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M38 62 L54 78 L84 44" />
          </svg>
        )}
      </div>

      <style>{`
        @keyframes fsScan { 0%{top:14px;opacity:0} 12%{opacity:1} 88%{opacity:1} 100%{top:104px;opacity:0} }
        .fs-scan { top:14px; animation: fsScan 1.5s cubic-bezier(.5,0,.5,1) infinite; }
        @keyframes fsPop { 0%{transform:scale(.6);opacity:0} 60%{transform:scale(1.08)} 100%{transform:scale(1);opacity:1} }
        .fs-pop { animation: fsPop .45s cubic-bezier(.2,.8,.2,1) both; }
        @media (prefers-reduced-motion: reduce){ .fs-scan{animation:none;top:60px} .fs-pop{animation:none} }
      `}</style>
    </div>
  );
}
