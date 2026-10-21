// Withdraw demo · /withdraw-demo
// SEP-10 + SEP-24 WITHDRAW (off-ramp · USDC → cash) against testanchor.stellar.org
//
// This is the leg MoneyGram Access uses for physical cash-out
// (docs/integrations/moneygram.md). Mirror of AnchorDemo, but the money flows
// OUT: after the interactive popup, the anchor reaches
// pending_user_transfer_start and we push the asset to its account.
//
// Flow visible to the user:
//   1. Load the persisted testnet buyer wallet (shared with /anchor-demo)
//   2. Require an SRT balance to withdraw — if zero, run /anchor-demo first
//   3. SEP-10 authenticate · receive JWT
//   4. SEP-24 withdraw interactive · open popup · walk the fake cash-out form
//   5. Poll until status=pending_user_transfer_start
//   6. Send the asset to withdraw_anchor_account with the anchor's memo
//   7. Poll until status=completed · SRT debited from the buyer wallet
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
  fundIfNeeded,
  getAnchorTransaction,
  getBuyerBalances,
  getOrCreateBuyer,
  resetBuyer,
  sendWithdrawalPayment,
  sep10Authenticate,
  sep24WithdrawInteractive,
  type AnchorTx,
  type BuyerBalance,
  type BuyerWallet,
} from "../lib/anchor";

type Phase =
  | "idle"
  | "fund"
  | "auth"
  | "withdraw"
  | "poll"
  | "send"
  | "settle"
  | "done"
  | "error";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "ready",
  fund: "checking buyer wallet · friendbot",
  auth: "SEP-10 web auth",
  withdraw: "SEP-24 withdraw interactive",
  poll: "polling · waiting for transfer_start",
  send: "sending asset to anchor",
  settle: "polling · waiting for cash payout",
  done: "cashed out",
  error: "error",
};

const WITHDRAW_AMOUNT = "5";

