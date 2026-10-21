// Anchor demo · /anchor-demo
// SEP-10 + SEP-24 deposit interactive against testanchor.stellar.org
//
// Flow visible to the user:
//   1. Generate (or load) a testnet buyer wallet
//   2. Fund it via friendbot if needed
//   3. Add USDC trustline so the anchor can pay USDC
//   4. SEP-10 authenticate · receive JWT
//   5. SEP-24 deposit interactive · open popup
//   6. Poll the anchor transaction until status=completed
//   7. Show USDC balance on the buyer wallet
//
// Editorial register matches the rest of the site: BONE bg, INK text,
// KLEIN chartreuse accents, all caps mono labels.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import {
  ANCHOR_ASSET_CODE,
  ANCHOR_ASSET_ISSUER,
  ANCHOR_HOME,
  HORIZON_TESTNET,
  ensureUsdcTrustline,
  fundIfNeeded,
  getAnchorTransaction,
  getBuyerBalances,
  getOrCreateBuyer,
  resetBuyer,
  sep10Authenticate,
  sep24DepositInteractive,
  type AnchorTx,
  type BuyerBalance,
  type BuyerWallet,
} from "../lib/anchor";

type Phase =
  | "idle"
  | "fund"
  | "trustline"
  | "auth"
  | "deposit"
  | "poll"
  | "done"
  | "error";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "ready",
  fund: "funding buyer wallet · friendbot",
  trustline: "adding SRT trustline",
  auth: "SEP-10 web auth",
  deposit: "SEP-24 deposit interactive",
  poll: "polling anchor transaction",
  done: "settled",
  error: "error",
};

