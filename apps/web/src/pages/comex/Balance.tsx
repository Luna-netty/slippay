import { useEffect, useState } from "react";
import { Horizon } from "@stellar/stellar-sdk";
import { USDC_ASSET_CODE } from "@slippay/shared";
import { useComexWallet } from "../../lib/comexPrivy.tsx";
import { usdcIssuer } from "../../lib/stellar.ts";

const NETWORK = (import.meta.env.VITE_STELLAR_NETWORK ?? "PUBLIC").toUpperCase() as "TESTNET" | "PUBLIC";

const HORIZON_URL: Record<"TESTNET" | "PUBLIC", string> = {
  TESTNET: "https://horizon-testnet.stellar.org",
  PUBLIC: "https://horizon.stellar.org",
};

export default function Balance() {
  const { address } = useComexWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setError(null);
    const server = new Horizon.Server(HORIZON_URL[NETWORK]);
    server
      .loadAccount(address)
      .then((acct) => {
        const issuer = usdcIssuer(NETWORK);
        const bal = acct.balances.find(
          (b) =>
            (b as { asset_code?: string }).asset_code === USDC_ASSET_CODE &&
            (b as { asset_issuer?: string }).asset_issuer === issuer,
        );
        setBalance(bal ? (bal as { balance: string }).balance : "0.0000000");
      })
      .catch((e: unknown) => {
        const status = (e as { response?: { status?: number } })?.response?.status;
        const name = (e as { name?: string })?.name;
        if (status === 404 || name === "NotFoundError") {
          setBalance("0.0000000");
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
            USDC · Stellar {NETWORK === "TESTNET" ? "Testnet" : "Mainnet"}
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
              Envie dólares (USDC Stellar) para este endereço
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
