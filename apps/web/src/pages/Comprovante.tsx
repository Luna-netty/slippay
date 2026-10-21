// Comprovante / Verifier — a PUBLIC, no-login surface that JUDGES a payment.
//
// TWO verification strengths, by what's in the URL:
//
//   STRONG — on-chain OBLIGATION path  (/comprovante/:txhash?sub=<id>&contract=<C…>&net=)
//     The page reads BOTH sides from the chain and trusts NOTHING in the URL:
//       • the OBLIGATION via Soroban RPC `get(sub)` on the subscription contract
//         → {merchant, token, amount, status}
//       • the PAYMENT via Horizon EFFECTS of :txhash
//         → {to, from, amount, asset}
//     Green iff the recorded transfer satisfies the stored obligation
//     (recipient == merchant, amounts equal, asset == token, obligation live).
//     A forged URL cannot make this green — the amount/recipient come from the
//     contract, not the query string. This is "obrigação verificada on-chain".
//
//   WEAK — param path  (…?amount=0.30&to=G…&asset=USDC)
//     Kept as a clearly-labeled fallback when ?sub= is absent. Here the expected
//     amount/recipient come from the URL (forgeable), so the page can only say
//     "informado — compare você mesmo". The chain still judges that the tx
//     succeeded and reads the real transfer, but the *obligation* is unverified.
//
// In BOTH paths the real transfer is now read from EFFECTS, so Soroban/contract
// (SAC) payments get a real amount — the old "amber, value not readable" gap is
// gone wherever a credit effect exists.
//
// Verdicts:
//   • green  = chain attests the transfer satisfies the obligation (or, in the
//              weak path, matches the URL-stated claim).
//   • red    = mismatch — shows EXACTLY chain-vs-obligation (the anti-fraud view).
//   • amber  = couldn't bind (no readable transfer, or no obligation/claim to
//              compare). We refuse a fake green and send you to verify.
//
// Honest limit (named in-UI): this proves THIS ON-CHAIN OBLIGATION WAS PAID. It
// does NOT prove the merchant address is the right real-world merchant — that
// is a separate identity layer the chain does not provide.

import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import QRCode from "qrcode";
import { Logo } from "../components/Logo.tsx";
import { LiveProof } from "../components/LiveProof.tsx";
import { useLang } from "../lib/lang.ts";
import {
  HORIZON, DEFAULT_SUB_CONTRACT, judgeObligation, readObligation, readTransfer,
  stroopsToUnits, unitsToStroops,
  type Net, type Obligation, type ObligationVerdict, type Transfer,
} from "../lib/chainVerify.ts";

const EXPLORER: Record<Net, string> = {
  public: "https://stellar.expert/explorer/public",
  testnet: "https://stellar.expert/explorer/testnet",
};

type Level = "green" | "red" | "amber" | "loading" | "notfound";
type Mode = "obligation" | "claim" | "bare";

interface Result {
  level: Level;
  mode: Mode;
  successful: boolean;
  ledger?: number;
  createdAt?: string;
  transfer?: Transfer;
  obligation?: Obligation;
  verdict?: ObligationVerdict;
  obligationError?: string;
  checkedAt?: string;
}

