// Exchange.tsx — câmbio R$<->USD via 4P Finance, rede Base.
//
// Comprar (R$ -> USDC): 4P on-ramp (Pix payment -> USDC settled on Base).
// Vender (USDC -> R$): 4P off-ramp (on-chain USDC transfer via authorizeBasePayment -> Pix BRL).
//
// Receiver pin (sell): before building tx, assert ordData.receiver === VITE_4P_OFFRAMP_RECEIVER.
// If VITE_4P_OFFRAMP_RECEIVER is not set, sell is disabled.
//
// On-chain send after sign shows basescan hash + "confirmando com a 4P". Never false success.

import { useCallback, useEffect, useRef, useState } from "react";
import { useComexBaseWallet } from "../../../lib/comexBase.tsx";
import { authorizeBasePayment } from "../../../lib/baseAuthorize.ts";
import type { DecodedTransfer } from "../../../lib/baseAuthorize.ts";
import { publicClient, usdcAddress, fromBaseUnits } from "../../../lib/chain/base/usdc.ts";
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
  type Offramp4pQuote,
  type Quote4p,
} from "../../../lib/ramp4p.ts";
import { getCompanyDoc, setCompanyDoc, isValidDoc } from "../../../lib/comexProfile.ts";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

type Direction = "buy" | "sell";

const DONE_STATUSES = ["paid", "completed", "confirmed"];

// Client-pinned 4P off-ramp receiver (Base 0x address).
// Must be set in env; if absent, sell flow is entirely disabled.
const PINNED_4P_RECEIVER: string | undefined =
  import.meta.env.VITE_4P_OFFRAMP_RECEIVER as string | undefined;

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

// ---------------------------------------------------------------------------
// Buy sub-panel (R$ -> USDC via Pix on-ramp)
// ---------------------------------------------------------------------------

type BuyStep = "amount" | "identity" | "pix" | "done";
const BUY_PRESETS = [100, 500, 1000, 5000];
const onlyDigits = (s: string) => s.replace(/\D/g, "");