function short(s?: string, head = 6, tail = 6): string {
  if (!s) return "—";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export default function AnchorDemo() {
  const [buyer, setBuyer] = useState<BuyerWallet | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [tx, setTx] = useState<AnchorTx | null>(null);
  const [balances, setBalances] = useState<BuyerBalance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  function append(line: string) {
    const stamp = new Date().toISOString().slice(11, 19);
    setLog(l => [...l, `${stamp}  ${line}`]);
  }

  useEffect(() => {
    const b = getOrCreateBuyer();
    setBuyer(b);
    getBuyerBalances(b.publicKey).then(setBalances).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
    };
  }, []);

  async function refreshBalances() {
    if (!buyer) return;
    const b = await getBuyerBalances(buyer.publicKey);
    setBalances(b);
  }

  async function handleReset() {
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
    setLog([]);
    setTx(null);
    setError(null);
    setPhase("idle");
    const b = resetBuyer();
    setBuyer(b);
    setBalances([]);
    append(`new buyer wallet: ${b.publicKey}`);
  }

  async function handleStart() {
    if (!buyer) return;
    setError(null);
    setLog([]);
    setTx(null);
    try {
      append(`buyer ${buyer.publicKey}`);

      setPhase("fund");
      append("checking account on horizon-testnet…");
      const funded = await fundIfNeeded(buyer.publicKey);
      append(funded === "funded" ? "funded via friendbot (10000 XLM)" : "account already funded");
      await refreshBalances();

      setPhase("trustline");
      append("ensuring USDC trustline…");
      const trust = await ensureUsdcTrustline(buyer);
      append(trust === "added" ? "USDC trustline added" : "USDC trustline already exists");
      await refreshBalances();

      setPhase("auth");
      append("SEP-10 challenge → sign → POST /auth …");
      const jwt = await sep10Authenticate(buyer);
      append(`JWT received (${jwt.length} chars)`);

      setPhase("deposit");
      append("SEP-24 deposit interactive request…");
      const dep = await sep24DepositInteractive(jwt, buyer);
      append(`tx id ${dep.id} · opening popup…`);

      popupRef.current = window.open(dep.url, "anchor", "width=480,height=720");
      if (!popupRef.current) {
        throw new Error("popup blocked · allow popups for this site and retry");
      }

      setPhase("poll");
      append("polling /sep24/transaction every 3s…");

      let elapsed = 0;
      pollTimerRef.current = window.setInterval(async () => {
        elapsed += 3;
        try {
          const t = await getAnchorTransaction(jwt, dep.id);
          setTx(t);
          append(`status=${t.status}${t.amount_in ? ` · in=${t.amount_in}` : ""}${t.amount_out ? ` · out=${t.amount_out}` : ""}`);
          if (t.status === "completed") {
            if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
            setPhase("done");
            await refreshBalances();
            append(`stellar tx ${short(t.stellar_transaction_id, 8, 8)}`);
            append("settled · USDC arrived in buyer wallet");
          } else if (t.status === "error" || t.status === "refunded" || t.status === "expired") {
            if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
            setPhase("error");
            setError(t.message ?? t.status);
          }
        } catch (e) {
          append(`poll error: ${(e as Error).message}`);
        }
        if (elapsed > 600) {
          if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
          setPhase("error");
          setError("timeout after 10 minutes");
        }
      }, 3000);
    } catch (e) {
      setPhase("error");
      setError((e as Error).message);
      append(`ERROR: ${(e as Error).message}`);
    }
  }

  const klein = "#FDDA24";

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain">
      <header className="fixed top-0 left-0 right-0 z-30 bg-[#f1eee7]/85 backdrop-blur-md border-b border-[#0a0a0a]/8">
        <div className="max-w-[1600px] mx-auto px-5 md:px-10 py-5 md:py-6 flex items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-7 text-[10px] uppercase tracking-[0.22em]">
            <Link to="/" className="hover:opacity-60 hidden md:inline">Home</Link>
            <Link to="/docs" className="hover:opacity-60 hidden md:inline">Docs</Link>
            <Link to="/x402-demo" className="hover:opacity-60 hidden md:inline">x402 demo</Link>
            <Link to="/login" className="hover:opacity-60">Log in</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-[1280px] mx-auto px-5 md:px-10 pt-[110px] md:pt-40 pb-24">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-6">
          ┃ 009 · Anchor flow · SEP-10 + SEP-24 · testnet
        </div>
        <div className="mb-4 inline-flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          <span className="px-2.5 py-1 bg-[#FDDA24] text-[#0a0a0a]">
            asset · {ANCHOR_ASSET_CODE}
          </span>
          <span className="px-2.5 py-1 bg-[#0a0a0a] text-[#FDDA24]">
            issuer · {ANCHOR_ASSET_ISSUER.slice(0, 6)}…{ANCHOR_ASSET_ISSUER.slice(-6)}
          </span>
          <span className="px-2.5 py-1 bg-white/60 text-[#0a0a0a] border border-[#0a0a0a]/15">
            build · {(globalThis as any).__BUILD_TAG__ ?? "dev"}
          </span>
        </div>
        <h1 className="text-[10vw] md:text-[5vw] font-medium leading-[0.95] tracking-[-0.04em] max-w-[18ch]">
          Fiat → USDC.
          <span className="inline-block align-baseline ml-2 w-2 md:w-3 h-2 md:h-3" style={{ background: klein }} />
        </h1>
        <p className="mt-6 text-base md:text-lg max-w-[60ch] text-[#0a0a0a]/75 leading-relaxed">
          Live SEP-10 + SEP-24 deposit against the Stellar reference anchor
          at <code className="font-mono text-sm">testanchor.stellar.org</code>.
          Buyer wallet is generated in-browser, funded via friendbot, given a
          trustline for the anchor's reference asset (SRT — Stellar Reference
          Token), then authenticated. The anchor opens an interactive popup;
          once you walk through the fake-fiat form, SRT settles on this same
          wallet. Production swaps SRT for the partner anchor's USDC asset —
          same protocol, same flow, change of two constants.
        </p>

        <div className="mt-12 grid grid-cols-12 gap-6">
          {/* Wallet panel */}
          <section className="col-span-12 md:col-span-5 border border-[#0a0a0a]/15 p-6 md:p-8 bg-white/40">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-4">
              ┃ buyer wallet · testnet
            </div>
            <div className="text-xs font-mono break-all">
              {buyer?.publicKey ?? "…"}
            </div>
            <a
              className="mt-3 inline-block text-[11px] uppercase tracking-[0.22em] underline-offset-4 underline opacity-70 hover:opacity-100"
              href={buyer ? `${HORIZON_TESTNET}/accounts/${buyer.publicKey}` : undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on horizon ↗
            </a>

            <div className="mt-8">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-3">
                ┃ balances
              </div>
              {balances.length === 0 ? (
                <div className="text-sm text-[#0a0a0a]/55">unfunded</div>
              ) : (
                <ul className="space-y-1 text-sm font-mono">
                  {balances.map((b, i) => (
                    <li key={i} className="flex justify-between border-b border-[#0a0a0a]/8 py-1">
                      <span>
                        {b.asset_code}
                        {b.asset_issuer && (
                          <span className="text-[#0a0a0a]/50 ml-1">
                            ({short(b.asset_issuer, 4, 4)})
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums">{parseFloat(b.balance).toFixed(4)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={refreshBalances}
                className="mt-3 text-[11px] uppercase tracking-[0.22em] opacity-70 hover:opacity-100"
              >
                refresh ↻
              </button>
            </div>

            <div className="mt-8 flex gap-3">
              <button
                onClick={handleStart}
                disabled={phase !== "idle" && phase !== "done" && phase !== "error"}
                className="px-5 py-3 bg-[#0a0a0a] text-[#f1eee7] text-[11px] uppercase tracking-[0.22em] hover:bg-[#0a0a0a]/85 disabled:opacity-40"
              >
                {phase === "idle" || phase === "done" || phase === "error" ? "Start deposit" : PHASE_LABEL[phase]}
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-3 border border-[#0a0a0a]/30 text-[11px] uppercase tracking-[0.22em] hover:bg-[#0a0a0a]/5"
              >
                New buyer
              </button>
            </div>
          </section>

          {/* Phase + log panel */}
          <section className="col-span-12 md:col-span-7 border border-[#0a0a0a]/15 p-6 md:p-8 bg-white/40">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-4">
              ┃ phase
            </div>
            <div className="flex items-center gap-3">
              <span
                className="inline-block w-2.5 h-2.5"
                style={{
                  background:
                    phase === "done" ? klein :
                    phase === "error" ? "#c92a2a" :
                    phase === "idle" ? "#0a0a0a33" :
                    "#0a0a0a",
                }}
              />
              <span className="text-lg tracking-tight">{PHASE_LABEL[phase]}</span>
            </div>

            {tx && (
              <div className="mt-6 grid grid-cols-2 gap-3 text-sm font-mono">
                <div className="text-[#0a0a0a]/55">tx id</div>
                <div className="break-all">{short(tx.id, 10, 10)}</div>
                <div className="text-[#0a0a0a]/55">status</div>
                <div>{tx.status}</div>
                {tx.amount_in && (<><div className="text-[#0a0a0a]/55">amount in</div><div>{tx.amount_in}</div></>)}
                {tx.amount_out && (<><div className="text-[#0a0a0a]/55">amount out</div><div>{tx.amount_out}</div></>)}
                {tx.amount_fee && (<><div className="text-[#0a0a0a]/55">fee</div><div>{tx.amount_fee}</div></>)}
                {tx.stellar_transaction_id && (
                  <>
                    <div className="text-[#0a0a0a]/55">stellar tx</div>
                    <div className="break-all">
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${tx.stellar_transaction_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-4"
                      >
                        {short(tx.stellar_transaction_id, 8, 8)} ↗
                      </a>
                    </div>
                  </>
                )}
              </div>
            )}

            {error && (
              <div className="mt-6 p-4 border border-red-400 bg-red-50 text-sm font-mono">
                {error}
              </div>
            )}

            <div className="mt-8">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-3">
                ┃ log
              </div>
              <div className="bg-[#0a0a0a] text-[#FDDA24] font-mono text-xs p-4 h-72 overflow-y-auto whitespace-pre-wrap">
                {log.length === 0 ? "// ready · click Start deposit\n" : log.join("\n")}
              </div>
            </div>
          </section>
        </div>

        <div className="mt-16 text-sm text-[#0a0a0a]/70 max-w-[60ch] leading-relaxed">
          <strong>What this proves:</strong> Slippay's runtime can speak SEP-10 +
          SEP-24 against a standards-compliant anchor today. A licensed BR VASP
          implementing the same SEPs (Pix in → USDC out) plugs in without code
          changes on Slippay's side · only configuration: TOML URL, asset
          issuer, JWT scope. Anchor source: <a
            href={`${ANCHOR_HOME}/.well-known/stellar.toml`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >testanchor.stellar.org/.well-known/stellar.toml ↗</a>.
        </div>
      </main>
    </div>
  );
}