const STR = {
  pt: {
    receipt: "Comprovante", verifying: "Conferindo na blockchain…",
    notFound: "Transação não encontrada nesta rede.", notFoundHint: "Confira o hash e a rede.",
    // verdict headlines
    gPagoObl: "Obrigação paga e confirmada", gPagoClaim: "Pago e confirmado",
    gSubObl: "A blockchain confirma: a cobrança registrada on-chain foi paga exatamente — valor, destino e ativo batem com a obrigação no contrato.",
    gSubClaim: "A blockchain confirma o pagamento e ele bate com os dados informados. (Os dados esperados vieram do link — confira você mesmo.)",
    rFalhou: "Pagamento NÃO confirmado", rMismatch: "Atenção: não bate com a obrigação", rMismatchClaim: "Atenção: não bate com o informado",
    rSubFailed: "Esta transação falhou na blockchain.",
    rSubMismatchObl: "A blockchain registra um pagamento diferente da obrigação no contrato. Não aceite.",
    rSubMismatchClaim: "A blockchain registra um pagamento diferente do que o link informa. Não pague / não aceite.",
    aContract: "Confirmado on-chain — transferência não lida",
    aContractSub: "A transação existe e teve sucesso, mas esta página não conseguiu ler a transferência (sem efeito de crédito legível). Confira no explorer antes de aceitar.",
    aUnbound: "Pagamento existe — compare com a sua fatura",
    aUnboundSub: "A blockchain confirma o pagamento abaixo, mas não há obrigação on-chain (?sub=) nem dados informados para comparar. Confira valor e destino com a sua fatura.",
    aOblFail: "Pagamento existe — obrigação não pôde ser lida",
    aOblFailSub: "A transferência foi lida da blockchain, mas a obrigação on-chain não pôde ser carregada do contrato. Sem ela não confirmamos o vínculo — confira manualmente.",
    // section labels
    chainSays: "A blockchain registra", oblSays: "A obrigação on-chain pede", claimSays: "O link informa (compare você mesmo)",
    badgeObl: "obrigação verificada on-chain", badgeClaim: "informado (compare você mesmo)",
    amount: "Valor", to: "Para", asset: "Ativo", when: "Quando", ledger: "Bloco", txid: "Hash",
    status: "Status", contract: "Contrato", sub: "ID da obrigação", payer: "De",
    stActive: "ativa", stPaused: "pausada", stCancelled: "cancelada", stExpired: "expirada", stUnknown: "desconhecido",
    ritualTitle: "Não confie no print — confira você mesmo",
    ritual: "Esta página confere ao vivo na blockchain pública. Um print encaminhado não prova nada: escaneie o QR ou abra o link você mesmo. A blockchain não pode ser forjada nem apagada — mas só vale se VOCÊ conferir.",
    verifyCta: "Abrir na blockchain (Stellar Expert)", checkedAt: "Verificado agora",
    share: "Compartilhar", copy: "Copiar link", copied: "Link copiado",
    footerObl: "Prova que ESTA obrigação on-chain foi paga (valor, destino e ativo lidos do contrato). NÃO prova que o endereço de destino é mesmo o vendedor certo no mundo real — isso é outra camada (identidade). Não é nota fiscal.",
    footerClaim: "Prova o movimento na blockchain. Os dados esperados vieram do link, não do contrato — confira você mesmo. Conferir que o destino é mesmo o vendedor certo é outra camada (identidade). Não é nota fiscal.",
    net: (n: Net) => (n === "public" ? "Stellar mainnet" : "Stellar testnet"),
  },
  en: {
    receipt: "Receipt", verifying: "Checking the blockchain…",
    notFound: "Transaction not found on this network.", notFoundHint: "Check the hash and the network.",
    gPagoObl: "Obligation paid and confirmed", gPagoClaim: "Paid and confirmed",
    gSubObl: "The blockchain confirms: the on-chain obligation was paid exactly — amount, recipient and asset match the contract.",
    gSubClaim: "The blockchain confirms the payment and it matches the stated data. (Expected data came from the link — verify it yourself.)",
    rFalhou: "Payment NOT confirmed", rMismatch: "Warning: does not match the obligation", rMismatchClaim: "Warning: does not match the stated data",
    rSubFailed: "This transaction failed on the blockchain.",
    rSubMismatchObl: "The blockchain records a payment different from the obligation in the contract. Do not accept.",
    rSubMismatchClaim: "The blockchain records a payment different from what the link states. Do not pay / do not accept.",
    aContract: "Confirmed on-chain — transfer not read",
    aContractSub: "The transaction exists and succeeded, but this page couldn't read the transfer (no readable credit effect). Check the explorer before accepting.",
    aUnbound: "Payment exists — compare with your invoice",
    aUnboundSub: "The blockchain confirms the payment below, but there is no on-chain obligation (?sub=) nor stated data to compare against. Check amount and recipient against your invoice.",
    aOblFail: "Payment exists — obligation couldn't be read",
    aOblFailSub: "The transfer was read from the blockchain, but the on-chain obligation couldn't be loaded from the contract. Without it we don't confirm the binding — verify manually.",
    chainSays: "The blockchain records", oblSays: "The on-chain obligation asks for", claimSays: "The link states (verify yourself)",
    badgeObl: "obligation verified on-chain", badgeClaim: "stated (verify yourself)",
    amount: "Amount", to: "To", asset: "Asset", when: "When", ledger: "Ledger", txid: "Hash",
    status: "Status", contract: "Contract", sub: "Obligation id", payer: "From",
    stActive: "active", stPaused: "paused", stCancelled: "cancelled", stExpired: "expired", stUnknown: "unknown",
    ritualTitle: "Don't trust the screenshot — verify it yourself",
    ritual: "This page checks the public blockchain live. A forwarded screenshot proves nothing: scan the QR or open the link yourself. The blockchain can't be forged or deleted — but only if YOU check it.",
    verifyCta: "Open on the blockchain (Stellar Expert)", checkedAt: "Verified just now",
    share: "Share", copy: "Copy link", copied: "Link copied",
    footerObl: "Proves THIS on-chain obligation was paid (amount, recipient and asset read from the contract). It does NOT prove the recipient address is really the right seller in the real world — that's a separate identity layer. Not a tax invoice.",
    footerClaim: "Proves the movement on the blockchain. Expected data came from the link, not the contract — verify it yourself. Confirming the recipient is really the right seller is a separate identity layer. Not a tax invoice.",
    net: (n: Net) => (n === "public" ? "Stellar mainnet" : "Stellar testnet"),
  },
};

