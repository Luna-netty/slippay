// /cash — buy dollars (USDC) with Pix via the 4P Finance on-ramp. Enter R$, see
// the live quote, confirm CPF + your receiving wallet, get a Pix copy-paste code,
// watch it settle. 4P (the licensed PSP) sends USDC straight to the wallet you
// give — Slippay never holds the funds.
//
// Note: 4P settles on EVM/Solana (NOT Stellar), so the buyer supplies an
// EVM/Solana USDC wallet address. (Stellar-native settlement would need a bridge.)

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/auth.tsx";
import { loadAccount } from "../lib/account";
import {
  createOnramp4p,
  getOnramp4p,
  quote4p,
  status4p,
  Ramp4pError,
  type Ramp4pOrder,
} from "../lib/ramp4p";

const display = { fontFamily: "'DM Sans', sans-serif" } as const;
const GRAY = "#6f6862";
const PRESETS = [100, 500, 1000, 5000];
type Step = "amount" | "identity" | "pix" | "done";
const DONE = ["paid", "completed", "confirmed"];

const onlyDigits = (s: string) => s.replace(/\D/g, "");

export default function Cash() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [asset, setAsset] = useState("USDC");
  const [chain, setChain] = useState("Base");
  const [email, setEmail] = useState<string | null>(null);

  const [brl, setBrl] = useState(1000);
  const [cryptoOut, setCryptoOut] = useState<number | null>(null);
  const [step, setStep] = useState<Step>("amount");

  const [cpf, setCpf] = useState("");
  // The receiving wallet IS the user's biometric (passkey) wallet — never typed.
  const acct = useMemo(() => loadAccount(), []);

  const [order, setOrder] = useState<Ramp4pOrder | null>(null);
  const [status, setStatus] = useState<string>("pending");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let on = true;
    status4p().then((s) => {
      if (!on) return;
      setEnabled(s.enabled);
      if (s.asset) setAsset(s.asset);
      if (s.chain) setChain(s.chain);
    });
    supabase.auth.getSession().then(({ data }) => on && setEmail(data.session?.user?.email ?? null));
    return () => { on = false; };
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
    if (DONE.includes(status.toLowerCase())) { setStep("done"); return; }
    const t = setTimeout(async () => {
      try {
        const o = await getOnramp4p(order.id);
        if (o.transactionStatus) setStatus(o.transactionStatus);
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearTimeout(t);
  }, [step, order, status]);

  async function confirm() {
    setErr(null);
    if (!acct) { setErr("Crie sua conta com Face ID primeiro."); return; }
    if (onlyDigits(cpf).length !== 11) { setErr("CPF inválido (11 dígitos)."); return; }
    if (!email) { setErr("Entre na sua conta para continuar."); return; }
    setBusy(true);
    try {
      const o = await createOnramp4p({
        amountBrl: brl,
        receiverWallet: acct.walletId, // the user's biometric (passkey) wallet
        email,
        cpf: onlyDigits(cpf),
      });
      setOrder(o);
      setStatus(o.status ?? "pending");
      setStep("pix");
    } catch (e) {
      setErr(e instanceof Ramp4pError ? e.message : "Não deu pra criar a cobrança. Tente de novo.");
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

  const yellowBtn =
    "lift w-full max-w-[420px] px-7 py-5 rounded-full bg-[#FDDA24] text-[#0a0a0a] text-[12px] uppercase tracking-[0.22em] disabled:opacity-40";

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain overflow-x-hidden">
      <style>{`::selection{background:#FDDA24;color:#0a0a0a}`}</style>
      <header className="px-6 md:px-12 py-7 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold tracking-[-0.06em] lowercase" style={display}>slippay<span className="text-[#FDDA24]">.</span></Link>
        <Link to="/" className="text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]">Início</Link>
      </header>

      <main className="max-w-[680px] mx-auto px-6 md:px-12 pt-12 md:pt-20 pb-28">
        <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em]" style={{ color: GRAY }}>
          <span className="text-[#0a0a0a]/55">001</span><span className="h-px w-8 bg-current opacity-40" /><span>comprar dólar</span>
        </div>
        <h1 className="mt-10 font-bold uppercase tracking-[-0.05em] leading-[0.85] text-[clamp(2.5rem,9vw,5.5rem)]" style={display}>
          Compre dólar.<br /><span style={{ color: GRAY }}>Com Pix.</span>
        </h1>

        {enabled === false && (
          <div className="mt-12 rounded-3xl border border-[#0a0a0a]/12 bg-white/40 p-6 md:p-8 text-[#0a0a0a]/70">
            O pagamento em Pix está sendo ligado. Volte em instantes.
          </div>
        )}

        {enabled !== false && (
          <>
            {step === "amount" && (
              <>
                <div className="mt-12 rounded-3xl border border-[#0a0a0a]/12 bg-white/40 p-6 md:p-8">
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45">Você envia</div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl text-[#0a0a0a]/55" style={display}>R$</span>
                    <input type="number" min={0} value={brl}
                      onChange={(e) => setBrl(Math.max(0, Number(e.target.value)))}
                      className="w-full bg-transparent outline-none text-5xl md:text-6xl font-semibold tabular-nums tracking-[-0.03em]" style={display} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {PRESETS.map((p) => (
                      <button key={p} onClick={() => setBrl(p)}
                        className={`rounded-full px-4 py-1.5 text-[12px] tabular-nums border transition-colors ${brl === p ? "bg-[#0a0a0a] text-[#f1eee7] border-[#0a0a0a]" : "border-[#0a0a0a]/20 hover:border-[#0a0a0a]/50"}`}>
                        R$ {p.toLocaleString("pt-BR")}
                      </button>
                    ))}
                  </div>
                  <div className="my-6 h-px bg-[#0a0a0a]/10" />
                  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45">Você recebe (aprox.)</div>
                  <div className="mt-2 flex items-baseline gap-2.5">
                    <span className="text-3xl text-[#0a0a0a]/45" style={display}>$</span>
                    <span className="text-5xl md:text-6xl font-semibold tabular-nums tracking-[-0.03em]" style={display}>
                      {cryptoOut != null ? cryptoOut.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                    </span>
                    <span className="text-lg text-[#0a0a0a]/45 self-end mb-1.5">{asset}</span>
                  </div>
                  <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: GRAY }}>
                    {asset} na rede {chain} · valor final fixado no pagamento
                  </div>
                </div>

                {acct ? (
                  <button onClick={() => setStep("identity")} disabled={cryptoOut == null || brl <= 0} className={`mt-8 ${yellowBtn}`}>
                    Continuar com Pix →
                  </button>
                ) : (
                  <Link to="/account" className={`mt-8 inline-flex items-center justify-center ${yellowBtn}`}>Criar conta com Face ID →</Link>
                )}
              </>
            )}

            {step === "identity" && (
              <div className="mt-12 rounded-3xl border border-[#0a0a0a]/12 bg-white/40 p-6 md:p-8">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45">Seu CPF</div>
                <p className="mt-2 text-[13px] text-[#0a0a0a]/55">O Pix exige seu CPF. O dólar cai na <b>sua carteira</b> — a mesma da sua digital. Você não precisa de carteira nenhuma, nem colar endereço.</p>
                <div className="mt-6 space-y-4">
                  <input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="CPF" inputMode="numeric"
                    className="w-full rounded-xl border border-[#0a0a0a]/15 bg-white/60 px-4 py-3 outline-none focus:border-[#0a0a0a]/40" />
                  <input value={email ?? ""} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail (recibo do Pix)" inputMode="email"
                    className="w-full rounded-xl border border-[#0a0a0a]/15 bg-white/60 px-4 py-3 outline-none focus:border-[#0a0a0a]/40" />
                </div>
                {err && <div className="mt-4 text-[13px] text-red-700">{err}</div>}
                <div className="mt-6 flex items-center gap-4">
                  <button onClick={confirm} disabled={busy} className={yellowBtn}>
                    {busy ? "Gerando Pix…" : `Gerar Pix de R$ ${brl.toLocaleString("pt-BR")} →`}
                  </button>
                  <button onClick={() => setStep("amount")} className="text-[12px] uppercase tracking-[0.2em] text-[#0a0a0a]/45 hover:text-[#0a0a0a]">Voltar</button>
                </div>
              </div>
            )}

            {step === "pix" && order && (
              <div className="mt-12 rounded-3xl border border-[#0a0a0a]/12 bg-white/40 p-6 md:p-8">
                <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45">Pague com Pix</div>
                <p className="mt-2 text-[15px] text-[#0a0a0a]/70">Copie o código e pague no seu banco. O {asset} cai na sua carteira assim que o Pix confirmar.</p>
                <div className="mt-5 rounded-xl border border-[#0a0a0a]/15 bg-white/70 p-4 font-mono text-[12px] break-all text-[#0a0a0a]/80">
                  {order.pixCopiaECola ?? "—"}
                </div>
                <button onClick={copyPix} className={`mt-5 ${yellowBtn}`}>{copied ? "Copiado ✓" : "Copiar código Pix"}</button>
                <div className="mt-6 flex items-center gap-2 text-[13px] text-[#0a0a0a]/55">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#FDDA24] animate-pulse" />
                  Aguardando pagamento… ({status})
                </div>
              </div>
            )}

            {step === "done" && (
              <div className="mt-12 rounded-3xl border border-[#0a0a0a]/12 bg-white/40 p-6 md:p-8">
                <div className="text-4xl">✓</div>
                <h2 className="mt-3 text-2xl font-semibold" style={display}>Dólar a caminho da sua carteira.</h2>
                <p className="mt-2 text-[15px] text-[#0a0a0a]/70">Pagamento confirmado. O {asset} é enviado para a sua carteira na rede {chain}.</p>
                <Link to="/" className={`mt-8 inline-flex items-center justify-center ${yellowBtn}`}>Voltar ao início →</Link>
              </div>
            )}
          </>
        )}

        <p className="mt-6 text-[13px] text-[#0a0a0a]/55 max-w-[46ch] flex items-start gap-2">
          <span className="text-[#FDDA24] mt-0.5">✓</span>
          <span>Não-custodial: a 4P (licenciada) liquida direto na sua carteira. A Slippay nunca segura seu dinheiro.</span>
        </p>
      </main>
    </div>
  );
}
