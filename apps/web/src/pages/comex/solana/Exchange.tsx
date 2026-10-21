// Exchange.tsx — câmbio R$<->USD via 4P Finance.
//
// Comprar dólar (R$ -> USDC): uses the 4P on-ramp flow (Pix payment -> USDC settled).
// Vender dólar (USDC -> R$): uses the 4P off-ramp flow (on-chain USDC transfer -> Pix BRL).
//
// Off-ramp endpoint gate: if /v1/4p/offramp/quote returns 503/404 (not live),
// the panel shows "venda em ativação" and does NOT crash.
//
// Security gate (sell path): authorizeSolanaPayment enforces build->decode->assert->confirm
// before any signature. On-chain send failure after signature shows the raw signature
// for manual recovery — never shows false success.
//
// [I-3] Receiver pin: before building the tx, the sell flow asserts ordData.receiver
// equals VITE_4P_OFFRAMP_RECEIVER (client-pinned). If unset, sell is disabled.
// If mismatched, operation is blocked before sign.

import { useCallback, useEffect, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useComexSolanaWallet } from "../../../lib/comexSolana.tsx";
import { authorizeSolanaPayment } from "../../../lib/solanaAuthorize.ts";
import { rpcUrl } from "../../../lib/chain/solana/usdc.ts";
import ConfirmTxModal from "../../../components/ConfirmTxModal.tsx";
import type { TxSummary } from "../../../lib/txguard.ts";
import {
  status4p,
  quote4p,
  createOnramp4p,
  getOnramp4p,
  quoteOfframp4p,
  createOfframp4p,
  getOfframp4p,
  Ramp4pError,
  type Ramp4pOrder,
} from "../../../lib/ramp4p.ts";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

type Direction = "buy" | "sell";

const DONE_STATUSES = ["paid", "completed", "confirmed"];

// [I-3] Client-pinned 4P off-ramp receiver address.
// Must be set in env; if absent, sell flow is disabled.
const PINNED_4P_RECEIVER: string | undefined =
  import.meta.env.VITE_4P_OFFRAMP_RECEIVER as string | undefined;

// ---------------------------------------------------------------------------
// Buy sub-panel (R$ -> USDC)
// ---------------------------------------------------------------------------

type BuyStep = "amount" | "identity" | "pix" | "done";
const BUY_PRESETS = [100, 500, 1000, 5000];
const onlyDigits = (s: string) => s.replace(/\D/g, "");

