// Animated replay of the adversarial audit. The data is NOT transcribed here —
// it is imported verbatim from src/data/audit_report.json, the machine-readable
// artifact emitted by ~/ai-security/agents/slippay_contract_redteam.sh on a real
// run against the contract on Stellar testnet. The demo animates the document;
// it does not animate a memory of the document. Re-run the harness → regenerate
// the json → the demo updates. (Honesty: testnet — where the v0.3 attestation
// gate lives; mainnet is v0.2 until the v0.3 redeploy.)

import { useEffect, useState } from "react";
import report from "../data/audit_report.json";

const EXPLORER = report.network === "public"
  ? `https://stellar.expert/explorer/public/contract/${report.contract}`
  : `https://stellar.expert/explorer/testnet/contract/${report.contract}`;

// Plain-English label per attack — no error codes, no jargon. Falls back to the
// raw name for anything not mapped.
const HUMAN: Record<string, string> = {
  CTRL: "a normal, approved charge",
  A1: "tries to charge twice, too soon",
  A3: "tries to charge with no approval set",
  A4: "uses a forged approval",
  A5: "uses an expired approval",
  A6: "reuses an approval from another plan",
};

const ROWS = report.findings.map((f) => {
  const m = f.attack.match(/^([A-Z0-9]+|CONTROL)/);
  const tag = m && m[1] ? (m[1] === "CONTROL" ? "CTRL" : m[1]) : "—";
  const control = /control/i.test(f.attack);
  const raw = f.attack.replace(/^(CONTROL:\s*|[A-Z0-9]+\s+)/, "").replace(/\s*settles$/i, "");
  return { tag, name: HUMAN[tag] ?? raw, held: f.result === "HELD", control };
});

export function AuditDemo() {
  const [shown, setShown] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    setShown(0);
    const id = setInterval(() => {
      setShown((n) => { if (n >= ROWS.length) { clearInterval(id); return n; } return n + 1; });
    }, 700);
    return () => clearInterval(id);
  }, [run]);

  const done = shown >= ROWS.length;

  return (
    <section className="border-t border-[#0a0a0a]/8">
      <div className="max-w-[1080px] mx-auto px-5 md:px-10 py-24">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-4">
          ┃ the rail attacks itself
        </div>
        <h2 className="text-3xl md:text-5xl font-medium tracking-[-0.03em] max-w-[18ch]">
          We attack our own contract. It blocks every one.
        </h2>
        <p className="mt-6 text-[#0a0a0a]/70 leading-relaxed max-w-[56ch] text-lg">
          We fire real attacks at SlipPay — a forged approval, a reused one, a double charge, a
          skipped limit. Every single one is blocked, on-chain. You don’t have to trust us: run the
          same audit yourself against a public address. Proof, not a promise.
        </p>
        <div className="mt-6 max-w-[56ch] text-[14px] text-[#0a0a0a]/50 leading-relaxed">
          Honest scope: the billing rail is live on mainnet; this safety audit runs on testnet, where the gate ships to mainnet next.
        </div>

        <div className="mt-10 bg-[#0a0a0a] text-[#f1eee7] font-mono text-[12px] md:text-[13px] leading-relaxed p-6 md:p-8 overflow-x-auto">
          <div className="text-[#f1eee7]/45">$ {report.harness} — adversarial audit</div>
          <div className="text-[#f1eee7]/45 mb-4">
            target: {report.contract.slice(0, 10)}… · stellar {report.network} · {report.generated_at}
          </div>
          {ROWS.map((r, i) => (
            <div
              key={r.tag + i}
              className="flex flex-wrap items-baseline gap-x-3 transition-all duration-500"
              style={{ opacity: i < shown ? 1 : 0, transform: i < shown ? "none" : "translateY(4px)" }}
            >
              <span className="text-[#f1eee7]/50">[{r.tag}]</span>
              <span className="text-[#f1eee7]/85">{r.name}</span>
              <span className={`px-1.5 ${r.held ? "bg-white text-[#0a0a0a]" : "border border-white/50 text-white/70"}`}>
                {r.control ? "allowed ✓" : r.held ? "blocked ✓" : "got through ✗"}
              </span>
            </div>
          ))}
          <div
            className="mt-5 pt-4 border-t border-[#f1eee7]/15 transition-opacity duration-700"
            style={{ opacity: done ? 1 : 0 }}
          >
            <span className="text-white">VERDICT</span>{" "}
            <span className="text-[#f1eee7]/85">
              {report.summary.held} attacks · {report.summary.held - report.summary.broke} blocked · {report.summary.broke} got through.
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            onClick={() => setRun((x) => x + 1)}
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 hover:text-[#0a0a0a] border-b border-transparent hover:border-[#0a0a0a]"
          >
            ↻ replay
          </button>
          <a href={EXPLORER} target="_blank" rel="noreferrer"
             className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 hover:text-[#0a0a0a] border-b border-transparent hover:border-[#0a0a0a]">
            audited contract · testnet ↗
          </a>
          <a href="https://stellar.expert/explorer/public/tx/5da9741f554294a196376088ebd8f753f466a03cf657e67248533d78e0e3edf6"
             target="_blank" rel="noreferrer"
             className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 hover:text-[#0a0a0a] border-b border-transparent hover:border-[#0a0a0a]">
            real mainnet charge ↗
          </a>
        </div>
      </div>
    </section>
  );
}
