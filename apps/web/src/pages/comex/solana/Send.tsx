import { useState, useRef, useCallback } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useComexSolanaWallet } from "../../../lib/comexSolana.tsx";
import { authorizeSolanaPayment } from "../../../lib/solanaAuthorize.ts";
import { rpcUrl } from "../../../lib/chain/solana/usdc.ts";
import ConfirmTxModal from "../../../components/ConfirmTxModal.tsx";
import type { TxSummary } from "../../../lib/txguard.ts";

function isValidSolanaAddress(addr: string): boolean {
  try {
    new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}

export default function SolanaSend() {
  const { address, signTransaction } = useComexSolanaWallet();

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  /** true = confirmed on-chain, false = sent but confirmation pending/timed out */
  const [txConfirmed, setTxConfirmed] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // ConfirmTxModal state — we synthesize a TxSummary for the modal
  const [modalSummary, setModalSummary] = useState<TxSummary | null>(null);
  const resolveConfirmRef = useRef<((v: boolean) => void) | null>(null);

  const openConfirmModal = useCallback(
    (decoded: { to: string; amount: string; ownerAddress: string }): Promise<boolean> => {
      return new Promise((resolve) => {
        resolveConfirmRef.current = resolve;
        // [I-2] Show the owner address (base58) the user recognizes, not the ATA.
        const summary: TxSummary = {
          source: address ?? "",
          fee: "~0.000005 SOL",
          operations: [
            {
              type: "payment",
              // ownerAddress is what the human can verify; ATA is internal
              destination: decoded.ownerAddress,
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

  const destValid = destination.length > 0 && isValidSolanaAddress(destination);
  const amtNum = Number(amount);
  const amtValid = isFinite(amtNum) && amtNum > 0;
  const canSend = !!address && destValid && amtValid && !busy;

  async function doSend() {
    if (!address || !canSend) return;
    setError(null);
    setTxSig(null);
    setTxConfirmed(true);
    setBusy(true);
    try {
      const connection = new Connection(rpcUrl());
      const result = await authorizeSolanaPayment({
        connection,
        from: new PublicKey(address),
        to: new PublicKey(destination.trim()),
        usdcAmount: amtNum.toFixed(6),
        signTransaction,
        confirm: (decoded) => openConfirmModal(decoded),
      });
      setTxSig(result.signature);
      setTxConfirmed(result.confirmed);
      if (result.confirmed) {
        setDestination("");
        setAmount("");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "erro desconhecido");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {modalSummary && (
        <ConfirmTxModal
          summary={modalSummary}
          intent={`Enviar ${amount} USDC para ${destination.trim().slice(0, 8)}...${destination.trim().slice(-4)}`}
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
          <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-3 block">
            Destino
          </label>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            disabled={busy}
            placeholder="Endereço Solana (base58)"
            className={[
              "w-full bg-transparent border p-4 font-mono text-sm disabled:opacity-60",
              destination && !destValid
                ? "border-red-500"
                : "border-[#0a0a0a]/20",
            ].join(" ")}
          />
          {destination && !destValid && (
            <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-red-700">
              Endereço inválido
            </div>
          )}
        </div>

        {/* Amount */}
        <div className="mb-8">
          <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-3 block">
            Valor (USD)
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
            placeholder="0.00"
            min="0"
            step="0.01"
            className="w-full bg-transparent border border-[#0a0a0a]/20 p-4 text-4xl tabular-nums disabled:opacity-60"
          />
        </div>

        {/* Send button */}
        <button
          onClick={doSend}
          disabled={!canSend}
          className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-40"
        >
          {busy ? "Processando..." : "Enviar"}
        </button>

        {/* Success — confirmed */}
        {txSig && txConfirmed && (
          <div className="mt-8 border-l-2 border-[#FDDA24] pl-4">
            <div className="text-[10px] uppercase tracking-[0.18em] flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 bg-[#FDDA24]" /> Transferência enviada
            </div>
            <a
              className="text-xs font-mono mt-2 block break-all hover:opacity-60"
              href={`https://solscan.io/tx/${txSig}`}
              target="_blank"
              rel="noreferrer"
            >
              {txSig}
            </a>
          </div>
        )}

        {/* Pending confirmation — sent but not yet confirmed */}
        {txSig && !txConfirmed && (
          <div className="mt-8 border-l-2 border-[#0a0a0a]/40 pl-4">
            <div className="text-[10px] uppercase tracking-[0.18em] flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 bg-[#0a0a0a]/40 animate-pulse" />
              Enviado, confirmando...
            </div>
            <p className="text-xs text-[#0a0a0a]/60 mt-1">
              A transação foi enviada à rede. Verifique o status no Solscan.
            </p>
            <a
              className="text-xs font-mono mt-2 block break-all hover:opacity-60 text-[#0a0a0a]/70"
              href={`https://solscan.io/tx/${txSig}`}
              target="_blank"
              rel="noreferrer"
            >
              {txSig}
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
          Transferência via USDC na rede Solana · non-custodial · irreversível
        </div>
      </div>
    </>
  );
}
