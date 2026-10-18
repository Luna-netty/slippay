// /verify — re-verify a SlipPay proof-carrying certificate in YOUR browser.
// No install, no z3 to set up, nothing sent anywhere. This is what turns
// "machine-proved" from a slide claim into a third-party-checkable fact: the
// spec→cert binding is re-hashed locally, the cert's coherence is checked, and
// the EXACT SMT-LIB proof obligations axlc discharged are regenerated and shown
// (copy-runnable in any z3). z3-wasm auto-run is the next layer.

import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo.tsx";
import { reverifyCert, type ReverifyResult } from "../lib/axlVerify.ts";

const EXAMPLE_SPEC = "agent AgentWallet {\n  bind      -> [read_balance, propose_payment]\n  invariant -> sliding_window(ceiling = 2) bound 2\n}\n";
const EXAMPLE_CERT = `{
  "kind": "axl-proof-certificate",
  "axl_version": "0.1.0",
  "spec_sha256": "0415df303eb4abf45bc224df6b2d147d1a53933130fccd9889054aff8e35e3be",
  "agent": "AgentWallet",
  "invariant": { "family": "sliding_window", "ceiling": 2, "bound": 2 },
  "verdict": "ISSUED",
  "tight": true,
  "onchain": {
    "ssl_hash": "0415df303eb4abf45bc224df6b2d147d1a53933130fccd9889054aff8e35e3be",
    "window_cap_multiplier": 2,
    "claim": "real-time window outflow <= 2 * window_cap",
    "matches_deployed_enforcement": true
  }
}`;

export default function Verify() {
  const [cert, setCert] = useState(EXAMPLE_CERT);
  const [spec, setSpec] = useState(EXAMPLE_SPEC);
  const [res, setRes] = useState<ReverifyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (c: string, s: string) => {
    setBusy(true);
    try { setRes(await reverifyCert(c, s)); } finally { setBusy(false); }
  }, []);

  useEffect(() => { run(EXAMPLE_CERT, EXAMPLE_SPEC); }, [run]);

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain overflow-x-hidden">
      <header className="px-5 md:px-10 py-5 flex items-center justify-between border-b border-[#0a0a0a]/8">
        <Logo />
        <Link to="/" className="text-[10px] uppercase tracking-[0.22em] hover:opacity-60">Home</Link>
      </header>

      <main className="max-w-[920px] mx-auto px-5 md:px-10 pt-12 pb-24">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-5">┃ re-verify the proof</div>
        <h1 className="text-4xl md:text-6xl font-medium tracking-[-0.04em] leading-[0.98] max-w-[16ch]">
          Don’t trust us. Re-check it.
        </h1>
        <p className="mt-6 text-base text-[#0a0a0a]/75 leading-relaxed max-w-[60ch]">
          Paste a SlipPay certificate and the agent spec it covers. Everything below runs
          <strong className="text-[#0a0a0a]"> in your browser</strong> — nothing is sent anywhere. The proof
          is an object you verify, not a claim you take.
        </p>

        <div className="mt-10 grid md:grid-cols-2 gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-2">certificate (JSON)</div>
            <textarea value={cert} onChange={(e) => setCert(e.target.value)} spellCheck={false}
              className="w-full h-44 bg-[#0a0a0a] text-[#FDDA24] font-mono text-xs p-4 resize-y outline-none" />
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-2">agent spec (.axl)</div>
            <textarea value={spec} onChange={(e) => setSpec(e.target.value)} spellCheck={false}
              className="w-full h-44 bg-[#0a0a0a] text-[#f1eee7] font-mono text-xs p-4 resize-y outline-none" />
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <button onClick={() => run(cert, spec)} disabled={busy}
            className="lift px-6 py-3 bg-[#0a0a0a] text-[#f1eee7] text-[11px] uppercase tracking-[0.22em] disabled:opacity-40">
            {busy ? "checking…" : "Re-verify in my browser"}
          </button>
          <button onClick={() => { setCert(EXAMPLE_CERT); setSpec(EXAMPLE_SPEC); run(EXAMPLE_CERT, EXAMPLE_SPEC); }}
            className="lift px-6 py-3 border border-[#0a0a0a]/25 text-[11px] uppercase tracking-[0.22em] hover:border-[#0a0a0a]">
            Reset example
          </button>
        </div>

        {res && (
          <>
            <div className="mt-8 p-4 border-2" style={{ borderColor: res.allGreen ? "#3f7d20" : "#a11" }}>
              <div className="text-lg font-medium" style={{ color: res.allGreen ? "#3f7d20" : "#a11" }}>
                {res.allGreen ? "✓ Re-verified in your browser — binding + coherence hold." : "✗ Verification failed — see below."}
              </div>
              <p className="text-xs text-[#0a0a0a]/60 mt-1">
                Hash + structural checks ran locally. The proof obligations below are the exact theorems the compiler discharged.
              </p>
            </div>

            <div className="mt-6 space-y-2">
              {res.checks.map((c, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="font-mono mt-0.5" style={{ color: c.ok ? "#3f7d20" : "#a11" }}>{c.ok ? "✓" : "✗"}</span>
                  <div>
                    <span className="font-medium">{c.label}</span>
                    <span className="text-[#0a0a0a]/55 font-mono text-xs"> · {c.detail}</span>
                  </div>
                </div>
              ))}
            </div>

            {res.obligations.length > 0 && (
              <div className="mt-10">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-3">
                  ┃ the exact theorems discharged ({res.obligations.length})
                </div>
                <p className="text-xs text-[#0a0a0a]/60 mb-4 max-w-[64ch]">
                  These are byte-for-byte the SMT-LIB obligations the proof ran. Paste any into z3
                  (<span className="font-mono">z3 -in</span>) and you’ll get the verdict shown — or wait for the in-browser
                  z3 (next). “unsat” on the inductive step = the bound is sound for every reachable state.
                </p>
                <div className="space-y-3">
                  {res.obligations.map((o, i) => (
                    <details key={i} className="border border-[#0a0a0a]/15">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-medium flex items-center justify-between">
                        <span>{o.name}</span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#FDDA24] bg-[#0a0a0a] px-2 py-1">expect {o.expect}</span>
                      </summary>
                      <pre className="bg-[#0a0a0a] text-[#FDDA24] font-mono text-[11px] p-4 overflow-x-auto whitespace-pre">{o.smt}</pre>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <p className="mt-12 text-xs text-[#0a0a0a]/45 leading-relaxed max-w-[64ch]">
          This is what “proof-carrying” means: the spending bound isn’t a number we typed — it’s a theorem,
          and the certificate lets a third party re-check it without trusting us. The spec→certificate hash
          binding runs entirely in your browser; tamper with either and it goes red.
        </p>
      </main>
    </div>
  );
}
