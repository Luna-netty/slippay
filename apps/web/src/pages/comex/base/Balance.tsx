import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useComexBaseWallet } from "../../../lib/comexBase.tsx";
import { publicClient, usdcAddress, fromBaseUnits } from "../../../lib/chain/base/usdc.ts";

// Minimal ERC-20 balanceOf ABI — only what we need.
const ERC20_BALANCE_OF_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type Tab = "Saldo" | "Enviar" | "Câmbio" | "Render";

export default function BaseBalance({ onNavigate }: { onNavigate?: (tab: Tab) => void }) {
  const { address } = useComexBaseWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  // QR of the receive address so another wallet (or another Slippay user) can
  // scan to pay. Bare 0x address = maximally compatible with EVM wallets.
  useEffect(() => {
    if (!address) { setQrUrl(null); return; }
    let on = true;
    QRCode.toDataURL(address, { margin: 1, width: 320, color: { dark: "#0a0a0a", light: "#f1eee7" } })
      .then((url) => { if (on) setQrUrl(url); })
      .catch(() => { if (on) setQrUrl(null); });
    return () => { on = false; };
  }, [address]);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setError(null);

    publicClient
      .readContract({
        address: usdcAddress(),
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [address],
      })
      .then((raw) => {
        setBalance(fromBaseUnits(raw as bigint));
      })
      .catch(() => {
        setError("Não foi possível carregar o saldo. Tente novamente.");
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
            USDC · rede Base
          </div>
        )}
        {!loading && !error && balance !== null && Number(balance) === 0 && (
          <div className="mt-6 space-y-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">
              Comece por aqui
            </div>
            <button
              onClick={() => onNavigate?.("Câmbio")}
              className="w-full text-left border border-[#0a0a0a]/20 hover:border-[#0a0a0a]/60 p-5 transition-colors"
            >
              <div className="text-sm font-medium">001. Comprar dólares com Pix</div>
              <div className="text-[11px] text-[#0a0a0a]/55 mt-1">pague em reais, receba USDC na sua conta</div>
            </button>
            <a
              href="#receber"
              className="block border border-[#0a0a0a]/20 hover:border-[#0a0a0a]/60 p-5 transition-colors"
            >
              <div className="text-sm font-medium">002. Receber de outra carteira</div>
              <div className="text-[11px] text-[#0a0a0a]/55 mt-1">use o endereço ou o QR abaixo (USDC · rede Base)</div>
            </a>
          </div>
        )}
      </div>

      {/* Receive section */}
      {address && (
        <div id="receber" className="scroll-mt-24">
          <div className="text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-4 block">
            Receber
          </div>
          <div className="border border-[#0a0a0a]/20 p-6">
            {qrUrl && (
              <div className="mb-5 flex flex-col items-center">
                <img
                  src={qrUrl}
                  alt="QR do endereço de recebimento (USDC · Base)"
                  className="w-44 h-44 border border-[#0a0a0a]/15"
                />
                <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/40">
                  Escaneie para pagar
                </div>
              </div>
            )}
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
            <div className="mt-4 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45 border border-[#0a0a0a]/20 px-2 py-1">
                Rede: Base
              </span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/40">
                USDC by Circle
              </span>
            </div>
            <div className="mt-3 text-[10px] text-[#0a0a0a]/70 border-l-2 border-[#0a0a0a] pl-3">
              Aceita apenas USDC na rede Base. Enviar outra moeda ou outra rede resulta em perda permanente.
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
