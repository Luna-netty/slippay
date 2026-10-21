import { useCallback, useEffect, useRef, useState } from "react";
import { useComexWallet } from "../../lib/comexPrivy.tsx";
import { getPosition, getApy, buildDepositTx, buildWithdrawTx } from "../../lib/defindex.ts";
import { authorizeContractCall } from "../../lib/authorizeTx.ts";
import ConfirmTxModal from "../../components/ConfirmTxModal.tsx";
import type { TxSummary } from "../../lib/txguard.ts";

const NETWORK = (import.meta.env.VITE_STELLAR_NETWORK ?? "PUBLIC").toUpperCase() as "TESTNET" | "PUBLIC";

function vaultDisplay(): string {
  const v = import.meta.env.VITE_DEFINDEX_USDC_VAULT as string | undefined ?? "";
  if (v.length <= 10) return v;
  return `${v.slice(0, 6)}...${v.slice(-4)}`;
}

type ActionPhase = "idle" | "loading" | "done" | "error";

export default function Yield() {
  const { address, signHash } = useComexWallet();
  const [position, setPosition] = useState<{ usdc: string } | null>(null);
  const [apy, setApy] = useState<number | null>(null);
  const [loadingPosition, setLoadingPosition] = useState(false);

  const [depositAmount, setDepositAmount] = useState("");
  const [depositPhase, setDepositPhase] = useState<ActionPhase>("idle");
  const [depositError, setDepositError] = useState("");

  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawPhase, setWithdrawPhase] = useState<ActionPhase>("idle");
  const [withdrawError, setWithdrawError] = useState("");

  const [modalSummary, setModalSummary] = useState<TxSummary | null>(null);
  const [modalIntent, setModalIntent] = useState<string | undefined>(undefined);
  const resolveConfirmRef = useRef<((v: boolean) => void) | null>(null);

  const openConfirmModal = useCallback((summary: TxSummary, intent?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveConfirmRef.current = resolve;
      setModalIntent(intent);
      setModalSummary(summary);
    });
  }, []);

  function handleConfirm() { setModalSummary(null); setModalIntent(undefined); resolveConfirmRef.current?.(true); resolveConfirmRef.current = null; }
  function handleCancel() { setModalSummary(null); setModalIntent(undefined); resolveConfirmRef.current?.(false); resolveConfirmRef.current = null; }

  async function loadPosition() {
    if (!address) return;
    setLoadingPosition(true);
    try {
      const [pos, a] = await Promise.all([getPosition(address), getApy()]);
      setPosition(pos);
      setApy(a);
    } catch {
      // silent — position stays null
    } finally {
      setLoadingPosition(false);
    }
  }

  useEffect(() => {
    if (address) loadPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function doAplicar() {
    if (!address || !signHash) return;
    setDepositError("");
    setDepositPhase("loading");
    const intent = `Depósito de ${depositAmount} USDC no cofre de rendimento (${vaultDisplay()})`;
    try {
      const xdr = await buildDepositTx(address, depositAmount);
      await authorizeContractCall({ xdr, network: NETWORK, publicKey: address, signHash, confirm: (s) => openConfirmModal(s, intent) });
      setDepositPhase("done");
      setDepositAmount("");
      await loadPosition();
    } catch (e: unknown) {
      setDepositError(e instanceof Error ? e.message : "erro ao aplicar");
      setDepositPhase("error");
    }
  }

  async function doResgatar() {
    if (!address || !signHash) return;
    setWithdrawError("");
    setWithdrawPhase("loading");
    const intent = `Resgate de ${withdrawAmount} USDC do cofre de rendimento`;
    try {
      const xdr = await buildWithdrawTx(address, withdrawAmount);
      await authorizeContractCall({ xdr, network: NETWORK, publicKey: address, signHash, confirm: (s) => openConfirmModal(s, intent) });
      setWithdrawPhase("done");
      setWithdrawAmount("");
      await loadPosition();
    } catch (e: unknown) {
      setWithdrawError(e instanceof Error ? e.message : "erro ao resgatar");
      setWithdrawPhase("error");
    }
  }

  const labelCls = "text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55";
  const inputCls = "w-full bg-transparent border border-[#0a0a0a]/20 p-4 text-4xl tabular-nums disabled:opacity-60";
  const btnCls = "w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-40";

  return (
    <div className="md:col-span-9 max-w-xl">
      {/* Position */}
      <div className="mb-10">
        <p className={labelCls}>Posição atual</p>
        {loadingPosition ? (
          <p className="text-6xl md:text-7xl tabular-nums text-[#0a0a0a]/30">—</p>
        ) : (
          <p className="text-6xl md:text-7xl tabular-nums">$ {position?.usdc ?? "0.00"}</p>
        )}
        {apy !== null && (
          <p className={`mt-1 ${labelCls}`}>{apy.toFixed(2)}% a.a. (variável)</p>
        )}
        <p className="mt-3 text-[10px] text-[#0a0a0a]/55 border-l-2 border-[#0a0a0a]/15 pl-3">
          Rendimento variável, sem garantia, principal em risco. Não é poupança nem produto da Slippay.
        </p>
      </div>

      {/* APLICAR */}
      <div className="space-y-6">
        <p className={labelCls}>Aplicar</p>
        <div>
          <p className={labelCls}>Valor USDC</p>
          <input
            className={inputCls}
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={depositAmount}
            onChange={e => setDepositAmount(e.target.value)}
            disabled={depositPhase === "loading"}
          />
        </div>
        <button
          className={btnCls}
          onClick={doAplicar}
          disabled={!depositAmount || !address || depositPhase === "loading"}
        >
          {depositPhase === "loading" ? "Aguarde..." : "Aplicar"}
        </button>
        {depositPhase === "done" && (
          <div className="border-l-2 border-[#b5e853] pl-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-[#b5e853] inline-block" />
            <p className={labelCls}>Aplicação concluída</p>
          </div>
        )}
        {depositPhase === "error" && depositError && (
          <p className="text-xs uppercase tracking-[0.18em] text-red-700 border-l-2 border-red-700 pl-3">{depositError}</p>
        )}
      </div>

      {/* DIVIDER */}
      <div className="border-t border-[#0a0a0a]/10 pt-10 mt-10" />

      {/* RESGATAR */}
      <div className="space-y-6">
        <p className={labelCls}>Resgatar</p>
        <div>
          <p className={labelCls}>Valor USDC</p>
          <input
            className={inputCls}
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={withdrawAmount}
            onChange={e => setWithdrawAmount(e.target.value)}
            disabled={withdrawPhase === "loading"}
          />
        </div>
        <button
          className={btnCls}
          onClick={doResgatar}
          disabled={!withdrawAmount || !address || withdrawPhase === "loading"}
        >
          {withdrawPhase === "loading" ? "Aguarde..." : "Resgatar"}
        </button>
        {withdrawPhase === "done" && (
          <div className="border-l-2 border-[#b5e853] pl-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-[#b5e853] inline-block" />
            <p className={labelCls}>Resgate concluído</p>
          </div>
        )}
        {withdrawPhase === "error" && withdrawError && (
          <p className="text-xs uppercase tracking-[0.18em] text-red-700 border-l-2 border-red-700 pl-3">{withdrawError}</p>
        )}
      </div>

      {modalSummary && (
        <ConfirmTxModal
          summary={modalSummary}
          intent={modalIntent}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
