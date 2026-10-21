// V3Ribbon — the shared "skin" background for SlipPay public pages.
// A fixed, full-bleed bone canvas + the animated gold silk ribbon
// (24 displaced strands) extracted from the approved LandingV3 hero.
// Sits at z-index:-1 behind all page content, so a page opts in by rendering
// <V3Ribbon /> once and making its own root background transparent.
// Self-contained: own scoped CSS (v3rb-*) + keyframes, honors reduced-motion.

const V3RB_CSS = `
.v3rb-bg{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;
  background:radial-gradient(120% 80% at 50% -10%,#faf8f3 0%,#f1eee7 60%);}
.v3rb-grid{position:absolute;inset:0;
  background-image:linear-gradient(rgba(10,10,10,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(10,10,10,.06) 1px,transparent 1px);
  background-size:64px 64px;mask-image:radial-gradient(100% 50% at 50% 0%,#000 20%,transparent 75%);opacity:.4;}
.v3rb-ribbon{position:absolute;top:46%;left:0;width:100%;height:52vh;}
.v3rb-ribbon svg{width:100%;height:100%;display:block;}
.v3rb-g1{animation:v3rb1 11s ease-in-out infinite;}
.v3rb-g2{animation:v3rb2 14s ease-in-out infinite;}
.v3rb-g3{animation:v3rb1 16s ease-in-out infinite reverse;}
@keyframes v3rb1{0%,100%{transform:translate(0,0) skewX(0deg);}50%{transform:translate(-58px,16px) skewX(-3deg);}}
@keyframes v3rb2{0%,100%{transform:translate(0,0) skewX(0deg);}50%{transform:translate(52px,-20px) skewX(3deg);}}
@media(max-width:768px){.v3rb-ribbon{height:34vh;top:48%;}.v3rb-g1,.v3rb-g2,.v3rb-g3{animation:none;}}
@media(prefers-reduced-motion:reduce){.v3rb-g1,.v3rb-g2,.v3rb-g3{animation:none;}}
`;

export function V3Ribbon() {
  return (
    <div className="v3rb-bg" aria-hidden>
      <style>{V3RB_CSS}</style>
      <div className="v3rb-grid" />
      <div className="v3rb-ribbon">
        <svg viewBox="0 0 1440 600" preserveAspectRatio="none">
          <defs>
            <linearGradient id="v3rbg" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#fde68a" /><stop offset="30%" stopColor="#fcd34d" /><stop offset="52%" stopColor="#FDDA24" /><stop offset="70%" stopColor="#fbbf24" /><stop offset="88%" stopColor="#f5b942" /><stop offset="100%" stopColor="#eaa520" />
            </linearGradient>
            <filter id="v3rbwarp" x="-20%" y="-70%" width="140%" height="240%">
              <feTurbulence type="fractalNoise" baseFrequency="0.008 0.013" numOctaves="2" seed="7" result="n" />
              <feDisplacementMap in="SourceGraphic" in2="n" scale="22" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
          {[0, 1, 2].map((g) => (
            <g key={g} className={`v3rb-g${g + 1}`} filter="url(#v3rbwarp)">
              {Array.from({ length: 8 }).map((_, i) => {
                const k = g * 8 + i;
                const off = (k - 11.5) * 5;
                const op = (0.3 + 0.45 * (1 - Math.abs(k - 11.5) / 11.5)).toFixed(2);
                return (
                  <path key={i} d={`M-200 ${300 + off} C 160 ${180 + off} 360 ${420 + off} 720 ${300 + off} S 1280 ${180 + off} 1640 ${300 + off}`}
                    fill="none" stroke="url(#v3rbg)" strokeWidth="3.6" strokeLinecap="round" opacity={op} />
                );
              })}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