function short(s?: string, head = 6, tail = 6): string {
  if (!s) return "—";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function srtBalance(balances: BuyerBalance[]): number {
  const b = balances.find(x => x.asset_code === ANCHOR_ASSET_CODE);
  return b ? parseFloat(b.balance) : 0;
}

export default function WithdrawDemo() {
  const [buyer, setBuyer] = useState<BuyerWallet | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [tx, setTx] = useState<AnchorTx | null>(null);
  const [balances, setBalances] = useState<BuyerBalance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const sentRef = useRef<boolean>(false);

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
    sentRef.current = false;
    const b = resetBuyer();
    setBuyer(b);
    setBalances([]);
    append(`new buyer wallet: ${b.publicKey} · run /anchor-demo to fund it with SRT first`);
  }

  async function handleStart() {
    if (!buyer) return;
    setError(null);
    setLog([]);
    setTx(null);
    sentRef.current = false;
    try {
      append(`buyer ${buyer.publicKey}`);

      setPhase("fund");
      append("checking account on horizon-testnet…");
      const funded = await fundIfNeeded(buyer.publicKey);
      append(funded === "funded" ? "funded via friendbot (10000 XLM)" : "account already funded");
      await refreshBalances();

      const have = srtBalance(balances.length ? balances : await getBuyerBalances(buyer.publicKey));
      if (have < parseFloat(WITHDRAW_AMOUNT)) {
        throw new Error(
          `need ≥ ${WITHDRAW_AMOUNT} ${ANCHOR_ASSET_CODE} to withdraw · have ${have} · run /anchor-demo (deposit) first`,
        );
      }
      append(`SRT balance ${have} · enough to withdraw ${WITHDRAW_AMOUNT}`);

      setPhase("auth");
      append("SEP-10 challenge → sign → POST /auth …");
      const jwt = await sep10Authenticate(buyer);
      append(`JWT received (${jwt.length} chars)`);

      setPhase("withdraw");
      append("SEP-24 withdraw interactive request…");
      const wd = await sep24WithdrawInteractive(jwt, buyer, WITHDRAW_AMOUNT);
      append(`tx id ${wd.id} · opening popup…`);

      popupRef.current = window.open(wd.url, "anchor", "width=480,height=720");
      if (!popupRef.current) {
        throw new Error("popup blocked · allow popups for this site and retry");
      }

      setPhase("poll");
      append("polling /sep24/transaction every 3s…");

      let elapsed = 0;
      pollTimerRef.current = window.setInterval(async () => {
        elapsed += 3;
        try {
          const t = await getAnchorTransaction(jwt, wd.id);
          setTx(t);
          append(`status=${t.status}${t.amount_in ? ` · in=${t.amount_in}` : ""}${t.amount_out ? ` · out=${t.amount_out}` : ""}`);

          // The off-ramp turn: anchor is ready to receive funds. Push once.
          if (t.status === "pending_user_transfer_start" && !sentRef.current) {
            sentRef.current = true;
            setPhase("send");
            append(`anchor wants ${t.amount_in} ${ANCHOR_ASSET_CODE} → ${short(t.withdraw_anchor_account, 6, 6)} memo=${t.withdraw_memo ?? "—"}`);
            try {
              const hash = await sendWithdrawalPayment(buyer, t);
              append(`sent · stellar tx ${short(hash, 8, 8)}`);
              await refreshBalances();
              setPhase("settle");
            } catch (e) {
              if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
              setPhase("error");
              setError(`send failed: ${(e as Error).message}`);
            }
            return;
          }

          if (t.status === "completed") {
            if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
            setPhase("done");
            await refreshBalances();
            append(`stellar tx ${short(t.stellar_transaction_id, 8, 8)}`);
            append("cashed out · SRT debited · anchor dispenses fiat/cash");
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
  const busy = phase !== "idle" && phase !== "done" && phase !== "error";

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain">
      <header className="fixed top-0 left-0 right-0 z-30 bg-[#f1eee7]/85 backdrop-blur-md border-b border-[#0a0a0a]/8">
        <div className="max-w-[1600px] mx-auto px-5 md:px-10 py-5 md:py-6 flex items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-7 text-[10px] uppercase tracking-[0.22em]">
            <Link to="/" className="hover:opacity-60 hidden md:inline">Home</Link>
            <Link to="/docs" className="hover:opacity-60 hidden md:inline">Docs</Link>
            <Link to="/anchor-demo" className="hover:opacity-60 hidden md:inline">deposit demo</Link>
            <Link to="/login" className="hover:opacity-60">Log in</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-[1280px] mx-auto px-5 md:px-10 pt-[110px] md:pt-40 pb-24">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-6">
          ┃ 010 · Off-ramp · SEP-10 + SEP-24 withdraw · testnet
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
          USDC → cash.
          <span className="inline-block align-baseline ml-2 w-2 md:w-3 h-2 md:h-3" style={{ background: klein }} />
        </h1>
        <p className="mt-6 text-base md:text-lg max-w-[60ch] text-[#0a0a0a]/75 leading-relaxed">
          Live SEP-10 + SEP-24 <strong>withdraw</strong> (off-ramp) against the
          Stellar reference anchor at <code className="font-mono text-sm">testanchor.stellar.org</code>.
          The buyer wallet is shared with the deposit demo — run <Link to="/anchor-demo" className="underline underline-offset-4">/anchor-demo</Link> first
          to acquire SRT, then cash it out here. The anchor opens an interactive
          popup; once you walk the fake cash-out form it reaches
          <code className="font-mono text-sm"> pending_user_transfer_start</code>,
          the wallet pushes the asset to the anchor account with its memo, and the
          balance debits. Production swaps SRT for the partner anchor's USDC — same
          protocol, same flow. This is the MoneyGram Access cash-out leg.
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
                <div className="text-sm text-[#0a0a0a]/55">unfunded · deposit first</div>
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
                disabled={busy}
                className="px-5 py-3 bg-[#0a0a0a] text-[#f1eee7] text-[11px] uppercase tracking-[0.22em] hover:bg-[#0a0a0a]/85 disabled:opacity-40"
              >
                {!busy ? "Start withdraw" : PHASE_LABEL[phase]}
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
                {tx.withdraw_anchor_account && (
                  <><div className="text-[#0a0a0a]/55">anchor acct</div><div className="break-all">{short(tx.withdraw_anchor_account, 6, 6)}</div></>
                )}
                {tx.withdraw_memo && (<><div className="text-[#0a0a0a]/55">memo</div><div className="break-all">{tx.withdraw_memo}</div></>)}
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
                {log.length === 0 ? "// ready · click Start withdraw\n" : log.join("\n")}
              </div>
            </div>
          </section>
        </div>

        <div className="mt-16 text-sm text-[#0a0a0a]/70 max-w-[60ch] leading-relaxed">
          <strong>What this proves:</strong> Slippay's runtime can drive the SEP-24
          <strong> off-ramp</strong> — the leg MoneyGram Access uses to dispense
          physical cash in ~170 countries — against a standards-compliant anchor
          today. Going live on MoneyGram is a config + partnership step (allowlist
          the funds/auth keys), not a code change. Cross-border cash-out still
          gates on the Res BCB 561 câmbio classification — see
          <code className="font-mono text-xs"> docs/integrations/moneygram.md</code>.
          Anchor source: <a
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
