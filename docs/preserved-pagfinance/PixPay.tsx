import { useEffect, useState } from "react";
import { Logo } from "../components/Logo.tsx";
import { connectWallet, signTx } from "../lib/wallet.ts";
import { buildUsdcPaymentTx, fetchSequence, submitSignedTx } from "../lib/stellar.ts";
import * as pag from "../lib/pagfinance.ts";

type Step = "input" | "validated" | "quoted" | "paying" | "done" | "error";

const NETWORK = (import.meta.env.VITE_STELLAR_NETWORK ?? "PUBLIC").toUpperCase() as "TESTNET" | "PUBLIC";
const EXPLORER = NETWORK === "PUBLIC" ? "public" : "testnet";

export default function PixPay() {
  const [step, setStep] = useState<Step>("input");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [transfer, setTransfer] = useState<pag.PagTransfer | null>(null);

  const [assetId, setAssetId] = useState<number | null>(null);
  const [quote, setQuote] = useState<pag.PagQuote | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // pull the Stellar USDC asset id from PagFinance once.
  useEffect(() => {
    pag.stellarUsdcAssetId().then(setAssetId).catch(e => setError(e.message));
  }, []);

  const amountBRL = transfer ? (transfer.amount > 0 ? transfer.amount : Number(manualAmount || 0)) : 0;
  const v = quote?.valuesAndFees;

  async function doValidate() {
    setError(null); setBusy(true);
    try {
      const t = await pag.validateCode(code.trim());
      setTransfer(t);
      setStep("validated");
    } catch (e) { setError(msg(e)); }
    finally { setBusy(false); }
  }

  async function doQuote() {
    setError(null); setBusy(true);
    try {
      if (!assetId) throw new Error("asset not ready");
      if (!transfer?.invoiceCode) throw new Error("missing invoice code");
      if (amountBRL <= 0) throw new Error("informe um valor");
      const q = await pag.quote({
        invoiceCode: transfer.invoiceCode,
        invoiceTransferType: transfer.type,
        assetId,
        amount: amountBRL,
        sender: wallet ?? undefined,
        externalId: pag.externalId(),
      });
      setQuote(q);
      setStep("quoted");
    } catch (e) { setError(msg(e)); }
    finally { setBusy(false); }
  }

  async function doPay() {
    setError(null); setBusy(true); setStep("paying");
    try {
      if (!wallet) throw new Error("connect wallet first");
      if (!quote?.quoteId) throw new Error("no quote");
      const created = await pag.createPayment({ quoteId: quote.quoteId, sender: wallet });
      if (!created.receiver || !created.amount) throw new Error("pagfinance did not return receiver/amount");

      const seq = await fetchSequence(NETWORK, wallet);
      const xdr = await buildUsdcPaymentTx({
        sourcePublicKey: wallet,
        sourceSequence: seq,
        destination: created.receiver,
        amount: created.amount,
        memoText: created.memo,
        network: NETWORK,
      });
      const signed = await signTx(xdr);
      const { hash } = await submitSignedTx(NETWORK, signed);
      setTxHash(hash);

      // best-effort notify; many flows just track on-chain.
      try { await pag.submitPayment({ quoteId: quote.quoteId, txHash: hash, sender: wallet }); } catch { /* non-fatal */ }
      setStep("done");
    } catch (e) { setError(msg(e)); setStep("error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] flex flex-col">
      <header className="max-w-[1400px] w-full mx-auto px-8 md:px-12 py-8 flex items-center justify-between">
        <Logo />
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">Pague um PIX com USDC</div>
      </header>

      <main className="flex-1 flex items-center">
        <div className="max-w-[1400px] w-full mx-auto px-8 md:px-12 grid md:grid-cols-12 gap-8 md:gap-16 py-16 md:py-24">
          <div className="md:col-span-3 text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55">
            <span className="inline-block w-3 h-3 bg-[#b5e853] mr-2 align-middle" />
            001. PIX com USDC
          </div>

          <div className="md:col-span-9 max-w-xl">
            {/* step: input code */}
            <label className="text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-4 block">Código PIX (copia e cola)</label>
            <textarea
              value={code}
              onChange={e => setCode(e.target.value)}
              disabled={step !== "input"}
              rows={3}
              placeholder="00020126..."
              className="w-full bg-transparent border border-[#0a0a0a]/20 p-4 font-mono text-sm break-all disabled:opacity-60"
            />
            {step === "input" && (
              <button onClick={doValidate} disabled={busy || !code.trim()}
                className="mt-4 w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-50">
                {busy ? "Validando..." : "Validar código"}
              </button>
            )}

            {/* step: validated -> show payee, amount, quote */}
            {transfer && step !== "input" && (
              <div className="mt-10">
                <div className="text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-2">Você paga</div>
                {transfer.amount > 0 ? (
                  <div className="text-6xl md:text-7xl font-medium tabular-nums tracking-[-0.04em] leading-[0.9]">
                    R$ {Number(amountBRL).toFixed(2)}
                  </div>
                ) : (
                  <input type="number" value={manualAmount} onChange={e => setManualAmount(e.target.value)} disabled={step !== "validated"}
                    placeholder="valor em R$"
                    className="w-full bg-transparent border-b border-[#0a0a0a]/30 text-4xl tabular-nums py-2 disabled:opacity-60" />
                )}
                {transfer.payerName && <div className="mt-3 text-sm text-[#0a0a0a]/70">{transfer.payerName}</div>}
                {transfer.pixKey && <div className="mt-1 text-xs font-mono text-[#0a0a0a]/55 break-all">{transfer.pixKey}</div>}
              </div>
            )}

            {/* quote breakdown */}
            {v && (
              <div className="mt-8 border-l-2 border-[#0a0a0a]/20 pl-4 text-sm space-y-1">
                <Row k="Valor do PIX" val={`R$ ${v.paymentInFiat?.toFixed(2)}`} />
                <Row k="Taxa" val={`R$ ${v.totalFeeFiat?.toFixed(2)}`} />
                <Row k="Você envia" val={`${Number(v.totalCrypto ?? v.paymentInCrypto).toFixed(6)} USDC`} bold />
              </div>
            )}

            {/* connect wallet */}
            {step === "validated" && (
              <div className="mt-8">
                {!wallet ? (
                  <button onClick={async () => { try { setWallet(await connectWallet()); } catch (e) { setError(msg(e)); } }}
                    className="w-full border border-[#0a0a0a] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#0a0a0a] hover:text-[#f1eee7]">
                    Conectar carteira
                  </button>
                ) : (
                  <>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-3">
                      Conectado · <span className="font-mono normal-case">{wallet.slice(0,8)}...{wallet.slice(-4)}</span>
                    </div>
                    <button onClick={doQuote} disabled={busy || amountBRL <= 0}
                      className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-50">
                      {busy ? "Cotando..." : "Cotar"}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* pay */}
            {(step === "quoted" || step === "paying") && (
              <button onClick={doPay} disabled={busy}
                className="mt-8 w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-50">
                {step === "paying" ? "Processando..." : "Pagar PIX"}
              </button>
            )}

            {/* done */}
            {step === "done" && (
              <div className="mt-8 border-l-2 border-[#b5e853] pl-4">
                <div className="text-[10px] uppercase tracking-[0.18em] flex items-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 bg-[#b5e853]" /> PIX enviado · USDC debitado
                </div>
                {txHash && (
                  <a className="text-xs font-mono mt-2 block break-all hover:opacity-60"
                     href={`https://stellar.expert/explorer/${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
                    {txHash}
                  </a>
                )}
              </div>
            )}

            {error && <div className="mt-6 text-xs uppercase tracking-[0.18em] text-red-700 border-l-2 border-red-700 pl-3">{error}</div>}
          </div>
        </div>
      </main>

      <footer className="border-t border-[#0a0a0a]/10">
        <div className="max-w-[1400px] mx-auto px-8 md:px-12 py-6 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">
          Non-custodial · USDC by Circle · PIX via PagFinance
        </div>
      </footer>
    </div>
  );
}

function Row({ k, val, bold }: { k: string; val: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#0a0a0a]/55">{k}</span>
      <span className={`tabular-nums ${bold ? "font-medium" : "text-[#0a0a0a]/80"}`}>{val}</span>
    </div>
  );
}

function msg(e: unknown): string { return e instanceof Error ? e.message : "erro desconhecido"; }
