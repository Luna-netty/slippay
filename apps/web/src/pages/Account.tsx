// /account — one-touch account, same biometric system as payments. Tap once
// (Face/Touch ID) -> a device passkey is minted -> the relayer deploys your
// smart wallet -> that wallet IS your account, stored locally so you return to
// it. No email, no password, no seed phrase. Editorial register, Stellar yellow.

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { createPasskey } from "../lib/passkey";
import { loadAccount, saveAccount, clearAccount, type Account as Acct } from "../lib/account";
import { LiveProof } from "../components/LiveProof";

const display = { fontFamily: "'DM Sans', sans-serif" } as const;
const RELAYER_BASE = (import.meta.env.VITE_RELAYER_BASE as string | undefined)
  ?? "https://api.slippay.cc/api/v1/relayer";
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const short = (s: string, h = 6, t = 6) => (s && s.length > h + t + 1 ? `${s.slice(0, h)}…${s.slice(-t)}` : s);
const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* unsupported */ } };

function friendly(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/NotAllowed|timed out|not allowed|abort|cancel|no available authenticator|not supported/i.test(m))
    return "This device couldn't create your key. SlipPay needs biometrics — Face ID, Touch ID or a fingerprint. On a computer without it, open app.slippay.cc on your phone.";
  if (/relayer|sponsor|unavailable/i.test(m)) return "Our network sponsor is waking up. Try again in a moment.";
  if (/deploy/i.test(m)) return "Your wallet didn't finish setting up. Tap to try again.";
  return "Something interrupted setup. Tap to try again.";
}

