import { useState, useRef, useCallback } from "react";
import { useComexWallet } from "../../lib/comexPrivy.tsx";
import {
  isValidStellarAddress,
  fetchSequence,
  buildUsdcPaymentTx,
} from "../../lib/stellar.ts";
import { authorizePayment } from "../../lib/authorizeTx.ts";
import { requiresApproval, approvalLimitUsd, logAction } from "../../lib/comexGuards.ts";
import ConfirmTxModal from "../../components/ConfirmTxModal.tsx";
import type { TxSummary } from "../../lib/txguard.ts";

const NETWORK = (import.meta.env.VITE_STELLAR_NETWORK ?? "PUBLIC").toUpperCase() as "TESTNET" | "PUBLIC";
const EXPLORER = NETWORK === "PUBLIC" ? "public" : "testnet";

export default function Send() {
  const { address, signHash } = useComexWallet();

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSecondApproval, setNeedsSecondApproval] = useState(false);
  const [secondApprovalConfirmed, setSecondApprovalConfirmed] = useState(false);

  // ConfirmTxModal state
  const [modalSummary, setModalSummary] = useState<TxSummary | null>(null);
  const resolveConfirmRef = useRef<((v: boolean) => void) | null>(null);

  const openConfirmModal = useCallback((summary: TxSummary): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveConfirmRef.current = resolve;
      setModalSummary(summary);
    });
  }, []);

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

  const destValid = isValidStellarAddress(destination);
  const amtNum = Number(amount);
  const amtValid = isFinite(amtNum) && amtNum > 0;
  const canSend = !!address && destValid && amtValid && !busy;

  async function doSend() {
    if (!address || !canSend) return;
    setError(null);
    setTxHash(null);

    const needsApproval = requiresApproval(amount, approvalLimitUsd());
    if (needsApproval && !secondApprovalConfirmed) {
      setNeedsSecondApproval(true);
      return;
    }

    setBusy(true);
    try {
      const seq = await fetchSequence(NETWORK, address);
      const xdr = await buildUsdcPaymentTx({
        sourcePublicKey: address,
        sourceSequence: seq,
        destination: destination.trim(),
        amount: amtNum.toFixed(7),
        network: NETWORK,
      });
      const result = await authorizePayment({
        xdr,
        network: NETWORK,
        publicKey: address,
        signHash,
        confirm: (summary) => openConfirmModal(summary),
        expect: { destination: destination.trim(), amount: amtNum.toFixed(7), assetCode: "USDC" },
      });
      setTxHash(result.hash);
      logAction({
        at: new Date().toISOString(),
        actor: address,
        action: "send",
        amount: amount,
        destination: destination.trim(),
        txHash: result.hash,
      });
      setDestination("");
      setAmount("");
      setSecondApprovalConfirmed(false);
      setNeedsSecondApproval(false);
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
            placeholder="G... endereço Stellar"
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

        {/* Second approver gate */}
        {needsSecondApproval && !secondApprovalConfirmed && (
          <div className="border-l-2 border-yellow-500 pl-4 py-4 mb-6 space-y-4">
            <p className="text-[10px] uppercase tracking-[0.14em] text-yellow-700">
              Confirmação adicional (acima de US$ {approvalLimitUsd()}). Controle dual real com 2º responsável chega na fase 2.
            </p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={secondApprovalConfirmed}
                onChange={(e) => setSecondApprovalConfirmed(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-xs text-[#0a0a0a]/70">Confirmo que esta transferência foi aprovada</span>
            </label>
          </div>
        )}

        {/* Send button */}
        <button
          onClick={doSend}
          disabled={!canSend || (needsSecondApproval && !secondApprovalConfirmed)}
          className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-40"
        >
          {busy ? "Processando..." : "Enviar"}
        </button>

        {/* Success */}
        {txHash && (
          <div className="mt-8 border-l-2 border-[#b5e853] pl-4">
            <div className="text-[10px] uppercase tracking-[0.18em] flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 bg-[#b5e853]" /> Transferência enviada
            </div>
            <a
              className="text-xs font-mono mt-2 block break-all hover:opacity-60"
              href={`https://stellar.expert/explorer/${EXPLORER}/tx/${txHash}`}
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
          Transferência via USDC na rede Stellar · non-custodial · irreversível
        </div>
      </div>
    </>
  );
}