function BuyPanel({ address, email: initialEmail }: { address: string; email: string | null }) {
  // Free-entry amount: keep the raw string so the user can type/clear/decimals
  // freely; derive the number for the quote and the charge. Starts empty so the
  // field reads as "type your value", with the presets as optional shortcuts.
  const [brlInput, setBrlInput] = useState("");
  const brl = Number(brlInput.replace(",", ".")) || 0;
  const [q4p, setQ4p] = useState<Quote4p | null>(null);
  const cryptoOut = q4p?.cryptoOut ?? null;
  const [quotedAt, setQuotedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [asset, setAsset] = useState("USDC");
  const [step, setStep] = useState<BuyStep>("amount");

  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState(initialEmail ?? "");

  const [order, setOrder] = useState<Ramp4pOrder | null>(null);
  const [orderStatus, setOrderStatus] = useState("pending");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // On-chain settlement detection (fallback for the 4P webhook): snapshot the
  // wallet's USDC balance before the charge, then watch for it to rise.
  const [baselineRaw, setBaselineRaw] = useState<bigint | null>(null);
  const [receivedUsdc, setReceivedUsdc] = useState<number | null>(null);

  useEffect(() => {
    status4p().then((s) => {
      if (s.asset) setAsset(s.asset);
    });
  }, []);

  // Live quote: the dollar rate moves, so re-fetch on amount change AND on a
  // 20s timer while the user is on the amount screen. The binding amount is only
  // locked when the Pix charge is created ("valor final fixado no pagamento").
  useEffect(() => {
    if (step !== "amount" || brl <= 0) {
      if (brl <= 0) setQ4p(null);
      return;
    }
    let on = true;
    const fetchQuote = () =>
      quote4p(brl)
        .then((q) => { if (on) { setQ4p(q); setQuotedAt(Date.now()); } })
        .catch(() => { /* keep last */ });
    fetchQuote();
    const iv = setInterval(fetchQuote, 20_000);
    return () => { on = false; clearInterval(iv); };
  }, [brl, step]);

  // 1s ticker so the "atualizada há Xs" label counts up between refreshes.
  useEffect(() => {
    if (step !== "amount") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  // Poll until settled (4P webhook-backed store)
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

  // Fallback: detect settlement directly on-chain. The 4P webhook may not fire,
  // but the USDC landing in the wallet is the source of truth — watch balanceOf
  // and flip to "done" the moment it rises above the pre-charge baseline.
  useEffect(() => {
    if (step !== "pix" || baselineRaw == null || !address) return;
    let on = true;
    const iv = setInterval(async () => {
      try {
        const raw = await publicClient.readContract({
          address: usdcAddress(),
          abi: ERC20_BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        }) as bigint;
        if (on && raw > baselineRaw) {
          setReceivedUsdc(Number(fromBaseUnits(raw - baselineRaw)));
          setOrderStatus("paid");
          setStep("done");
        }
      } catch { /* keep polling */ }
    }, 5000);
    return () => { on = false; clearInterval(iv); };
  }, [step, baselineRaw, address]);

  async function confirmBuy() {
    setErr(null);
    if (!address) { setErr("Conta não disponível — autentique-se primeiro."); return; }
    if (onlyDigits(cpf).length !== 11) { setErr("CPF inválido (11 dígitos)."); return; }
    if (!email) { setErr("E-mail obrigatório."); return; }
    setBusy(true);
    try {
      // Snapshot pre-charge USDC balance so we can detect settlement on-chain
      // even if the 4P webhook never fires.
      try {
        const raw = await publicClient.readContract({
          address: usdcAddress(),
          abi: ERC20_BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [address as `0x${string}`],
        }) as bigint;
        setBaselineRaw(raw);
      } catch { setBaselineRaw(null); }
      setReceivedUsdc(null);

      const o = await createOnramp4p({
        amountBrl: brl,
        receiverWallet: address, // Base 0x address — 4P settles USDC on Base
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

  // Fee transparency: exact dollar rate (gross 4P), the Slippay fee applied, and
  // the effective cost per dollar — so the user sees precisely what they pay for.
  const grossOut = q4p?.grossOut ?? null;
  const dollarRate = q4p?.dollarRate ?? null;
  const marginBps = q4p?.marginBps ?? null;
  const feeUsdc = grossOut != null && cryptoOut != null ? grossOut - cryptoOut : null;
  const effRate = cryptoOut != null && cryptoOut > 0 ? brl / cryptoOut : null;
  const marginPct = marginBps != null
    ? (marginBps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%"
    : null;
  const brlFmt = (n: number, d = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const usdFmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const secsAgo = quotedAt != null ? Math.max(0, Math.floor((now - quotedAt) / 1000)) : null;

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
                type="text"
                inputMode="decimal"
                value={brlInput}
                onChange={(e) => setBrlInput(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="0"
                autoFocus
                className="w-full bg-transparent outline-none text-4xl tabular-nums placeholder:text-[#0a0a0a]/25"
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/35 self-center mr-1">
                atalhos
              </span>
              {BUY_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setBrlInput(String(p))}
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
              Você recebe
            </label>
            <div className="flex items-baseline gap-2">
              <span className="text-xl text-[#0a0a0a]/45">$</span>
              <span className="text-4xl tabular-nums">
                {cryptoOut != null ? usdFmt(cryptoOut, 2) : "—"}
              </span>
              <span className="text-lg text-[#0a0a0a]/45">{asset}</span>
            </div>

            {/* Fee + exact-rate transparency */}
            {grossOut != null && dollarRate != null && (
              <div className="mt-4 space-y-1.5 text-[11px] text-[#0a0a0a]/60">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/45 pb-1">
                  <span className="inline-block h-1.5 w-1.5 bg-[#FDDA24] animate-pulse" />
                  Cotação ao vivo
                  {secsAgo != null && (
                    <span className="text-[#0a0a0a]/35 normal-case tracking-normal">
                      · atualizada há {secsAgo}s
                    </span>
                  )}
                </div>
                <div className="flex justify-between">
                  <span>Você paga</span>
                  <span className="tabular-nums">R$ {brlFmt(brl)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Cotação do dólar</span>
                  <span className="tabular-nums">R$ {brlFmt(dollarRate, 4)} / USD</span>
                </div>
                <div className="flex justify-between">
                  <span>Dólares (bruto)</span>
                  <span className="tabular-nums">$ {usdFmt(grossOut, 4)}</span>
                </div>
                {feeUsdc != null && marginPct != null && (
                  <div className="flex justify-between">
                    <span>Taxa Slippay ({marginPct})</span>
                    <span className="tabular-nums">− $ {usdFmt(feeUsdc, 4)}</span>
                  </div>
                )}
                <div className="h-px bg-[#0a0a0a]/10 my-1.5" />
                <div className="flex justify-between text-[#0a0a0a] font-medium">
                  <span>Você recebe</span>
                  <span className="tabular-nums">$ {cryptoOut != null ? usdFmt(cryptoOut, 2) : "—"} {asset}</span>
                </div>
                {effRate != null && (
                  <div className="flex justify-between text-[#0a0a0a]/40">
                    <span>Custo efetivo</span>
                    <span className="tabular-nums">R$ {brlFmt(effRate, 4)} / USD</span>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/40">
              {asset} na rede Base · valor final fixado no pagamento
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
            placeholder="CPF (11 dígitos)"
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
          {err && (
            <div className="text-xs uppercase tracking-[0.14em] text-red-700 border-l-2 border-red-700 pl-3">
              {err}
            </div>
          )}
          <div className="flex gap-4 items-center pt-2">
            <button
              onClick={confirmBuy}
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
            Copie o código e pague no seu banco. O {asset} cai na sua carteira na rede Base assim que o Pix confirmar.
          </p>
          <div className="border border-[#0a0a0a]/15 p-4 font-mono text-xs break-all text-[#0a0a0a]/80 bg-[#0a0a0a]/3">
            {order.pixCopiaECola ?? "—"}
          </div>
          <button
            onClick={copyPix}
            className="w-full border border-[#0a0a0a] py-4 text-sm uppercase tracking-[0.18em] hover:bg-[#0a0a0a]/5"
          >
            {copied ? "Copiado" : "Copiar código Pix"}
          </button>
          <div className="flex items-center gap-2 text-xs text-[#0a0a0a]/55">
            <span className="inline-block h-2 w-2 bg-[#FDDA24] animate-pulse" />
            Aguardando pagamento... ({orderStatus})
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/40">
            Confirma sozinho quando o {asset} cair na sua carteira.
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="border-l-2 border-[#FDDA24] pl-4">
          <div className="text-[10px] uppercase tracking-[0.18em] flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 bg-[#FDDA24]" /> Pagamento confirmado
          </div>
          <p className="text-sm text-[#0a0a0a]/70 mt-2">
            {receivedUsdc != null
              ? `Recebido: $${usdFmt(receivedUsdc, 2)} ${asset} na sua carteira (rede Base).`
              : `O ${asset} está sendo enviado para a sua carteira na rede Base.`}
          </p>
        </div>
      )}

      <div className="text-[10px] text-[#0a0a0a]/40 border-t border-[#0a0a0a]/10 pt-4">
        Não-custodial: a 4P (licenciada) liquida direto na sua carteira na rede Base. A Slippay não segura seu dinheiro.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sell sub-panel (USDC -> R$ via Pix off-ramp)
// ---------------------------------------------------------------------------

type SellStep = "form" | "confirming" | "sending" | "done" | "recovery";

function SellPanel({ address, email: initialEmail, sendTransaction }: {
  address: string;
  email: string | null;
  sendTransaction: (tx: { to: `0x${string}`; data: `0x${string}`; value: bigint }) => Promise<{ hash: `0x${string}` }>;
}) {
  const [usdc, setUsdc] = useState("");
  const [pixKey, setPixKey] = useState("");
  // Company document: loaded once from storage; only prompted if not yet saved.
  const [savedDoc, setSavedDoc] = useState("");
  const [docInput, setDocInput] = useState("");
  useEffect(() => { setSavedDoc(getCompanyDoc(address)); }, [address]);
  const [quote, setQuote] = useState<Offramp4pQuote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [offRampPending, setOffRampPending] = useState(false);

  const [step, setStep] = useState<SellStep>("form");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [txHash, setTxHash] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState("pending");
  const [sentAt, setSentAt] = useState<number | null>(null);

  // ConfirmTxModal wiring
  const [modalSummary, setModalSummary] = useState<TxSummary | null>(null);
  const resolveConfirmRef = useRef<((v: boolean) => void) | null>(null);

  const usdcNum = Number(usdc.replace(",", "."));
  const usdcValid = isFinite(usdcNum) && usdcNum > 0;

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
        setQuoteErr(e instanceof Ramp4pError ? e.message : "Erro ao buscar cotação.");
      })
      .finally(() => { if (on) setQuoteBusy(false); });
    return () => { on = false; };
  }, [usdc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll order status after on-chain send (self-sustaining interval).
  // The USDC already left the wallet on-chain; if 4P hasn't confirmed the Pix
  // within ~90s, surface the recovery panel (order id + basescan hash) instead
  // of spinning forever. (90s is a placeholder — confirm 4P's real SLA.)
  useEffect(() => {
    if (step !== "sending" || !orderId) return;
    let on = true;
    const iv = setInterval(async () => {
      if (!on) return;
      if (sentAt != null && Date.now() - sentAt > 90_000) {
        setErr("O Pix está demorando mais que o normal. Seus dólares já saíram on-chain e estão com a 4P (licenciada) — guarde o número da ordem abaixo.");
        setStep("recovery");
        return;
      }
      try {
        const o = await getOfframp4p(orderId);
        if (o.transactionStatus) {
          setOrderStatus(o.transactionStatus);
          if (DONE_STATUSES.includes(o.transactionStatus.toLowerCase())) setStep("done");
        }
      } catch { /* keep polling */ }
    }, 4000);
    return () => { on = false; clearInterval(iv); };
  }, [step, orderId, sentAt]);

  const openConfirmModal = useCallback(
    (decoded: DecodedTransfer): Promise<boolean> => {
      return new Promise((resolve) => {
        resolveConfirmRef.current = resolve;
        const summary: TxSummary = {
          source: address,
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

  async function doSell() {
    if (!usdcValid || !pixKey.trim() || !address) return;
    if (!receiverConfigured) {
      setErr("Venda em ativação (receiver não configurado).");
      return;
    }
    // Company document: required once by 4P, then reused. Resolve + validate.
    const doc = savedDoc || docInput.replace(/\D/g, "");
    if (!isValidDoc(doc)) {
      setErr("Informe o CNPJ da empresa (14 dígitos) ou CPF (11) — só nesta primeira venda.");
      return;
    }
    const sellEmail = (initialEmail ?? "").trim();
    if (!sellEmail) {
      setErr("E-mail da conta indisponível — refaça o login.");
      return;
    }
    if (!savedDoc) { setCompanyDoc(address, doc); setSavedDoc(doc); }

    setErr(null);
    setBusy(true);
    setStep("confirming");

    // Insufficient-balance pre-check before touching 4P API
    try {
      const rawBalance = await publicClient.readContract({
        address: usdcAddress(),
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }) as bigint;
      const humanBalance = fromBaseUnits(rawBalance);
      if (Number(humanBalance) < usdcNum) {
        setErr(`Saldo insuficiente: você tem $${Number(humanBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`);
        setStep("form");
        setBusy(false);
        return;
      }
    } catch {
      setErr("Não foi possível verificar o saldo. Tente novamente.");
      setStep("form");
      setBusy(false);
      return;
    }

    // Create off-ramp order with 4P
    let ordData: { id: string; receiver: string; amount: string };
    try {
      ordData = await createOfframp4p({ usdc: usdcNum, pixKey: pixKey.trim(), sender: address, email: sellEmail, doc });
    } catch (e) {
      setErr(e instanceof Ramp4pError ? e.message : "Endpoint de venda não disponível ainda.");
      setStep("form");
      setBusy(false);
      return;
    }

    // Assert receiver matches client-pinned address BEFORE building/signing
    // (case-insensitive — EVM addresses are checksummed but compare on hex).
    if (ordData.receiver.toLowerCase() !== (PINNED_4P_RECEIVER ?? "").toLowerCase()) {
      setErr("receiver 4P inesperado — operação bloqueada");
      setStep("form");
      setBusy(false);
      return;
    }

    // build → decode → assert → confirm → send via authorizeBasePayment
    let hash: `0x${string}`;
    try {
      const result = await authorizeBasePayment({
        to: ordData.receiver as `0x${string}`,
        amount: ordData.amount,
        sendTransaction,
        confirm: (decoded) => openConfirmModal(decoded),
      });
      hash = result.hash;
      setTxHash(hash);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao assinar ou enviar transacao.";
      if (msg === "cancelado") {
        setErr("Transação cancelada.");
        setStep("form");
      } else {
        setErr(msg);
        setStep("form");
      }
      setBusy(false);
      return;
    }

    // On-chain send succeeded — start polling 4P for settlement.
    // Show basescan hash immediately — never false success.
    setOrderId(ordData.id);
    setOrderStatus("pending");
    setSentAt(Date.now());
    setStep("sending");
    setBusy(false);
  }

  // Receiver not configured → sell unavailable
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
    return (
      <div className="space-y-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">Vender USDC</div>
        <div className="border border-[#0a0a0a]/15 p-6 text-sm text-[#0a0a0a]/60">
          Venda em ativação — endpoint 4P pendente. Disponível em breve.
        </div>
        <button
          onClick={() => { setUsdc(""); setOffRampPending(false); }}
          className="text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/45 hover:text-[#0a0a0a]"
        >
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
                    type="text"
                    inputMode="decimal"
                    value={usdc}
                    onChange={(e) => setUsdc(e.target.value.replace(/[^\d.,]/g, ""))}
                    disabled={busy}
                    placeholder="0.00"
                    className="w-full bg-transparent outline-none text-4xl tabular-nums disabled:opacity-60"
                  />
                  <span className="text-lg text-[#0a0a0a]/45">USDC</span>
                </div>
              </div>

              {usdcValid && <div className="h-px bg-[#0a0a0a]/10" />}

              {usdcValid && (
                <div>
                  <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-1 block">
                    Você recebe (aprox.)
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
                    <div className="mt-2 text-xs uppercase tracking-[0.14em] text-red-700 border-l-2 border-red-700 pl-3">
                      {quoteErr}
                    </div>
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
                placeholder="CPF, e-mail, telefone ou chave aleatória"
                className="w-full bg-transparent border border-[#0a0a0a]/20 p-4 text-sm disabled:opacity-60"
              />
            </div>

            {/* Company document — asked once, then reused on every sell */}
            {!savedDoc && (
              <div>
                <label className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-3 block">
                  CNPJ da empresa <span className="text-[#0a0a0a]/40 normal-case tracking-normal">(só nesta primeira venda)</span>
                </label>
                <input
                  type="text"
                  value={docInput}
                  onChange={(e) => setDocInput(e.target.value)}
                  disabled={busy}
                  inputMode="numeric"
                  placeholder="CNPJ (14 dígitos) ou CPF (11)"
                  className="w-full bg-transparent border border-[#0a0a0a]/20 p-4 text-sm disabled:opacity-60"
                />
                <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/40">
                  Exigido uma vez pela 4P (parceiro de câmbio licenciado) · guardado para as próximas
                </div>
              </div>
            )}

            {err && (
              <div className="text-xs uppercase tracking-[0.14em] text-red-700 border-l-2 border-red-700 pl-3">
                {err}
              </div>
            )}

            <button
              onClick={doSell}
              disabled={busy || !usdcValid || !pixKey.trim() || quoteBusy || quote?.brlOut == null || (!savedDoc && !isValidDoc(docInput.replace(/\D/g, "")))}
              className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              {step === "confirming" ? "Aguardando confirmação..." : "Vender USDC"}
            </button>
          </>
        )}

        {step === "sending" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-[#0a0a0a]/55">
              <span className="inline-block h-2 w-2 bg-[#FDDA24] animate-pulse" />
              Confirmando com a 4P... ({orderStatus})
            </div>
            {txHash && (
              <div className="border-l-2 border-[#0a0a0a]/20 pl-4">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/55 mb-1">
                  Hash on-chain (Base)
                </div>
                <a
                  href={`https://basescan.org/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs break-all hover:opacity-60"
                >
                  {txHash}
                </a>
              </div>
            )}
          </div>
        )}

        {step === "done" && (
          <div className="border-l-2 border-[#FDDA24] pl-4">
            <div className="text-[10px] uppercase tracking-[0.18em] flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 bg-[#FDDA24]" /> Liquidação confirmada
            </div>
            <p className="text-sm text-[#0a0a0a]/70 mt-2">
              O Pix sera enviado para a chave {pixKey}. Status final: {orderStatus}.
            </p>
            {txHash && (
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[10px] mt-2 block break-all hover:opacity-60 text-[#0a0a0a]/40"
              >
                {txHash}
              </a>
            )}
          </div>
        )}

        {step === "recovery" && (
          <div className="border-l-2 border-[#0a0a0a] pl-4 space-y-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]">
              Enviado · aguardando o Pix
            </div>
            <p className="text-xs text-[#0a0a0a]/70">
              {err ?? "Seus dólares saíram on-chain e estão com a 4P (licenciada). O Pix pode levar alguns minutos."}
            </p>
            {orderId && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/55 mb-1">
                  Número da ordem (guarde)
                </div>
                <div className="font-mono text-xs break-all text-[#0a0a0a]">{orderId}</div>
              </div>
            )}
            {txHash && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/55 mb-1">
                  Comprovante on-chain (Base)
                </div>
                <a
                  href={`https://basescan.org/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] break-all hover:opacity-60 text-[#0a0a0a]/55 block"
                >
                  {txHash}
                </a>
              </div>
            )}
          </div>
        )}

        <div className="text-[10px] text-[#0a0a0a]/40 border-t border-[#0a0a0a]/10 pt-4">
          USDC enviado on-chain (rede Base) · BRL liquidado via Pix pela 4P (licenciada) · irreversível
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Exchange root
// ---------------------------------------------------------------------------

export default function BaseExchange() {
  const { address, email, sendTransaction } = useComexBaseWallet();
  const [direction, setDirection] = useState<Direction>("buy");
  const [rampEnabled, setRampEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    status4p().then((s) => setRampEnabled(s.enabled));
  }, []);

  return (
    <div className="md:col-span-9 max-w-xl">
      <div className="text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-8 block">
        Câmbio R$ ↔ USD
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
          Câmbio em ativação (aguardando 4P)
        </div>
      )}

      {direction === "buy" && rampEnabled !== false && address && (
        <BuyPanel address={address} email={email} />
      )}

      {direction === "buy" && rampEnabled !== false && !address && (
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/40">
          Conta não disponível — autentique-se primeiro.
        </div>
      )}

      {/* Sell */}
      {direction === "sell" && address && (
        <SellPanel address={address} email={email} sendTransaction={sendTransaction} />
      )}

      {direction === "sell" && !address && (
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/40">
          Conta não disponível — autentique-se primeiro.
        </div>
      )}
    </div>
  );
}