export default function Account() {
  const [acct, setAcct] = useState<Acct | null>(() => loadAccount());
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Proactively detect whether this device can do biometrics, so we warn BEFORE
  // the user taps (a computer with no Face ID / fingerprint can't create a passkey).
  const [bioOk, setBioOk] = useState<boolean | null>(null);
  useEffect(() => {
    let on = true;
    const w = window as unknown as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } };
    const fn = w.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable;
    if (!fn) { setBioOk(false); return; }
    fn().then((ok) => { if (on) setBioOk(ok); }).catch(() => { if (on) setBioOk(false); });
    return () => { on = false; };
  }, []);

  async function createAccount() {
    setBusy(true); setError(null);
    try {
      setStep("Securing a private channel…");
      const info = await fetch(`${RELAYER_BASE}/info`).then((r) => r.json()).catch(() => ({}));
      if (!info.sponsor) throw new Error("relayer unavailable");
      const network: Acct["network"] = info.network === "PUBLIC" ? "PUBLIC" : "TESTNET";
      setStep("Touch to create your key…"); buzz(20);
      const h = await createPasskey("slippay");
      setStep("Building your wallet on-chain…");
      const resp = await fetch(`${RELAYER_BASE}/deploy`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ passkey_pubkey_hex: hex(h.pubKey), cred_id_hex: hex(h.credId) }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j.wallet_id) throw new Error("deploy: " + (j.reason ?? j.error ?? resp.status));
      const a: Acct = {
        walletId: j.wallet_id, credIdHex: hex(h.credId), pubKeyHex: hex(h.pubKey),
        network, funded: String(j.funded ?? "0"), createdAt: new Date().toISOString(),
      };
      saveAccount(a); setAcct(a); buzz([15, 30, 15, 30, 50]);
    } catch (e) { setError(friendly(e)); } finally { setBusy(false); setStep(""); }
  }

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain overflow-x-hidden">
      <header className="px-6 md:px-12 py-7 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold tracking-[-0.06em] lowercase" style={display}>slippay<span className="text-[#FDDA24]">.</span></Link>
        <Link to="/" className="text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]">Home</Link>
      </header>

      <main className="max-w-[760px] mx-auto px-6 md:px-12 pt-12 md:pt-20 pb-28">
        {!acct ? (
          <>
            <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#0a0a0a]/45">
              <span className="text-[#0a0a0a]/70">001</span><span className="h-px w-8 bg-current opacity-40" /><span>create your account</span>
            </div>
            <h1 className="mt-10 font-bold uppercase tracking-[-0.05em] leading-[0.85] text-[clamp(2.75rem,11vw,6.5rem)]" style={display}>
              One touch.<br />That's your account.
            </h1>
            <p className="mt-8 text-xl leading-relaxed max-w-[46ch] text-[#0a0a0a]/75">
              No email, no password, no seed phrase. Your biometrics create a key only you hold,
              and that becomes your account — the same system that authorizes your payments.
            </p>

            {bioOk === false && (
              <div className="mt-10 max-w-[440px] rounded-2xl border border-[#6f6862]/40 bg-[#6f6862]/[0.06] p-5">
                <div className="text-[15px] font-medium tracking-[-0.01em]" style={display}>This device has no biometrics.</div>
                <p className="mt-1.5 text-sm text-[#0a0a0a]/65 leading-relaxed">
                  SlipPay creates your account with Face ID, Touch ID or a fingerprint — a computer without it can't.
                  Open <span className="font-mono text-[#6f6862]">app.slippay.cc/account</span> on your phone to create it in one touch.
                </p>
              </div>
            )}

            <button onClick={createAccount} disabled={busy || bioOk === false}
              className="lift mt-8 w-full max-w-[400px] px-7 py-5 rounded-full bg-[#FDDA24] text-[#0a0a0a] text-[12px] uppercase tracking-[0.22em] disabled:opacity-40">
              {busy ? (step || "…") : bioOk === false ? "Open on your phone to create" : "Create my account (one touch)"}
            </button>

            {error && (
              <div className="mt-6 max-w-[400px]">
                <div className="text-[#0a0a0a]">{error}</div>
                <button onClick={createAccount} className="lift mt-3 inline-flex rounded-full px-6 py-3 text-[10px] uppercase tracking-[0.2em] bg-[#FDDA24] text-[#0a0a0a]">Try again</button>
              </div>
            )}

            <p className="mt-10 text-xs text-[#0a0a0a]/45 max-w-[48ch] leading-relaxed">
              Works on any device with biometrics + a modern browser. Already a merchant with an API key?
              <Link to="/login" className="underline ml-1">Sign in with email</Link>.
            </p>
            <div className="mt-12"><LiveProof /></div>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#0a0a0a]/45">
              <span className="text-[#0a0a0a]/70">✓</span><span className="h-px w-8 bg-current opacity-40" /><span>you're in · {acct.network === "PUBLIC" ? "mainnet" : "testnet"}</span>
            </div>
            <h1 className="mt-10 font-bold uppercase tracking-[-0.05em] leading-[0.85] text-[clamp(2.5rem,9vw,6rem)]" style={display}>
              Welcome <span className="text-[#6f6862]">back.</span>
            </h1>

            <div className="mt-12 rounded-2xl border border-[#0a0a0a]/12 p-7 max-w-[520px]">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45">your account</div>
              <div className="mt-3 font-mono text-sm break-all text-[#0a0a0a]/80">{short(acct.walletId, 10, 8)}</div>
              <div className="mt-4 flex items-baseline gap-6">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#0a0a0a]/40">opening balance</div>
                  <div className="text-2xl tabular-nums" style={display}>{(Number(acct.funded) / 1e7).toFixed(2)} <span className="text-sm text-[#0a0a0a]/50">USDC</span></div>
                </div>
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#0a0a0a]/40">since</div>
                  <div className="text-sm tabular-nums text-[#0a0a0a]/70">{new Date(acct.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
            </div>

            <Link
              to="/buy"
              className="lift mt-6 inline-flex w-full max-w-[520px] items-center justify-center px-7 py-4 rounded-full bg-[#FDDA24] text-[#0a0a0a] text-[12px] uppercase tracking-[0.22em] font-medium">
              Add money · Pix → dollars
            </Link>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-[520px]">
              <Link to="/pay" className="lift rounded-full px-5 py-3.5 text-center text-[11px] uppercase tracking-[0.2em] bg-[#FDDA24] text-[#0a0a0a]">Pay</Link>
              <Link to="/cobrar" className="lift rounded-full px-5 py-3.5 text-center text-[11px] uppercase tracking-[0.2em] bg-[#FDDA24] text-[#0a0a0a] font-medium">Get paid</Link>
              <Link to="/withdraw-demo" className="rounded-full px-5 py-3.5 text-center text-[11px] uppercase tracking-[0.2em] border border-[#0a0a0a]/25 hover:border-[#0a0a0a]/60">Withdraw</Link>
            </div>

            <button onClick={() => { clearAccount(); setAcct(null); }}
              className="mt-10 text-[10px] uppercase tracking-[0.2em] text-[#0a0a0a]/45 hover:text-[#0a0a0a]">Sign out of this device</button>
            <div className="mt-12"><LiveProof /></div>
          </>
        )}
      </main>
    </div>
  );
}
