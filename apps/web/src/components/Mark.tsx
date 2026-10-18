// SlipMark — three minimalist sea waves: flow, money moving. Black & white
// (currentColor, inverts on dark). Balanced spacing, graceful amplitude.

export function Mark({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 10.5 q2.875 -2.6 5.75 0 t5.75 0 t5.75 0 t5.75 0" />
      <path d="M4.5 16 q2.875 -2.6 5.75 0 t5.75 0 t5.75 0 t5.75 0" />
      <path d="M4.5 21.5 q2.875 -2.6 5.75 0 t5.75 0 t5.75 0 t5.75 0" />
    </svg>
  );
}
