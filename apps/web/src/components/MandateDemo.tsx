// Live, self-explanatory recurring-payment demo for the hero. Animates one
// recurring payment: approve once → it charges itself → settles → public proof,
// looping each cycle, accumulating against a limit — and STOPPING when the limit
// is reached (the safety, shown not told). Plain language, bilingual. Honors
// reduced-motion (renders the finished state, no animation). The link at the
// bottom is the actual mainnet tx (0.05 USDC); the cycling above illustrates the
// mechanism — labelled "demo" so it's never mistaken for live settlement.

import { useEffect, useState } from "react";

type Lang = "pt" | "en";

const T = {
  pt: {
    tag: "pagamento que se repete · demo", atCap: "no limite", active: "ativo", running: "rodando…",
    spent: "gasto no período", reached: "limite atingido, não tira nem mais um centavo ✓",
    cycle: (n: number) => `ciclo ${n} · dentro do limite`, real: "cobrança real · concluída · $0,05", replay: "clique pra repetir",
    steps: [
      ["Aprove com um toque", "uma vez · sem senha · você define o limite"],
      ["Ele cobra sozinho", "tira $0,05 · sem te pedir de novo"],
      ["Cai na hora", "~5s · taxa menor que 1 centavo"],
      ["Prova pública", "qualquer um pode conferir"],
    ] as [string, string][],
  },
  en: {
    tag: "recurring payment · demo", atCap: "at limit", active: "active", running: "running…",
    spent: "spent this period", reached: "limit reached, won't pull another cent ✓",
    cycle: (n: number) => `cycle ${n} · within limit`, real: "real charge · settled · $0.05", replay: "click to replay",
    steps: [
      ["Approve with one touch", "once · no password · you set the limit"],
      ["It charges itself", "pulls $0.05 · never asks again"],
      ["Settles instantly", "~5s · fee under 1 cent"],
      ["Public proof", "anyone can verify it"],
    ] as [string, string][],
  },
} as const;

const CAP = 0.2;
const CHARGE = 0.05;
const TX = "https://stellar.expert/explorer/public/tx/5da9741f554294a196376088ebd8f753f466a03cf657e67248533d78e0e3edf6";
const GOLD = "#6f6862";

const reduceMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function MandateDemo({ lang = "pt" }: { lang?: Lang }) {
  const t = T[lang];
  const STEPS = t.steps;
  const reduce = reduceMotion();
  const [active, setActive] = useState(reduce ? 3 : 0);
  const [charges, setCharges] = useState(reduce ? CAP / CHARGE : 0);
  const [capped, setCapped] = useState(reduce);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (reduce) return;
    setActive(0);
    setCharges(0);
    setCapped(false);
    let step = 0;
    let done = 0;
    const id = setInterval(() => {
      step += 1;
      if (step <= 3) {
        setActive(step);
        return;
      }
      done += 1;
      setCharges(done);
      if (done * CHARGE >= CAP - 1e-9) {
        setCapped(true);
        clearInterval(id);
        return;
      }
      step = 1;
      setActive(1);
    }, 1050);
    return () => clearInterval(id);
  }, [run, reduce]);

  const spent = +(charges * CHARGE).toFixed(2);
  const pct = Math.min(100, (spent / CAP) * 100);

  return (
    <button
      onClick={() => setRun((x) => x + 1)}
      className="block w-full text-left text-[#0a0a0a] border border-[#0a0a0a]/20 rounded-2xl p-8 bg-white shadow-[0_18px_50px_-24px_rgba(10,10,10,0.30)] cursor-pointer"
      aria-label={t.replay}
    >
      <div className="flex items-center justify-between mb-7">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/45">{t.tag}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/45 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />
          {capped ? t.atCap : t.active}
        </span>
      </div>

      {STEPS.map(([title, d], i) => {
        const isActive = !capped && i === active;
        const isDone = capped || i < active || (charges > 0 && i >= 1);
        return (
          <div key={title} className="relative flex gap-4 pb-7 last:pb-0">
            {i < STEPS.length - 1 && <span className="absolute left-[10px] top-6 bottom-0 w-px bg-[#0a0a0a]/15" />}
            <span
              className="relative shrink-0 w-[21px] h-[21px] rounded-full flex items-center justify-center font-mono text-[9px] transition-colors duration-300"
              style={{
                background: isActive ? GOLD : isDone ? "#0a0a0a" : "#fff",
                color: isActive ? "#0a0a0a" : isDone ? "#fff" : "#0a0a0a",
                borderWidth: 1,
                borderStyle: "solid",
                borderColor: isActive || isDone ? "transparent" : "rgba(10,10,10,0.30)",
                boxShadow: isActive ? `0 0 0 5px ${GOLD}33` : "none",
              }}
            >
              {isDone && !isActive ? "✓" : i + 1}
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold leading-tight flex items-center gap-2">
                {title}
                {isActive && <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#0a0a0a]/40">{t.running}</span>}
              </div>
              <div className="font-mono text-[11px] text-[#0a0a0a]/50 mt-1">{d}</div>
            </div>
          </div>
        );
      })}

      {/* the limit meter — the safety, shown */}
      <div className="mt-2 mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">
        <span>{t.spent}</span>
        <span>${spent.toFixed(2)} / ${CAP.toFixed(2)}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-[#0a0a0a]/10 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: GOLD }} />
      </div>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] h-4" style={{ color: capped ? "#0a0a0a" : "rgba(10,10,10,0.45)" }}>
        {capped ? t.reached : t.cycle(Math.max(1, charges))}
      </div>

      <span
        onClick={(e) => { e.stopPropagation(); window.open(TX, "_blank", "noopener"); }}
        className="mt-5 flex items-center justify-between border-t border-[#0a0a0a]/10 pt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]"
      >
        <span>{t.real}</span>
        <span>tx 5da9741f ↗</span>
      </span>

      <div className="mt-3 font-mono text-[9px] uppercase tracking-[0.18em] text-[#0a0a0a]/30">{t.replay}</div>
    </button>
  );
}
