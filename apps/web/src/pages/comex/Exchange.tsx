import { useCallback, useRef, useState } from "react";
import { useComexWallet } from "../../lib/comexPrivy.tsx";
import { fetchSequence, buildUsdcPaymentTx } from "../../lib/stellar.ts";
import { authorizePayment } from "../../lib/authorizeTx.ts";
import { requiresApproval, approvalLimitUsd, logAction } from "../../lib/comexGuards.ts";
import * as pag from "../../lib/pagfinance.ts";
import ConfirmTxModal from "../../components/ConfirmTxModal.tsx";
import type { TxSummary } from "../../lib/txguard.ts";

const NETWORK = (import.meta.env.VITE_STELLAR_NETWORK ?? "PUBLIC").toUpperCase() as "TESTNET" | "PUBLIC";

type Phase = "idle" | "quoting" | "quoted" | "pix_waiting" | "signing" | "partner_pending" | "done" | "error";

export default function Exchange() {
  const { address, signHash } = useComexWallet();

  // Buy (R$->USD)
  const [buyAmount, setBuyAmount] = useState("");
  const [buyPhase, setBuyPhase] = useState<Phase>("idle");
  const [buyQuote, setBuyQuote] = useState<pag.PagQuote | null>(null);
  const [pixCode, setPixCode] = useState("");
  const [buyError, setBuyError] = useState("");

  // Sell (USD->R$)
  const [sellAmount, setSellAmount] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [sellPhase, setSellPhase] = useState<Phase>("idle");
  const [sellQuote, setSellQuote] = useState<pag.PagQuote | null>(null);
  const [txHash, setTxHash] = useState("");
  const [sellError, setSellError] = useState("");
  const [needsSecondApprovalSell, setNeedsSecondApprovalSell] = useState(false);
  const [secondApprovalConfirmedSell, setSecondApprovalConfirmedSell] = useState(false);

  // Modal
  const [modalSummary, setModalSummary] = useState<TxSummary | null>(null);
  const resolveConfirmRef = useRef<((v: boolean) => void) | null>(null);
  const openConfirmModal = useCallback((summary: TxSummary): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveConfirmRef.current = resolve;
      setModalSummary(summary);
    });
  }, []);
  function handleConfirm() { setModalSummary(null); resolveConfirmRef.current?.(true); resolveConfirmRef.current = null; }
  function handleCancel() { setModalSummary(null); resolveConfirmRef.current?.(false); resolveConfirmRef.current = null; }

  async function doGerarPix() {
    if (!address) return;
    setBuyError("");
    setBuyPhase("quoting");
    try {
      const assetId = await pag.stellarUsdcAssetId();
      const extId = pag.externalId();
      const q = await pag.quote({
        invoiceCode: "BRL_TO_USDC",
        invoiceType: "pix",
        assetId,
        amount: Number(buyAmount),
        sender: address,
        externalId: extId,
      });
      setBuyQuote(q);
      setBuyPhase("quoted");
    } catch (e: unknown) {
      setBuyError(e instanceof Error ? e.message : "erro ao cotar");
      setBuyPhase("error");
    }
  }

  async function doConfirmarCompra() {
    if (!address || !buyQuote) return;
    setBuyPhase("quoting");
    try {
      const result = await pag.createPayment({ quoteId: buyQuote.quoteId, sender: address });
      setPixCode(result.instruction ?? result.memo ?? "");
      setBuyPhase("pix_waiting");
    } catch (e: unknown) {
      setBuyError(e instanceof Error ? e.message : "erro ao criar pagamento");
      setBuyPhase("error");
    }
  }

  async function doVender() {
    if (!address) return;
    setSellError("");
    setSellPhase("quoting");
    try {
      const assetId = await pag.stellarUsdcAssetId();
      const extId = pag.externalId();
      const q = await pag.quote({
        invoiceCode: pixKey,
        invoiceType: "pix",
        assetId,
        amount: Number(sellAmount),
        sender: address,
        externalId: extId,
      });
      setSellQuote(q);
      setSellPhase("quoted");
    } catch (e: unknown) {
      setSellError(e instanceof Error ? e.message : "erro ao cotar");
      setSellPhase("error");
    }
  }

  async function doConfirmarVenda() {
    if (!address || !signHash || !sellQuote) return;

    const needsApproval = requiresApproval(sellAmount, approvalLimitUsd());
    if (needsApproval && !secondApprovalConfirmedSell) {
      setNeedsSecondApprovalSell(true);
      return;
    }

    setSellPhase("signing");
    try {
      const result = await pag.createPayment({ quoteId: sellQuote.quoteId, sender: address });
      const receiver = result.receiver ?? "";
      const amount = result.amount ?? sellAmount;
      const seq = await fetchSequence(NETWORK, address);
      const xdr = await buildUsdcPaymentTx({
        sourcePublicKey: address,
        sourceSequence: seq,
        destination: receiver,
        amount,
        network: NETWORK,
      });
      const { hash } = await authorizePayment({
        xdr,
        network: NETWORK,
        publicKey: address,
        signHash,
        confirm: openConfirmModal,
        expect: { destination: receiver, amount, assetCode: "USDC" },
      });
      setTxHash(hash);
      logAction({
        at: new Date().toISOString(),
        actor: address,
        action: "sell",
        amount: sellAmount,
        destination: receiver,
        txHash: hash,
      });
      try {
        await pag.submitPayment({ txHash: hash, sender: address });
        setSellPhase("done");
      } catch {
        setSellPhase("partner_pending");
      }
      setSecondApprovalConfirmedSell(false);
      setNeedsSecondApprovalSell(false);
    } catch (e: unknown) {
      setSellError(e instanceof Error ? e.message : "erro na transação");
      setSellPhase("error");
    }
  }

  const labelCls = "text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55";
  const inputCls = "w-full bg-transparent border border-[#0a0a0a]/20 p-4 text-4xl tabular-nums disabled:opacity-60";
  const btnCls = "w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-40";

  return (
    <div className="md:col-span-9 max-w-xl">
      {/* BUY */}
      <div className="space-y-6">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">Comprar dólar</p>
        <div>
          <p className={labelCls}>Valor em R$</p>
          <input
            className={inputCls}
            type="number"
            min="0"
            step="0.01"
            placeholder="0,00"
            value={buyAmount}
            onChange={e => setBuyAmount(e.target.value)}
            disabled={buyPhase === "quoting" || buyPhase === "pix_waiting"}
          />
        </div>

        {(buyPhase === "idle" || buyPhase === "error") && (
          <button className={btnCls} onClick={doGerarPix} disabled={!buyAmount || !address}>
            Cotar
          </button>
        )}

        {buyPhase === "quoted" && buyQuote && (
          <div className="space-y-4">
            <div className="border-l-2 border-[#0a0a0a]/15 pl-4 space-y-1">
              {buyQuote.valuesAndFees && (
                <>
                  <p className={labelCls}>Taxa: {buyQuote.valuesAndFees.totalFeeFiat} BRL</p>
                  <p className={labelCls}>Você recebe: {buyQuote.valuesAndFees.paymentInCrypto} USDC</p>
                </>
              )}
            </div>
            <button className={btnCls} onClick={doConfirmarCompra}>Gerar Pix</button>
            <button className="w-full py-3 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55" onClick={() => setBuyPhase("idle")}>Cancelar</button>
          </div>
        )}

        {buyPhase === "pix_waiting" && (
          <div className="space-y-4">
            <div className="border-l-2 border-[#b5e853] pl-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 bg-[#b5e853] inline-block" />
                <p className={labelCls}>Código Pix gerado</p>
              </div>
              <p className="text-xs font-mono break-all">{pixCode}</p>
            </div>
            <button className={btnCls} onClick={() => navigator.clipboard.writeText(pixCode)}>
              Copiar código Pix
            </button>
            <p className={labelCls}>Aguardando pagamento · USDC será creditado automaticamente</p>
            <button className="w-full py-3 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55" onClick={() => { setBuyPhase("idle"); setBuyQuote(null); setPixCode(""); }}>Nova operação</button>
          </div>
        )}

        {buyPhase === "quoting" && <p className={labelCls}>Aguarde...</p>}
        {buyPhase === "error" && buyError && (
          <p className="text-xs uppercase tracking-[0.18em] text-red-700 border-l-2 border-red-700 pl-3">{buyError}</p>
        )}
      </div>

      {/* DIVIDER */}
      <div className="border-t border-[#0a0a0a]/10 pt-10 mt-10" />

      {/* SELL */}
      <div className="space-y-6">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">Vender dólar</p>
        <div>
          <p className={labelCls}>Valor em USD</p>
          <input
            className={inputCls}
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={sellAmount}
            onChange={e => setSellAmount(e.target.value)}
            disabled={sellPhase === "quoting" || sellPhase === "signing"}
          />
        </div>
        <div>
          <p className={labelCls}>Chave Pix (destino)</p>
          <input
            className="w-full bg-transparent border border-[#0a0a0a]/20 p-4 text-base disabled:opacity-60"
            type="text"
            placeholder="CPF, e-mail, telefone ou chave aleatória"
            value={pixKey}
            onChange={e => setPixKey(e.target.value)}
            disabled={sellPhase === "quoting" || sellPhase === "signing"}
          />
        </div>

        {(sellPhase === "idle" || sellPhase === "error") && (
          <button className={btnCls} onClick={doVender} disabled={!sellAmount || !pixKey || !address}>
            Cotar
          </button>
        )}

        {sellPhase === "quoted" && sellQuote && (
          <div className="space-y-4">
            <div className="border-l-2 border-[#0a0a0a]/15 pl-4 space-y-1">
              {sellQuote.valuesAndFees && (
                <>
                  <p className={labelCls}>Taxa: {sellQuote.valuesAndFees.totalFeeCrypto} USDC</p>
                  <p className={labelCls}>Você recebe: R$ {sellQuote.valuesAndFees.paymentInFiat}</p>
                </>
              )}
            </div>
            {needsSecondApprovalSell && !secondApprovalConfirmedSell && (
              <div className="border-l-2 border-yellow-500 pl-4 py-4 space-y-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-yellow-700">
                  Confirmação adicional (acima de US$ {approvalLimitUsd()}). Controle dual real com 2º responsável chega na fase 2.
                </p>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={secondApprovalConfirmedSell}
                    onChange={(e) => setSecondApprovalConfirmedSell(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-xs text-[#0a0a0a]/70">Confirmo que esta venda foi aprovada</span>
                </label>
              </div>
            )}
            <button className={btnCls} onClick={doConfirmarVenda} disabled={needsSecondApprovalSell && !secondApprovalConfirmedSell}>Confirmar e assinar</button>
            <button className="w-full py-3 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55" onClick={() => { setSellPhase("idle"); setNeedsSecondApprovalSell(false); setSecondApprovalConfirmedSell(false); }}>Cancelar</button>
          </div>
        )}

        {(sellPhase === "quoting" || sellPhase === "signing") && <p className={labelCls}>Aguarde...</p>}

        {sellPhase === "done" && (
          <div className="border-l-2 border-[#b5e853] pl-4 space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-[#b5e853] inline-block" />
              <p className={labelCls}>Venda concluída</p>
            </div>
            <p className="text-xs font-mono text-[#0a0a0a]/55">{txHash}</p>
            <button className="mt-4 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55" onClick={() => { setSellPhase("idle"); setSellQuote(null); setTxHash(""); }}>Nova operação</button>
          </div>
        )}

        {sellPhase === "partner_pending" && (
          <div className="border-l-2 border-yellow-500 pl-4 space-y-1">
            <p className={labelCls}>Tx enviada · confirmando com parceiro</p>
            <p className="text-xs font-mono text-[#0a0a0a]/55">{txHash}</p>
            <p className="text-[10px] text-[#0a0a0a]/40">Guarde o hash. O Pix será creditado em breve.</p>
          </div>
        )}

        {sellPhase === "error" && sellError && (
          <p className="text-xs uppercase tracking-[0.18em] text-red-700 border-l-2 border-red-700 pl-3">{sellError}</p>
        )}
      </div>

      <p className="mt-10 text-[10px] text-[#0a0a0a]/40">Câmbio via PagFinance · parceiro licenciado · non-custodial · irreversível</p>

      {modalSummary && (
        <ConfirmTxModal
          summary={modalSummary}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