function BuyPanel({ address, email: initialEmail }: { address: string; email: string | null }) {
  const [brl, setBrl] = useState(1000);
  const [cryptoOut, setCryptoOut] = useState<number | null>(null);
  const [asset, setAsset] = useState("USDC");
  const [chain, setChain] = useState("Solana");
  const [step, setStep] = useState<BuyStep>("amount");

  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState(initialEmail ?? "");

  const [order, setOrder] = useState<Ramp4pOrder | null>(null);
  const [orderStatus, setOrderStatus] = useState("pending");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    status4p().then((s) => {
      if (s.asset) setAsset(s.asset);
      if (s.chain) setChain(s.chain);
    });
  }, []);

  useEffect(() => {
    let on = true;
    if (brl <= 0) { setCryptoOut(null); return; }
    quote4p(brl).then((q) => on && setCryptoOut(q.cryptoOut)).catch(() => { /* keep last */ });
    return () => { on = false; };
  }, [brl]);

  // poll until settled
  useEffect(() => {
    if (step !== "pix" || !order) return;
    if (DONE_STATUSES.includes(orderStatus.toLowerCase())) { setStep("done"); return; }
    const t = setTimeout(async () => {
      try {
        const o = await getOnramp4p(order.id);
        if (o.transactionStatus) setOrderStatus(o.transactionStatus);
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearTimeout(t);
  }, [step, order, orderStatus]);

  async function confirm() {
    setErr(null);
    if (!address) { setErr("Conta não disponível — autentique-se primeiro."); return; }
    if (onlyDigits(cpf).length !== 11) { setErr("CPF inválido (11 dígitos)."); return; }
    if (!email) { setErr("E-mail obrigatório."); return; }
    setBusy(true);
    try {
      const o = await createOnramp4p({
        amountBrl: brl,
        receiverWallet: address,
        email,
        cpf: onlyDigits(cpf),
      });
      setOrder(o);
      setOrderStatus(o.status ?? "pending");
      setStep("pix");
    } catch (e) {
      setErr(e instanceof Ramp4pError ? e.message : "Não foi possível criar a cobrança. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  function copyPix() {
    const code = order?.pixCopiaECola;
    if (!code) return;
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* */ });
  }

  return (
    <div className="space-y-6">
      {step === "amount" && (
        <>
          <div className="border border-[#0a0a0a]/15 p-6">
            <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-3 block">
              Você envia
            </label>
            <div className="flex items-baseline gap-2">
              <span className="text-xl text-[#0a0a0a]/55">R$</span>
              <input
                type="number"
                min={0}
                value={brl}
                onChange={(e) => setBrl(Math.max(0, Number(e.target.value)))}
                className="w-full bg-transparent outline-none text-4xl tabular-nums"
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {BUY_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setBrl(p)}
                  className={[
                    "px-4 py-1.5 text-xs border transition-colors",
                    brl === p
                      ? "bg-[#0a0a0a] text-[#f1eee7] border-[#0a0a0a]"
                      : "border-[#0a0a0a]/20 hover:border-[#0a0a0a]/50",
                  ].join(" ")}
                >
                  R$ {p.toLocaleString("pt-BR")}
                </button>
              ))}
            </div>
            <div className="my-5 h-px bg-[#0a0a0a]/10" />
            <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-3 block">
              Você recebe (aprox.)
            </label>
            <div className="flex items-baseline gap-2">
              <span className="text-xl text-[#0a0a0a]/45">$</span>
              <span className="text-4xl tabular-nums">
                {cryptoOut != null
                  ? cryptoOut.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : "—"}
              </span>
              <span className="text-lg text-[#0a0a0a]/45">{asset}</span>
            </div>
            <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/40">
              {asset} na rede {chain} · valor final fixado no pagamento
            </div>
          </div>
          <button
            onClick={() => setStep("identity")}
            disabled={cryptoOut == null || brl <= 0}
            className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-40"
          >
            Continuar com Pix
          </button>
        </>
      )}

      {step === "identity" && (
        <div className="border border-[#0a0a0a]/15 p-6 space-y-4">
          <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block">
            Dados para o Pix
          </label>
          <input
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="CPF (11 digitos)"
            inputMode="numeric"
            className="w-full bg-transparent border border-[#0a0a0a]/20 p-4 text-sm"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-mail (recibo)"
            inputMode="email"
            className="w-full bg-transparent border border-[#0a0a0a]/20 p-4 text-sm"
          />
          {err && <div className="text-xs uppercase tracking-[0.14em] text-red-700 border-l-2 border-red-700 pl-3">{err}</div>}
          <div className="flex gap-4 items-center pt-2">
            <button
              onClick={confirm}
              disabled={busy}
              className="flex-1 bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              {busy ? "Gerando Pix..." : `Gerar Pix de R$ ${brl.toLocaleString("pt-BR")}`}
            </button>
            <button
              onClick={() => setStep("amount")}
              className="text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/45 hover:text-[#0a0a0a]"
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {step === "pix" && order && (
        <div className="border border-[#0a0a0a]/15 p-6 space-y-4">
          <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block">
            Pague com Pix
          </label>
          <p className="text-sm text-[#0a0a0a]/70">
            Copie o codigo e pague no seu banco. O {asset} cai na sua carteira assim que o Pix confirmar.
          </p>
          <div className="border border-[#0a0a0a]/15 p-4 font-mono text-xs break-all text-[#0a0a0a]/80 bg-[#0a0a0a]/3">
            {order.pixCopiaECola ?? "—"}
          </div>
          <button
            onClick={copyPix}
            className="w-full border border-[#0a0a0a] py-4 text-sm uppercase tracking-[0.18em] hover:bg-[#0a0a0a]/5"
          >
            {copied ? "Copiado" : "Copiar codigo Pix"}
          </button>
          <div className="flex items-center gap-2 text-xs text-[#0a0a0a]/55">
            <span className="inline-block h-2 w-2 bg-[#FDDA24] animate-pulse" />
            Aguardando pagamento... ({orderStatus})
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="border-l-2 border-[#FDDA24] pl-4">
          <div className="text-[10px] uppercase tracking-[0.18em] flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 bg-[#FDDA24]" /> Pagamento confirmado
          </div>
          <p className="text-sm text-[#0a0a0a]/70 mt-2">
            O {asset} esta sendo enviado para a sua carteira na rede {chain}.
          </p>
        </div>
      )}

      <div className="text-[10px] text-[#0a0a0a]/40 border-t border-[#0a0a0a]/10 pt-4">
        Nao-custodial: a 4P (licenciada) liquida direto na sua carteira. A Slippay nao segura seu dinheiro.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sell sub-panel (USDC -> R$)
// ---------------------------------------------------------------------------

type SellStep = "form" | "confirming" | "sending" | "done" | "recovery";

function SellPanel({ address, signTransaction }: {
  address: string;
  signTransaction: (tx: import("@solana/web3.js").Transaction) => Promise<import("@solana/web3.js").Transaction>;
}) {
  const [usdc, setUsdc] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [quote, setQuote] = useState<import("../../../lib/ramp4p.ts").Offramp4pQuote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [offRampPending, setOffRampPending] = useState(false);

  const [step, setStep] = useState<SellStep>("form");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // on-chain signature (known after sign+send, used for recovery state)
  const [sig, setSig] = useState<string | null>(null);
  // order id for polling
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState("pending");

  // ConfirmTxModal wiring
  const [modalSummary, setModalSummary] = useState<TxSummary | null>(null);
  const resolveConfirmRef = useRef<((v: boolean) => void) | null>(null);

  const usdcNum = Number(usdc);
  const usdcValid = isFinite(usdcNum) && usdcNum > 0;

  // [I-3] If PINNED_4P_RECEIVER is not configured, sell is entirely disabled.
  const receiverConfigured = !!PINNED_4P_RECEIVER;

  // Fetch quote when amount changes
  useEffect(() => {
    let on = true;
    if (!usdcValid) { setQuote(null); setQuoteErr(null); return; }
    setQuoteBusy(true);
    setQuoteErr(null);
    quoteOfframp4p(usdcNum)
      .then((q) => {
        if (!on) return;
        setQuote(q);
        setOffRampPending(q.brlOut === null);
      })
      .catch((e) => {
        if (!on) return;
        setQuoteErr(e instanceof Ramp4pError ? e.message : "Erro ao buscar cotacao.");
      })
      .finally(() => { if (on) setQuoteBusy(false); });
    return () => { on = false; };
  }, [usdc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll order status
  useEffect(() => {
    if (step !== "sending" || !orderId) return;
    if (DONE_STATUSES.includes(orderStatus.toLowerCase())) { setStep("done"); return; }
    const t = setTimeout(async () => {
      try {
        const o = await getOfframp4p(orderId);
        if (o.transactionStatus) setOrderStatus(o.transactionStatus);
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearTimeout(t);
  }, [step, orderId, orderStatus]);

  const openConfirmModal = useCallback(
    // [I-2] decoded now carries ownerAddress; display it, not the ATA.
    (decoded: { to: string; amount: string; ownerAddress: string }): Promise<boolean> => {
      return new Promise((resolve) => {
        resolveConfirmRef.current = resolve;
        const summary: TxSummary = {
          source: address,
          fee: "~0.000005 SOL",
          operations: [
            {
              type: "payment",
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

  async function doSell() {
    if (!usdcValid || !pixKey.trim() || !address) return;
    // [I-3] Receiver must be configured before we allow any sell.
    if (!receiverConfigured) {
      setErr("Venda em ativação (receiver não configurado).");
      return;
    }
    setErr(null);
    setBusy(true);
    setStep("confirming");

    let ordData: { id: string; receiver: string; amount: string };
    try {
      // Solana comex is reference-only (live comex runs on Base); email/doc are
      // not collected here. Kept compiling against the current off-ramp signature.
      ordData = await createOfframp4p({ usdc: usdcNum, pixKey: pixKey.trim(), sender: address, email: "", doc: "" });
    } catch (e) {
      setErr(e instanceof Ramp4pError ? e.message : "Endpoint de venda nao disponivel ainda.");
      setStep("form");
      setBusy(false);
      return;
    }

    // [I-3] Assert receiver matches client-pinned address BEFORE building/signing.
    if (ordData.receiver !== PINNED_4P_RECEIVER) {
      setErr("receiver 4P inesperado — operação bloqueada");
      setStep("form");
      setBusy(false);
      return;
    }

    // Got receiver + amount from 4P (pinned OK). Now build->decode->assert->confirm->sign->send.
    let signature: string;
    let confirmed: boolean;
    try {
      const connection = new Connection(rpcUrl());
      const result = await authorizeSolanaPayment({
        connection,
        from: new PublicKey(address),
        to: new PublicKey(ordData.receiver),
        usdcAmount: ordData.amount,
        signTransaction,
        confirm: (decoded) => openConfirmModal(decoded),
      });
      signature = result.signature;
      confirmed = result.confirmed;
      setSig(signature);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao assinar ou enviar transacao.";
      if (msg === "cancelado pelo usuário") {
        setErr("Transacao cancelada.");
        setStep("form");
      } else if (sig) {
        // sig was set by a prior send attempt — show recovery
        setStep("recovery");
        setErr("Transacao enviada mas confirmacao falhou. Verifique o status com a assinatura abaixo.");
      } else {
        setErr(msg);
        setStep("form");
      }
      setBusy(false);
      return;
    }

    // [I-1] If send succeeded but confirmation timed out, go to recovery so user
    // can see the sig + solscan link. Never show false success.
    if (!confirmed) {
      setStep("recovery");
      setErr("Transacao enviada, aguardando confirmacao on-chain. Verifique o status abaixo.");
      setBusy(false);
      return;
    }

    // On-chain send + confirmed. Start polling 4P for settlement.
    setOrderId(ordData.id);
    setOrderStatus("pending");
    setStep("sending");
    setBusy(false);
  }

  // [I-3] Gate: receiver not configured → sell unavailable.
  if (!receiverConfigured) {
    return (
      <div className="space-y-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">Vender USDC</div>
        <div className="border border-[#0a0a0a]/15 p-6 text-sm text-[#0a0a0a]/60">
          Venda em ativação (receiver não configurado) — disponível em breve.
        </div>
      </div>
    );
  }

  if (offRampPending && usdcValid) {
    // Quote returned null -> endpoint not live yet. Show friendly message, no crash.
    return (
      <div className="space-y-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">Vender USDC</div>
        <div className="border border-[#0a0a0a]/15 p-6 text-sm text-[#0a0a0a]/60">
          Venda em ativacao — endpoint 4P pendente. Disponivel em breve.
        </div>
        <button onClick={() => { setUsdc(""); setOffRampPending(false); }}
          className="text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/45 hover:text-[#0a0a0a]">
          Limpar
        </button>
      </div>
    );
  }

  return (
    <>
      {modalSummary && (
        <ConfirmTxModal
          summary={modalSummary}
          intent={`Vender ${usdc} USDC — receber R$ ${quote?.brlOut?.toLocaleString("pt-BR") ?? "—"} via Pix`}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      <div className="space-y-6">
        {(step === "form" || step === "confirming") && (
          <>
            <div className="border border-[#0a0a0a]/15 p-6 space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-3 block">
                  Valor em USDC
                </label>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl text-[#0a0a0a]/45">$</span>
                  <input
                    type="number"
                    value={usdc}
                    onChange={(e) => setUsdc(e.target.value)}
                    disabled={busy}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full bg-transparent outline-none text-4xl tabular-nums disabled:opacity-60"
                  />
                  <span className="text-lg text-[#0a0a0a]/45">USDC</span>
                </div>
              </div>

              {usdcValid && (
                <div className="h-px bg-[#0a0a0a]/10" />
              )}

              {usdcValid && (
                <div>
                  <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-1 block">
                    Voce recebe (aprox.)
                  </label>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl text-[#0a0a0a]/45">R$</span>
                    <span className="text-4xl tabular-nums">
                      {quoteBusy
                        ? "..."
                        : quote?.brlOut != null
                          ? quote.brlOut.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : "—"}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/40">
                    via Pix · valor final fixado no envio
                  </div>
                  {quoteErr && (
                    <div className="mt-2 text-xs uppercase tracking-[0.14em] text-red-700 border-l-2 border-red-700 pl-3">{quoteErr}</div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-3 block">
                Chave Pix para receber
              </label>
              <input
                type="text"
                value={pixKey}
                onChange={(e) => setPixKey(e.target.value)}
                disabled={busy}
                placeholder="CPF, e-mail, telefone ou chave aleatoria"
                className="w-full bg-transparent border border-[#0a0a0a]/20 p-4 text-sm disabled:opacity-60"
              />
            </div>

            {err && (
              <div className="text-xs uppercase tracking-[0.14em] text-red-700 border-l-2 border-red-700 pl-3">{err}</div>
            )}

            <button
              onClick={doSell}
              disabled={busy || !usdcValid || !pixKey.trim() || quoteBusy || quote?.brlOut == null}
              className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              {step === "confirming" ? "Aguardando confirmacao..." : "Vender USDC"}
            </button>
          </>
        )}

        {step === "sending" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-[#0a0a0a]/55">
              <span className="inline-block h-2 w-2 bg-[#FDDA24] animate-pulse" />
              Confirmando com a 4P... ({orderStatus})
            </div>
            {sig && (
              <div className="border-l-2 border-[#0a0a0a]/20 pl-4">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/55 mb-1">
                  Assinatura on-chain
                </div>
                <a
                  href={`https://solscan.io/tx/${sig}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs break-all hover:opacity-60"
                >
                  {sig}
                </a>
              </div>
            )}
          </div>
        )}

        {step === "done" && (
          <div className="border-l-2 border-[#FDDA24] pl-4">
            <div className="text-[10px] uppercase tracking-[0.18em] flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 bg-[#FDDA24]" /> Liquidacao confirmada
            </div>
            <p className="text-sm text-[#0a0a0a]/70 mt-2">
              O Pix sera enviado para a chave {pixKey}. Status final: {orderStatus}.
            </p>
            {sig && (
              <a
                href={`https://solscan.io/tx/${sig}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[10px] mt-2 block break-all hover:opacity-60 text-[#0a0a0a]/40"
              >
                {sig}
              </a>
            )}
          </div>
        )}

        {step === "recovery" && (
          <div className="border-l-2 border-red-600 pl-4 space-y-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-red-700">
              Enviado, confirmando...
            </div>
            <p className="text-xs text-[#0a0a0a]/70">
              {err ?? "Transacao enviada. Aguardando confirmacao on-chain."}
            </p>
            {sig && (
              <a
                href={`https://solscan.io/tx/${sig}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[10px] break-all hover:opacity-60 text-[#0a0a0a]/55 block"
              >
                {sig}
              </a>
            )}
          </div>
        )}

        <div className="text-[10px] text-[#0a0a0a]/40 border-t border-[#0a0a0a]/10 pt-4">
          USDC enviado on-chain · BRL liquidado via Pix pela 4P (licenciada) · irreversivel
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Exchange (root)
// ---------------------------------------------------------------------------

export default function Exchange() {
  const { address, email, signTransaction } = useComexSolanaWallet();
  const [direction, setDirection] = useState<Direction>("buy");
  const [rampEnabled, setRampEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    status4p().then((s) => setRampEnabled(s.enabled));
  }, []);

  return (
    <div className="md:col-span-9 max-w-xl">
      <div className="text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-8 block">
        Cambio R$&harr;USD
      </div>

      {/* Direction toggle */}
      <div className="flex gap-0 mb-8 border border-[#0a0a0a]/15">
        {(["buy", "sell"] as Direction[]).map((d) => (
          <button
            key={d}
            onClick={() => setDirection(d)}
            className={[
              "flex-1 py-3 text-[10px] uppercase tracking-[0.18em] transition-colors",
              direction === d
                ? "bg-[#0a0a0a] text-[#f1eee7]"
                : "text-[#0a0a0a]/45 hover:text-[#0a0a0a]/70",
            ].join(" ")}
          >
            {d === "buy" ? "Comprar (R$→USD)" : "Vender (USD→R$)"}
          </button>
        ))}
      </div>

      {/* Buy: gate on enabled */}
      {direction === "buy" && rampEnabled === false && (
        <div className="border border-[#0a0a0a]/15 p-6 text-sm text-[#0a0a0a]/60">
          Cambio em ativacao (aguardando 4P)
        </div>
      )}

      {direction === "buy" && rampEnabled !== false && address && (
        <BuyPanel address={address} email={email} />
      )}

      {direction === "buy" && rampEnabled !== false && !address && (
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/40">
          Conta nao disponivel — autentique-se primeiro.
        </div>
      )}

      {/* Sell */}
      {direction === "sell" && address && (
        <SellPanel address={address} signTransaction={signTransaction} />
      )}

      {direction === "sell" && !address && (
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/40">
          Conta nao disponivel — autentique-se primeiro.
        </div>
      )}
    </div>
  );
}
