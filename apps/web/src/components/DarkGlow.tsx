// Reusable animated glow background for dark pages (the V3 ambient field).
// Renders the fixed glow orbs + grid + grain, and ships the CSS once. Drop it as
// the first child of a dark page; content sits above with position:relative z-1.

export function DarkGlow() {
  return (
    <div aria-hidden className="dg-bg">
      <style>{DARK_GLOW_CSS}</style>
      <div className="dg-glow dg-a" />
      <div className="dg-glow dg-b" />
      <div className="dg-grid" />
      <div className="dg-grain" />
    </div>
  );
}

const DARK_GLOW_CSS = `
.dg-bg{position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(120% 80% at 50% -10%,#101a30 0%,#0a0e1a 60%);}
.dg-glow{position:absolute;border-radius:50%;filter:blur(90px);opacity:.45;}
.dg-a{width:46vw;height:46vw;top:-12vw;right:-6vw;background:radial-gradient(circle,rgba(34,211,238,.4),transparent 70%);animation:dg-fa 22s ease-in-out infinite;}
.dg-b{width:40vw;height:40vw;bottom:-10vw;left:-8vw;background:radial-gradient(circle,rgba(56,189,248,.28),transparent 70%);animation:dg-fb 26s ease-in-out infinite;}
@keyframes dg-fa{0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(-4vw,4vw) scale(1.12);}}
@keyframes dg-fb{0%,100%{transform:translate(0,0) scale(1);}50%{transform:translate(5vw,-3vw) scale(1.1);}}
.dg-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(100% 60% at 50% 0%,#000 30%,transparent 80%);opacity:.5;}
.dg-grain{position:absolute;inset:0;opacity:.04;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
@media(prefers-reduced-motion:reduce){.dg-glow{animation:none;}}
`;