const short = (s?: string, h = 7, t = 7) => !s ? "" : s.length <= h + t + 1 ? s : `${s.slice(0, h)}…${s.slice(-t)}`;

export default function Comprovante() {
  const { txhash = "" } = useParams();
  const [sp] = useSearchParams();
  const [lang, setLang] = useLang();
  const t = STR[lang];

  const net: Net = sp.get("net") === "testnet" ? "testnet" : "public";

  // STRONG path inputs (on-chain obligation)
  const subId = sp.get("sub") ?? undefined;
  const contractId = sp.get("contract") ?? DEFAULT_SUB_CONTRACT[net];

  // WEAK path inputs (forgeable claim from the URL)
  const expAmount = sp.get("amount") ?? undefined;
  const expTo = sp.get("to") ?? undefined;
  const expAsset = (sp.get("asset") ?? "USDC").toUpperCase();
  const label = sp.get("label") ?? undefined;
  const hasClaim = !!(expAmount || expTo);

  const mode: Mode = subId ? "obligation" : hasClaim ? "claim" : "bare";

  const [r, setR] = useState<Result>({ level: "loading", mode, successful: false });
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const explorerUrl = `${EXPLORER[net]}/tx/${txhash}`;

  useEffect(() => {
    let alive = true;
    setR({ level: "loading", mode, successful: false });
    (async () => {
      try {
        // tx success + metadata (Horizon classic record)
        const txr = await fetch(`${HORIZON[net]}/transactions/${txhash}`);
        if (!txr.ok) { if (alive) setR({ level: "notfound", mode, successful: false }); return; }
        const tx = await txr.json();
        const successful = !!tx.successful;

        // the REAL transfer, read from EFFECTS (classic AND Soroban/contract)
        let transfer: Transfer | undefined;
        try { transfer = await readTransfer(net, txhash); } catch { transfer = undefined; }

        // the OBLIGATION, read from the contract (strong path only)
        let obligation: Obligation | undefined;
        let obligationError: string | undefined;
        if (mode === "obligation" && subId && contractId) {
          try { obligation = await readObligation(net, contractId, subId); }
          catch (e) { obligationError = e instanceof Error ? e.message : String(e); }
        }

        // JUDGE — chain decides. Never the URL in the obligation path.
        let level: Level;
        let verdict: ObligationVerdict | undefined;
        if (!successful) {
          level = "red";
        } else if (!transfer) {
          level = "amber"; // no readable transfer effect
        } else if (mode === "obligation") {
          if (!obligation) {
            level = "amber"; // transfer read, but obligation unreadable — refuse green
          } else {
            verdict = judgeObligation(obligation, transfer);
            level = verdict.ok ? "green" : "red";
          }
        } else if (mode === "claim") {
          // WEAK: compare the chain transfer to the URL-stated claim
          const amtOk = !expAmount || transfer.amountStroops === safeStroops(expAmount);
          const toOk = !expTo || transfer.to === expTo;
          const assetOk = transfer.assetCode === expAsset;
          level = amtOk && toOk && assetOk ? "green" : "red";
        } else {
          level = "amber"; // bare: payment exists, nothing to bind to
        }

        const checkedAt = new Date().toLocaleTimeString(lang === "pt" ? "pt-BR" : "en-US");
        if (alive) setR({ level, mode, successful, ledger: tx.ledger, createdAt: tx.created_at, transfer, obligation, verdict, obligationError, checkedAt });
      } catch { if (alive) setR({ level: "notfound", mode, successful: false }); }
    })();
    return () => { alive = false; };
  }, [txhash, net, mode, subId, contractId, hasClaim, expAmount, expTo, expAsset, lang]);

  useEffect(() => {
    QRCode.toDataURL(typeof window !== "undefined" ? window.location.href : explorerUrl,
      { margin: 1, width: 240, color: { dark: "#0a0a0a", light: "#00000000" } }).then(setQr).catch(() => {});
  }, [explorerUrl]);

  const fmt = (a?: string, asset?: string) => {
    if (!a) return "—";
    const n = Number(a); if (!Number.isFinite(n)) return a;
    const usd = (asset ?? expAsset) === "USDC";
    return (usd ? "US$ " : "") + n.toLocaleString(lang === "pt" ? "pt-BR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 7 }) + (usd ? "" : ` ${asset ?? ""}`);
  };
  const when = r.createdAt ? new Date(r.createdAt).toLocaleString(lang === "pt" ? "pt-BR" : "en-US", { dateStyle: "long", timeStyle: "short" }) : "—";

  const statusLabel = (s?: Obligation["status"]) =>
    s === "Active" ? t.stActive : s === "Paused" ? t.stPaused :
    s === "Cancelled" ? t.stCancelled : s === "Expired" ? t.stExpired : t.stUnknown;

  // verdict presentation
  const isObl = r.mode === "obligation";
  const isMismatch = r.level === "red" && r.successful;
  const headline =
    r.level === "green" ? (isObl ? t.gPagoObl : t.gPagoClaim) :
    r.level === "red" ? (isMismatch ? (isObl ? t.rMismatch : t.rMismatchClaim) : t.rFalhou) :
    r.level === "amber"
      ? (!r.transfer ? t.aContract : (isObl && r.obligationError) ? t.aOblFail : t.aUnbound)
      : "";
  const sub =
    r.level === "green" ? (isObl ? t.gSubObl : t.gSubClaim) :
    r.level === "red" ? (isMismatch ? (isObl ? t.rSubMismatchObl : t.rSubMismatchClaim) : t.rSubFailed) :
    r.level === "amber"
      ? (!r.transfer ? t.aContractSub : (isObl && r.obligationError) ? t.aOblFailSub : t.aUnboundSub)
      : "";
  const bg = r.level === "green" ? "#6f6862" : r.level === "red" ? "#b91c1c" : "#0a0a0a";
  const fg = "#f1eee7";

  // which transfer fields are in conflict (red), per path
  const v = r.verdict;
  const amtMismatch = isMismatch && (isObl ? !!v && !v.amountOk : !!expAmount && r.transfer?.amountStroops !== safeStroops(expAmount));
  const toMismatch = isMismatch && (isObl ? !!v && !v.recipientOk : !!expTo && r.transfer?.to !== expTo);
  const assetMismatch = isMismatch && (isObl ? !!v && !v.assetOk : r.transfer?.assetCode !== expAsset);

  async function onShare() {
    const url = window.location.href;
    if ((navigator as { share?: (d: ShareData) => Promise<void> }).share) {
      try { await (navigator as { share: (d: ShareData) => Promise<void> }).share({ title: t.receipt + " · Slippay", url }); return; } catch { /* */ }
    }
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* */ }
  }

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain flex flex-col">
      <header className="border-b border-[#0a0a0a]/10">
        <div className="max-w-[560px] mx-auto w-full px-5 py-4 flex items-center justify-between">
          <Link to="/" aria-label="Slippay"><Logo variant="ink" /></Link>
          <button onClick={() => setLang(lang === "pt" ? "en" : "pt")} className="text-[10px] uppercase tracking-[0.22em] opacity-60 hover:opacity-100">{lang === "pt" ? "EN" : "PT"}</button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[560px] mx-auto px-5 py-9 md:py-14">
        {r.level === "loading" && (
          <div className="text-center py-24 font-mono text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/55">
            <span className="inline-block w-1.5 h-1.5 bg-[#FDDA24] animate-pulse mr-2" />{t.verifying}
          </div>
        )}
        {r.level === "notfound" && (
          <div className="text-center py-24">
            <div className="text-2xl font-medium tracking-tight">{t.notFound}</div>
            <p className="mt-3 text-sm text-[#0a0a0a]/60">{t.notFoundHint}</p>
            <div className="mt-6 font-mono text-[11px] text-[#0a0a0a]/40 break-all">{short(txhash, 12, 12)}</div>
          </div>
        )}

        {(r.level === "green" || r.level === "red" || r.level === "amber") && (
          <div className="border border-[#0a0a0a]/15 bg-white/55">
            {/* VERDICT banner — the chain's decision, in plain language */}
            <div className="px-7 md:px-9 py-8 text-center" style={{ background: bg, color: fg }}>
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] opacity-70">{t.receipt} · slippay · {t.net(net)}</div>
              <div className="mx-auto mt-5 w-[56px] h-[56px] flex items-center justify-center" style={{ background: r.level === "green" ? "#0a0a0a" : "transparent", border: r.level === "green" ? "none" : `2px solid ${fg}`, borderRadius: r.level === "green" ? 0 : 999 }}>
                {r.level === "green"
                  ? <svg width="30" height="30" viewBox="0 0 44 44" fill="none"><path d="M11 23l8 8 14-16" stroke="#FDDA24" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  : r.level === "red"
                    ? <svg width="26" height="26" viewBox="0 0 44 44" fill="none"><path d="M14 14l16 16M30 14L14 30" stroke={fg} strokeWidth="4" strokeLinecap="round" /></svg>
                    : <svg width="26" height="26" viewBox="0 0 44 44" fill="none"><path d="M22 12v16M22 32v.5" stroke={fg} strokeWidth="4" strokeLinecap="round" /></svg>}
              </div>
              <div className="mt-5 text-2xl md:text-3xl font-medium tracking-[-0.02em]">{headline}</div>
              <p className="mt-3 text-sm leading-relaxed opacity-85 max-w-[42ch] mx-auto">{sub}</p>
              {/* trust badge — strong vs weak, stated explicitly */}
              <div className="mt-4 inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] px-2.5 py-1 border" style={{ borderColor: "rgba(241,238,231,0.3)" }}>
                <span className="inline-block w-1.5 h-1.5" style={{ background: isObl ? "#FDDA24" : fg }} />
                {isObl ? t.badgeObl : t.badgeClaim}
              </div>
              {label && <div className="mt-3 text-xs opacity-70">{label}</div>}
            </div>

            {/* CHAIN — what the blockchain actually recorded (read from effects) */}
            <div className="px-7 md:px-9 py-7">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45 font-mono mb-3">{t.chainSays}</div>
              <dl className="space-y-3 text-sm">
                {r.transfer ? (
                  <>
                    <Row label={t.amount} value={fmt(r.transfer.amount, r.transfer.assetCode)} mono mismatch={amtMismatch} />
                    <Row label={t.to} value={short(r.transfer.to, 8, 8)} mono mismatch={toMismatch} />
                    {(r.transfer.from || r.transfer.fromContract) && (
                      <Row label={t.payer} value={short(r.transfer.fromContract ?? r.transfer.from, 8, 8)} mono />
                    )}
                    <Row label={t.asset} value={r.transfer.assetCode === "USDC" ? "USDC · dólar" : r.transfer.assetCode} mismatch={assetMismatch} />
                  </>
                ) : (
                  <div className="text-sm text-[#0a0a0a]/55">{lang === "pt" ? "transferência não legível por esta página" : "transfer not readable by this page"}</div>
                )}
                <Row label={t.when} value={when} />
                <Row label={t.ledger} value={r.ledger ? String(r.ledger) : "—"} mono />
                <Row label={t.txid} value={short(txhash, 10, 10)} mono />
              </dl>

              {/* OBLIGATION (strong) — read from the contract, zero trust in URL */}
              {isObl && r.obligation && (
                <>
                  <div className="flex items-center gap-2 mt-6 mb-3">
                    <span className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45 font-mono">{t.oblSays}</span>
                    <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#f1eee7] bg-[#6f6862] px-1.5 py-0.5">{t.badgeObl}</span>
                  </div>
                  <dl className="space-y-3 text-sm">
                    <Row label={t.amount} value={fmt(stroopsToUnits(r.obligation.amountStroops), assetCodeOf(r))} mono mismatch={isMismatch && !!v && !v.amountOk} />
                    <Row label={t.to} value={short(r.obligation.merchant, 8, 8)} mono mismatch={isMismatch && !!v && !v.recipientOk} />
                    <Row label={t.asset} value={short(r.obligation.token, 7, 6)} mono mismatch={isMismatch && !!v && !v.assetOk} />
                    <Row label={t.status} value={statusLabel(r.obligation.status)} mismatch={isMismatch && !!v && !v.statusOk} />
                    <Row label={t.contract} value={short(contractId ?? undefined, 7, 6)} mono />
                    <Row label={t.sub} value={short(subId, 8, 8)} mono />
                  </dl>
                </>
              )}

              {/* CLAIM (weak) — came from the URL, user must compare themselves */}
              {!isObl && hasClaim && (
                <>
                  <div className="flex items-center gap-2 mt-6 mb-3">
                    <span className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45 font-mono">{t.claimSays}</span>
                    <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#0a0a0a]/70 border border-[#0a0a0a]/30 px-1.5 py-0.5">{t.badgeClaim}</span>
                  </div>
                  <dl className="space-y-3 text-sm">
                    {expAmount && <Row label={t.amount} value={fmt(expAmount)} mono />}
                    {expTo && <Row label={t.to} value={short(expTo, 8, 8)} mono />}
                    <Row label={t.asset} value={expAsset === "USDC" ? "USDC · dólar" : expAsset} />
                  </dl>
                </>
              )}
            </div>

            {/* RITUAL — verify yourself, don't trust a screenshot */}
            <div className="px-7 md:px-9 py-7 bg-[#0a0a0a] text-[#f1eee7]">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#6f6862] mb-3">
                <span className="inline-block w-1.5 h-1.5 bg-[#FDDA24]" />{t.ritualTitle}
              </div>
              <div className="flex gap-5 items-center">
                {qr && <img src={qr} alt="" className="w-[88px] h-[88px] shrink-0 bg-[#f1eee7] p-1.5" />}
                <p className="text-[12.5px] leading-[1.55] text-[#f1eee7]/75">{t.ritual}</p>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 border border-[#f1eee7]/30 px-4 py-2.5 text-[10px] uppercase tracking-[0.2em] hover:bg-[#f1eee7] hover:text-[#0a0a0a] transition-colors">
                  {t.verifyCta} <span>↗</span>
                </a>
                {r.checkedAt && <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#f1eee7]/45">{t.checkedAt} · {r.checkedAt}</span>}
              </div>
            </div>

            {/* actions */}
            <div className="px-7 md:px-9 py-5 flex items-center justify-between gap-3 border-t border-dashed border-[#0a0a0a]/20">
              <button onClick={onShare} className="inline-flex items-center gap-2 bg-[#0a0a0a] text-[#f1eee7] px-5 py-3 text-[10px] uppercase tracking-[0.22em] hover:bg-[#1a1a1a]">
                {copied ? t.copied : ((navigator as { share?: unknown })?.share ? t.share : t.copy)} <span>→</span>
              </button>
              <Link to="/" className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/50 hover:text-[#0a0a0a]">slippay</Link>
            </div>
          </div>
        )}

        <p className="mt-6 text-[11px] leading-relaxed text-[#0a0a0a]/45 text-center max-w-[46ch] mx-auto">{isObl ? t.footerObl : t.footerClaim}</p>

        {/* k-factor: a shared receipt is a landing page — recruit the viewer */}
        <div className="mt-10 max-w-[460px] mx-auto text-center border-t border-[#0a0a0a]/10 pt-8">
          <div className="text-lg font-medium tracking-[-0.01em]">Pay or get paid with one touch.</div>
          <p className="mt-2 text-sm text-[#0a0a0a]/55">No app, no seed phrase. Real dollars — and you verify everything yourself.</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link to="/pay" className="rounded-full px-7 py-3.5 text-[11px] uppercase tracking-[0.2em] bg-[#FDDA24] text-[#0a0a0a] font-medium">Pay with a touch →</Link>
            <Link to="/cobrar" className="text-[11px] uppercase tracking-[0.2em] text-[#0a0a0a]/55 hover:text-[#0a0a0a] border-b border-[#0a0a0a]/20 pb-1">Get paid →</Link>
          </div>
          <div className="mt-8"><LiveProof /></div>
        </div>
      </main>
    </div>
  );
}

/** Best-effort asset code for the obligation row: the SAC's resolved code if the
 *  transfer matched, else fall back to the transfer's code or "?". */
function assetCodeOf(r: Result): string {
  return r.transfer?.assetCode ?? "?";
}

/** Parse a URL-stated amount to stroops, tolerating garbage (NaN → sentinel). */
function safeStroops(units: string): bigint {
  try { return unitsToStroops(units); } catch { return -1n; }
}

function Row({ label, value, mono, mismatch }: { label: string; value: string; mono?: boolean; mismatch?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/45 font-mono shrink-0">{label}</dt>
      <dd className={"text-right " + (mono ? "font-mono text-xs break-all " : "") + (mismatch ? "text-[#b91c1c] font-semibold" : "")}>
        {mismatch && <span className="mr-1">≠</span>}{value}
      </dd>
    </div>
  );
}
