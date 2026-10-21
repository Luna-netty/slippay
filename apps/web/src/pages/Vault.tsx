import { useCallback, useEffect, useState } from "react";
import { Logo } from "../components/Logo.tsx";
import { connectWallet, signTx } from "../lib/wallet.ts";
import { submitSignedTx } from "../lib/stellar.ts";
import * as vault from "../lib/defindex.ts";

type Mode = "deposit" | "withdraw";

const NETWORK = (import.meta.env.VITE_STELLAR_NETWORK ?? "PUBLIC").toUpperCase() as "TESTNET" | "PUBLIC";
const EXPLORER = NETWORK === "PUBLIC" ? "public" : "testnet";

export default function Vault() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  const [pos, setPos] = useState<vault.VaultPosition | null>(null);
  const [apy, setApy] = useState<number | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const refresh = useCallback(async (user: string) => {
    try {
      const [p, a] = await Promise.all([vault.getPosition(user), vault.getApy().catch(() => null)]);
      setPos(p);
      setApy(a);
    } catch (e) { setError(msg(e)); }
  }, []);

  useEffect(() => { if (wallet) void refresh(wallet); }, [wallet, refresh]);

  async function doConnect() {
    setError(null);
    try { setWallet(await connectWallet()); } catch (e) { setError(msg(e)); }
  }

  async function doSubmit() {
    setError(null); setTxHash(null); setBusy(true);
    try {
      if (!wallet) throw new Error("conecte a carteira");
      if (vault.usdcToStroops(amount) <= 0) throw new Error("informe um valor");
      const xdr = mode === "deposit"
        ? await vault.buildDepositTx(wallet, amount)
        : await vault.buildWithdrawTx(wallet, amount);
      const signed = await signTx(xdr);
      const { hash } = await submitSignedTx(NETWORK, signed);
      setTxHash(hash);
      setAmount("");
      await refresh(wallet);
    } catch (e) { setError(msg(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] flex flex-col">
      <header className="max-w-[1400px] w-full mx-auto px-8 md:px-12 py-8 flex items-center justify-between">
        <Logo />
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">Cofre USDC · autocustódia</div>
      </header>

      <main className="flex-1 flex items-center">
        <div className="max-w-[1400px] w-full mx-auto px-8 md:px-12 grid md:grid-cols-12 gap-8 md:gap-16 py-16 md:py-24">
          <div className="md:col-span-3 text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55">
            <span className="inline-block w-3 h-3 bg-[#b5e853] mr-2 align-middle" />
            001. Seus dólares, suas chaves
          </div>

          <div className="md:col-span-9 max-w-xl">
            {!wallet ? (
              <>
                <p className="text-sm text-[#0a0a0a]/70 mb-6 leading-relaxed">
                  Mantenha seus dólares digitais (USDC) em autocustódia — só você assina, só você
                  saca, a qualquer momento. Você conecta sua própria carteira; a Slippay nunca
                  guarda suas chaves nem seus fundos.
                </p>
                <button onClick={doConnect}
                  className="w-full border border-[#0a0a0a] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#0a0a0a] hover:text-[#f1eee7]">
                  Conectar carteira
                </button>
              </>
            ) : (
              <>
                {/* position */}
                <div className="text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-2">Seu saldo no cofre</div>
                <div className="text-6xl md:text-7xl font-medium tabular-nums tracking-[-0.04em] leading-[0.9]">
                  {pos ? `$ ${pos.usdc}` : "—"}
                </div>
                <div className="mt-3 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">
                  Conectado · <span className="font-mono normal-case">{wallet.slice(0,8)}...{wallet.slice(-4)}</span>
                </div>

                {/* mode toggle */}
                <div className="mt-10 flex gap-2 text-sm uppercase tracking-[0.18em]">
                  {(["deposit","withdraw"] as Mode[]).map(m => (
                    <button key={m} onClick={() => { setMode(m); setError(null); }}
                      className={`flex-1 py-3 border ${mode === m ? "bg-[#0a0a0a] text-[#f1eee7] border-[#0a0a0a]" : "border-[#0a0a0a]/20 text-[#0a0a0a]/60"}`}>
                      {m === "deposit" ? "Depositar" : "Sacar"}
                    </button>
                  ))}
                </div>

                <input type="text" inputMode="decimal" value={amount}
                  onChange={e => setAmount(e.target.value)} disabled={busy}
                  placeholder="valor em USDC"
                  className="mt-4 w-full bg-transparent border-b border-[#0a0a0a]/30 text-4xl tabular-nums py-2 disabled:opacity-60" />

                <button onClick={doSubmit} disabled={busy || !amount.trim()}
                  className="mt-6 w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-50">
                  {busy ? "Processando..." : mode === "deposit" ? "Depositar USDC" : "Sacar USDC"}
                </button>

                {/* honest yield disclosure — describes the asset, never promises a return */}
                <div className="mt-8 border-l-2 border-[#0a0a0a]/20 pl-4 text-xs text-[#0a0a0a]/60 leading-relaxed space-y-1">
                  {apy !== null && <div>Taxa on-chain atual: <span className="tabular-nums">{apy}</span> (variável).</div>}
                  <div>
                    O rendimento vem de protocolos DeFi de terceiros, é variável e não é garantido.
                    Seu principal está em risco. Isto não é poupança nem investimento oferecido pela Slippay.
                  </div>
                </div>

                {txHash && (
                  <div className="mt-6 border-l-2 border-[#b5e853] pl-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] flex items-center gap-2">
                      <span className="inline-block w-1.5 h-1.5 bg-[#b5e853]" /> Confirmado on-chain
                    </div>
                    <a className="text-xs font-mono mt-2 block break-all hover:opacity-60"
                       href={`https://stellar.expert/explorer/${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
                      {txHash}
                    </a>
                  </div>
                )}
              </>
            )}

            {error && <div className="mt-6 text-xs uppercase tracking-[0.18em] text-red-700 border-l-2 border-red-700 pl-3">{error}</div>}
          </div>
        </div>
      </main>

      <footer className="border-t border-[#0a0a0a]/10">
        <div className="max-w-[1400px] mx-auto px-8 md:px-12 py-6 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">
          Non-custodial · USDC by Circle · yield via DeFindex
        </div>
      </footer>
    </div>
  );
}

function msg(e: unknown): string { return e instanceof Error ? e.message : "erro desconhecido"; }
