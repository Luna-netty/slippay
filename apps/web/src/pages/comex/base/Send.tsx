import { useState, useRef, useCallback } from "react";
import { isAddress } from "viem";
import { useComexBaseWallet } from "../../../lib/comexBase.tsx";
import { authorizeBasePayment } from "../../../lib/baseAuthorize.ts";
import { publicClient, usdcAddress, fromBaseUnits } from "../../../lib/chain/base/usdc.ts";
import ConfirmTxModal from "../../../components/ConfirmTxModal.tsx";
import { QrScanner } from "../../../components/QrScanner.tsx";
import { parsePaymentQr } from "../../../lib/parsePaymentQr.ts";
import type { TxSummary } from "../../../lib/txguard.ts";
import type { DecodedTransfer } from "../../../lib/baseAuthorize.ts";

// Minimal ERC-20 balanceOf ABI
const ERC20_BALANCE_OF_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export default function BaseSend() {
  const { address, sendTransaction } = useComexBaseWallet();

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // QR scan only PRE-FILLS the form; the WYSIWYS gate still shows the real
  // destination + amount before any signature, so a hostile QR can't make the
  // user sign blind.
  function handleScan(text: string) {
    setScanning(false);
    const parsed = parsePaymentQr(text);
    if (!parsed) {
      setError("QR não reconhecido. Use um endereço Base (0x…) ou um QR de cobrança USDC.");
      return;
    }
    setError(null);
    setDestination(parsed.to);
    if (parsed.amount) setAmount(parsed.amount);
  }

  // ConfirmTxModal wiring
  const [modalSummary, setModalSummary] = useState<TxSummary | null>(null);
  const resolveConfirmRef = useRef<((v: boolean) => void) | null>(null);

  const openConfirmModal = useCallback(
    (decoded: DecodedTransfer): Promise<boolean> => {
      return new Promise((resolve) => {
        resolveConfirmRef.current = resolve;
        const summary: TxSummary = {
          source: address ?? "",
          fee: "gas (rede Base)",
          operations: [
            {
              type: "payment",
              destination: decoded.to,
              amount: decoded.amount,
              assetCode: "USDC",
            },
          ],
        };
        setModalSummary(summary);
      });
    },
    [address],
  );

  function handleConfirm() {
    setModalSummary(null);
    resolveConfirmRef.current?.(true);
    resolveConfirmRef.current = null;
  }

  function handleCancel() {
    setModalSummary(null);
    resolveConfirmRef.current?.(false);
    resolveConfirmRef.current = null;
  }

  const destTrimmed = destination.trim();
  const destValid = destTrimmed.length > 0 && isAddress(destTrimmed);
  const amtNum = Number(amount.replace(",", "."));
  const amtValid = isFinite(amtNum) && amtNum > 0;
  const canSend = !!address && destValid && amtValid && !busy;

  async function doSend() {
    if (!address || !canSend) return;
    setError(null);
    setTxHash(null);
    setBusy(true);

    try {
      // Insufficient-balance pre-check — read on-chain before signing anything.
      const rawBalance = await publicClient.readContract({
        address: usdcAddress(),
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [address],
      }) as bigint;
      const humanBalance = fromBaseUnits(rawBalance);

      if (Number(humanBalance) < amtNum) {
        setError(`Saldo insuficiente: você tem $${Number(humanBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`);
        setBusy(false);
        return;
      }

      // Gate: build → decode → assert → confirm → send
      const result = await authorizeBasePayment({
        to: destTrimmed as `0x${string}`,
        amount: amtNum.toFixed(6),
        sendTransaction,
        confirm: (decoded) => openConfirmModal(decoded),
      });

      setTxHash(result.hash);
      setDestination("");
      setAmount("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "erro desconhecido";
      if (msg === "cancelado") {
        setError("Transação cancelada.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {scanning && (
        <QrScanner onScan={handleScan} onClose={() => setScanning(false)} />
      )}

      {modalSummary && (
        <ConfirmTxModal
          summary={modalSummary}
          intent={`Enviar ${amount} USDC para ${destTrimmed.slice(0, 8)}...${destTrimmed.slice(-4)}`}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      <div className="md:col-span-9 max-w-xl">
        <div className="text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-8 block">
          Enviar dólares
        </div>

        {/* Destination */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">
              Destino
            </label>
            <button
              type="button"
              onClick={() => { setError(null); setScanning(true); }}
              disabled={busy}
              className="text-[10px] uppercase tracking-[0.18em] border border-[#0a0a0a]/25 px-3 py-1.5 hover:border-[#0a0a0a]/60 disabled:opacity-40"
            >
              Escanear QR
            </button>
          </div>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            disabled={busy}
            placeholder="Endereço Base (0x...)"
            className={[
              "w-full bg-transparent border p-4 font-mono text-sm disabled:opacity-60",
              destination && !destValid
                ? "border-red-500"
                : "border-[#0a0a0a]/20",
            ].join(" ")}
          />
          {destination && !destValid && (
            <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-red-700">
              Endereço inválido (deve começar com 0x, 42 caracteres)
            </div>
          )}
        </div>

        {/* Amount */}
        <div className="mb-8">
          <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-3 block">
            Valor (USD)
          </label>
          <div className="flex items-baseline gap-2 border border-[#0a0a0a]/20 p-4">
            <span className="text-xl text-[#0a0a0a]/45">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
              disabled={busy}
              placeholder="0.00"
              className="w-full bg-transparent outline-none text-4xl tabular-nums disabled:opacity-60"
            />
            <span className="text-lg text-[#0a0a0a]/45">USDC</span>
          </div>
        </div>

        {/* Send button */}
        <button
          onClick={doSend}
          disabled={!canSend}
          className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-40"
        >
          {busy ? "Processando..." : "Enviar"}
        </button>

        {/* Success */}
        {txHash && (
          <div className="mt-8 border-l-2 border-[#FDDA24] pl-4">
            <div className="text-[10px] uppercase tracking-[0.18em] flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 bg-[#FDDA24]" /> Transferência enviada
            </div>
            <a
              className="text-xs font-mono mt-2 block break-all hover:opacity-60"
              href={`https://basescan.org/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              {txHash}
            </a>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-6 text-xs uppercase tracking-[0.18em] text-red-700 border-l-2 border-red-700 pl-3">
            {error}
          </div>
        )}

        {!address && (
          <div className="mt-6 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/40">
            Conta não disponível
          </div>
        )}

        {/* Fine print */}
        <div className="mt-10 text-[10px] text-[#0a0a0a]/40 border-t border-[#0a0a0a]/10 pt-4">
          Transferência via USDC na rede Base · non-custodial · irreversível
        </div>
      </div>
    </>
  );
}
