import { useEffect, useState } from "react";

// Live ledger — the hero centerpiece. A dark, premium card that streams plain,
// verifiable entries (each links to stellar.expert). Pure React + CSS: no WebGL,
// no external import. The "alive" feel is the streaming + a real wall clock; the
// substance is that every claim is public and checkable.

type Glyph = "ok";
type Entry = { tag: string; detail: string; glyph: Glyph; href?: string };

const _TX = "https://stellar.expert/explorer/public/tx/aa3304c93beffde1809ced4989b898cf419b8121e8ca9b50d01d407ccbf8326b";
const _CONTRACT = "https://stellar.expert/explorer/public/contract/CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN";

const ENTRIES: Entry[] = [
  { tag: "pagamento", detail: "chegou em 6 segundos", glyph: "ok", href: _TX },
  { tag: "na conta", detail: "direto, no seu nome", glyph: "ok", href: _CONTRACT },
  { tag: "taxa", detail: "2,97% · cartão leva ~8%", glyph: "ok" },
  { tag: "estorno", detail: "não existe aqui", glyph: "ok" },
  { tag: "espera", detail: "zero · é na hora", glyph: "ok" },
  { tag: "tudo público", detail: "qualquer um confere", glyph: "ok", href: _CONTRACT },
];

const VISIBLE = 5;

function clock(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function LiveLedger() {
  const [start, setStart] = useState(0);
  const [now, setNow] = useState(() => clock(new Date()));

  useEffect(() => {
    const stream = setInterval(() => setStart((s) => (s + 1) % ENTRIES.length), 2600);
    const tick = setInterval(() => setNow(clock(new Date())), 1000);
    return () => { clearInterval(stream); clearInterval(tick); };
  }, []);

  const rows = Array.from({ length: VISIBLE }, (_, i) => {
    const idx = (start + i) % ENTRIES.length;
    return { ...ENTRIES[idx]!, pos: i, key: `${start}-${idx}` };
  });

  return (
    <div className="w-full max-w-[480px] mx-auto md:ml-auto md:mr-0 rounded-[1.5rem] bg-[#0a0a0a] text-[#f1eee7] overflow-hidden ring-1 ring-[#f1eee7]/10 shadow-[0_36px_90px_-28px_rgba(10,10,10,0.6)]">
      {/* top accent line */}
      <div className="h-[3px] w-full bg-gradient-to-r from-[#FDDA24] via-[#FDDA24]/40 to-transparent" />

      {/* header */}
      <div className="flex items-center justify-between px-5 md:px-6 py-4 border-b border-[#f1eee7]/10">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/60">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FDDA24] animate-pulse" />
          slippay · ao vivo
        </div>
        <div className="font-mono text-[10px] tabular-nums tracking-[0.18em] text-[#f1eee7]/40">{now}</div>
      </div>

      {/* stream */}
      <div className="px-5 md:px-6 py-3 font-mono">
        {rows.map((r) => {
          const op = 1 - r.pos * 0.17;
          const inner = (
            <div className="flex items-baseline gap-3 py-[9px]" style={{ opacity: op }}>
              <span className="w-3 shrink-0 text-xs leading-none text-[#FDDA24]">✓</span>
              <span className="w-[88px] shrink-0 text-[10px] uppercase tracking-[0.18em] text-[#f1eee7]/45">{r.tag}</span>
              <span className="flex-1 min-w-0 truncate text-[11px] md:text-xs tracking-tight text-[#f1eee7]/90">{r.detail}</span>
              {r.href && <span className="shrink-0 text-[10px] text-[#f1eee7]/30">↗</span>}
            </div>
          );
          return (
            <div key={r.key} className={r.pos === 0 ? "animate-[ledger-in_500ms_cubic-bezier(0.22,1,0.36,1)]" : ""}>
              {r.href ? (
                <a href={r.href} target="_blank" rel="noopener noreferrer" className="block hover:bg-[#f1eee7]/[0.04] -mx-2 px-2 rounded-lg transition-colors">
                  {inner}
                </a>
              ) : inner}
            </div>
          );
        })}
      </div>

      {/* footer */}
      <div className="px-5 md:px-6 py-3.5 border-t border-[#f1eee7]/10 font-mono text-[9px] uppercase tracking-[0.18em] text-[#f1eee7]/45 flex items-center justify-between">
        <span>tudo é público · confira você mesmo</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FDDA24] animate-pulse" /> ao vivo</span>
      </div>
    </div>
  );
}
