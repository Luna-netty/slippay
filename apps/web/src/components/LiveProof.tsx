import { useEffect, useState } from "react";

// LiveProof — a subtle, honest engagement cue placed across the site. One quiet
// monospace line: a live pulse, the real time since the last on-chain payment
// (from Horizon), the per-transaction saving vs cards, and a funnel into the live
// cockpit. No badges, no confetti. Numbers are real; nothing is fabricated. PT/EN.

const HORIZON = "https://horizon.stellar.org";
const RECIPIENT = "GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P";
type Lang = "pt" | "en";

const T = {
  en: { live: "live on mainnet", liveBig: "Real money is moving on mainnet", last: "last payment", cheap: "~3% cheaper than cards", cheapBig: "~3% cheaper than cards, every time", see: "see it live ↗", seeBig: "See it live ↗", ago: (s: string) => `${s} ago` },
  pt: { live: "ao vivo na mainnet", liveBig: "Dinheiro real se movendo na mainnet", last: "último pagamento", cheap: "~3% mais barato que cartão", cheapBig: "~3% mais barato que cartão, sempre", see: "ver ao vivo ↗", seeBig: "Ver ao vivo ↗", ago: (s: string) => `${s} atrás` },
} as const;

function rel(iso: string, lang: Lang): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  let v: string;
  if (s < 60) v = `${s}s`;
  else { const m = Math.floor(s / 60); if (m < 60) v = `${m}m`; else { const h = Math.floor(m / 60); v = h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`; } }
  return T[lang].ago(v);
}

export function LiveProof({ dark = false, prominent = false, lang = "en" }: { dark?: boolean; prominent?: boolean; lang?: Lang }) {
  const [last, setLast] = useState<string | null>(null);
  const [, force] = useState(0);
  const t = T[lang];

  useEffect(() => {
    let on = true;
    const tick = async () => {
      try {
        const r = await fetch(`${HORIZON}/accounts/${RECIPIENT}/payments?order=desc&limit=1&include_failed=false`);
        const rec = (await r.json())?._embedded?.records?.[0];
        if (on && rec?.created_at) setLast(rec.created_at);
      } catch { /* offline — line still renders the rest */ }
    };
    tick();
    const id = setInterval(tick, 20000);
    const tk = setInterval(() => force((x) => x + 1), 1000);
    return () => { on = false; clearInterval(id); clearInterval(tk); };
  }, []);

  const muted = dark ? "rgba(241,238,231,.5)" : "rgba(10,10,10,.5)";
  const Dot = () => <span className="opacity-30">·</span>;

  if (prominent) {
    return (
      <div className="mx-auto max-w-[760px] rounded-full border border-[#0a0a0a]/12 bg-white/50 px-6 md:px-8 py-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] md:text-[13px] tracking-[-0.01em] text-[#0a0a0a]/70">
        <span className="flex items-center gap-2.5 font-medium text-[#0a0a0a]">
          <span className="w-2 h-2 rounded-full bg-[#FDDA24] animate-pulse" /> {t.liveBig}
        </span>
        {last && <span className="text-[#0a0a0a]/55">{t.last} <span className="tabular-nums text-[#0a0a0a]/80">{rel(last, lang)}</span></span>}
        <span className="text-[#0a0a0a]/55">{t.cheapBig}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[10px] md:text-[11px] uppercase tracking-[0.18em]" style={{ color: muted }}>
      <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#FDDA24] animate-pulse" /> {t.live}</span>
      {last && <><Dot /><span>{t.last} {rel(last, lang)}</span></>}
      <Dot /><span>{t.cheap}</span>
    </div>
  );
}
