import { useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { useComexSolanaWallet } from "../../../lib/comexSolana.tsx";
import { rpcUrl, usdcMint } from "../../../lib/chain/solana/usdc.ts";

export default function SolanaBalance() {
  const { address } = useComexSolanaWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setError(null);

    const connection = new Connection(rpcUrl());
    const ownerPubkey = new PublicKey(address);

    getAssociatedTokenAddress(usdcMint(), ownerPubkey)
      .then((ata) => connection.getTokenAccountBalance(ata))
      .then((resp) => {
        setBalance(resp.value.uiAmountString ?? "0");
      })
      .catch((e: unknown) => {
        // ATA doesn't exist yet = zero balance (account-not-found error)
        const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
        if (
          msg.includes("could not find") ||
          msg.includes("account not found") ||
          msg.includes("invalid account data") ||
          msg.includes("failed to get info about account")
        ) {
          setBalance("0");
        } else {
          setError("Não foi possível carregar o saldo. Tente novamente.");
        }
      })
      .finally(() => setLoading(false));
  }, [address]);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  }

  const displayBalance =
    balance !== null
      ? Number(balance).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : null;

  return (
    <div className="md:col-span-9 max-w-xl">
      {/* Balance */}
      <div className="mb-12">
        <div className="text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-4 block">
          Saldo disponível
        </div>
        {loading && (
          <div className="text-[#0a0a0a]/40 text-sm uppercase tracking-[0.18em]">
            Carregando...
          </div>
        )}
        {!loading && error && (
          <div className="text-xs uppercase tracking-[0.18em] text-red-700 border-l-2 border-red-700 pl-3">
            {error}
          </div>
        )}
        {!loading && !error && displayBalance !== null && (
          <div className="text-6xl md:text-7xl font-medium tabular-nums tracking-[-0.04em] leading-[0.9]">
            $ {displayBalance}
          </div>
        )}
        {!loading && !error && displayBalance !== null && (
          <div className="mt-3 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/40">
            USDC · Solana
          </div>
        )}
      </div>

      {/* Receive section */}
      {address && (
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-4 block">
            Receber
          </div>
          <div className="border border-[#0a0a0a]/20 p-6">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-2">
              Endereço da conta
            </div>
            <div className="font-mono text-sm break-all text-[#0a0a0a]">{address}</div>
            <button
              onClick={copyAddress}
              className="mt-4 border border-[#0a0a0a] py-3 px-6 text-[10px] uppercase tracking-[0.18em] hover:bg-[#0a0a0a] hover:text-[#f1eee7] transition-colors"
            >
              {copied ? "Copiado" : "Copiar endereço"}
            </button>
            <div className="mt-4 text-[10px] text-[#0a0a0a]/55 border-l-2 border-[#0a0a0a]/15 pl-3">
              Envie dólares (USDC, rede Solana) para este endereço
            </div>
          </div>
        </div>
      )}

      {!address && !loading && (
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/40">
          Conta não disponível
        </div>
      )}
    </div>
  );
}
