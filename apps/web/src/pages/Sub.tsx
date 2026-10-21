// Buyer-facing on-chain subscription charge — the browser surface for the
// CONTRACT settlement path (vs the classic one-time payment in /checkout).
//
// Flow: connect wallet → ask the API to build the unsigned charge(id) bound to
// the connected buyer → sign in the wallet → submit via Soroban RPC → real tx
// through contract CBJMQ6ZY on Stellar mainnet (the rail proven via CLI on
// 2026-06-03, charge tx 5da9741f…). This is a DEMO surface (uses a scoped demo
// merchant key in the browser, same pattern as createDemoOrder); productionizing
// needs a public token-gated onchain-charge endpoint.
//
// Prerequisites for an end-to-end run (all Manuel's, one-time):
//   • VITE_DEMO_MERCHANT_KEY set in the build env (a merchant API key).
//   • a subscription row (that merchant) with soroban_subscription_id set to the
//     32-byte hex nonce of an on-chain subscription ALREADY created via create()
//     (e.g. scripts/e2e-subscription-charge-mainnet.mjs) bound to the buyer wallet.
//   • the connected wallet = that subscription's buyer, funded with USDC + XLM.

import { useState } from "react";
import { useParams } from "react-router-dom";
import { Logo } from "../components/Logo.tsx";
import { PayButton } from "../components/PayButton.tsx";
// authorizeRecurring goes through the chain adapter (Stellar today, Solana when
// VITE_CHAIN=solana). pay() stays Stellar-only: it settles a Soroban contract
// charge whose unsigned XDR is built by the API — there is no Solana backend for
// that path yet, so abstracting it would be theater.
import { requestOnchainCharge, signAndSubmitContractCharge } from "../lib/soroban.ts";
import { getChainAdapter } from "../lib/chain/index.ts";

const IS_PUBLIC = (import.meta.env.VITE_STELLAR_NETWORK ?? "TESTNET").toUpperCase() === "PUBLIC";
const EXPLORER_BASE = IS_PUBLIC
  ? "https://stellar.expert/explorer/public/tx"
  : "https://stellar.expert/explorer/testnet/tx";

type State = "idle" | "building" | "signing" | "submitting" | "done" | "error";

export default function Sub() {
  const { id } = useParams<{ id: string }>();
  const [wallet, setWallet] = useState<string | null>(null);
  const [state, setState] = useState<State>("idle");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiBase = import.meta.env.VITE_API_BASE as string | undefined;
  const demoKey = import.meta.env.VITE_DEMO_MERCHANT_KEY as string | undefined;

  // The ONE signature that turns on autonomous recurring debit: approve the
  // subscription contract as a SEP-41 spender. After this, the scheduler charges
  // each period with no further buyer signature.
  async function authorizeRecurring() {
    if (!wallet) { setError("connect a wallet first"); return; }
    setError(null);
    try {
      setState("signing");
      const adapter = await getChainAdapter();
      const { hash: h } = await adapter.approveRecurring({
        buyerAddress: wallet,
        capUsdc: "12",   // cap: 12 USDC (e.g. 12 × 1.0 monthly); ~9 months default
      });
      setHash(h);
      setState("done");
    } catch (e: unknown) {
      setState("error");
      setError(e instanceof Error ? e.message : "approve failed");
    }
  }

  async function pay() {
    if (!id) return;
    setError(null);
    try {
      if (!apiBase) throw new Error("VITE_API_BASE not configured");
      if (!demoKey) throw new Error("VITE_DEMO_MERCHANT_KEY not configured (demo merchant key required)");
      if (!wallet) throw new Error("connect a wallet first");
      setState("building");
      const oc = await requestOnchainCharge(apiBase, id, wallet, demoKey);
      setState("signing");
      const res = await signAndSubmitContractCharge(oc.unsigned_xdr, oc.rpc_url);
      setHash(res.hash);
      setState(res.status === "SUCCESS" ? "done" : "error");
      if (res.status !== "SUCCESS") setError(`tx ${res.status.toLowerCase()}`);
    } catch (e: unknown) {
      setState("error");
      setError(e instanceof Error ? e.message : "unknown error");
    }
  }

  const label =
    state === "building" ? "Preparing…" :
    state === "signing" ? "Sign in your wallet…" :
    state === "submitting" ? "Submitting…" :
    state === "done" ? "Charged ✓" : "Pay on-chain";

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain flex flex-col">
      <header className="max-w-[1080px] w-full mx-auto px-5 md:px-10 py-8 flex items-center justify-between">
        <Logo />
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55">
          on-chain charge · contract CBJMQ6ZY
        </div>
      </header>

      <main className="flex-1 flex items-center">
        <div className="max-w-[1080px] w-full mx-auto px-5 md:px-10 py-16 grid md:grid-cols-12 gap-8 md:gap-16">
          <div className="md:col-span-4 font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55">
            <span className="inline-block w-2.5 h-2.5 bg-[#FDDA24] mr-2 align-middle" />
            recurring · settled on Stellar mainnet
          </div>

          <div className="md:col-span-8">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-4">
              subscription {id?.slice(0, 8)}
            </div>
            <h1 className="text-4xl md:text-6xl font-medium tracking-[-0.03em] max-w-[14ch]">
              Authorize the charge with your wallet.
            </h1>
            <p className="mt-6 text-[#0a0a0a]/70 leading-relaxed max-w-[52ch]">
              The charge runs through the on-chain contract — your wallet signs the exact
              <span className="font-mono"> (id, token, merchant, amount)</span> tuple, and the USDC
              settles atomically. Nothing custodial, nothing you can’t re-check on the explorer.
            </p>

            <div className="mt-10 max-w-md">
              {!wallet
                ? <PayButton onConnected={setWallet} />
                : (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-3">
                      Connected · <span className="font-mono normal-case tracking-normal">{wallet.slice(0, 8)}…{wallet.slice(-4)}</span>
                    </div>
                    <button
                      disabled={state === "signing" || state === "submitting" || state === "done"}
                      onClick={authorizeRecurring}
                      className="w-full bg-[#FDDA24] text-[#0a0a0a] py-5 text-sm uppercase tracking-[0.18em] hover:opacity-90 disabled:opacity-50"
                    >
                      Authorize recurring · 1 signature
                    </button>
                    <div className="mt-2 mb-4 text-[11px] text-[#0a0a0a]/55 leading-relaxed">
                      One approval, then it charges itself every period — no signing again. Capped on-chain, expires in ~9 months. Or pay a single charge below.
                    </div>
                    <button
                      disabled={state === "building" || state === "signing" || state === "submitting" || state === "done"}
                      onClick={pay}
                      className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-50"
                    >
                      {label}
                    </button>

                    {hash && (
                      <div className={`mt-6 border-l-2 pl-4 ${state === "done" ? "border-[#FDDA24]" : "border-amber-500"}`}>
                        <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/70">
                          {state === "done" ? "Charged on mainnet" : "Tx submitted"}
                        </div>
                        <a className="text-xs font-mono mt-2 block break-all hover:opacity-60"
                           href={`${EXPLORER_BASE}/${hash}`} target="_blank" rel="noreferrer">
                          {hash}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              {error && (
                <div className="mt-4 text-xs uppercase tracking-[0.18em] text-red-700 border-l-2 border-red-700 pl-3">{error}</div>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-[#0a0a0a]/10">
        <div className="max-w-[1080px] mx-auto px-5 md:px-10 py-6 font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55">
          Non-custodial · proof-carrying · USDC by Circle on Stellar
        </div>
      </footer>
    </div>
  );
}
