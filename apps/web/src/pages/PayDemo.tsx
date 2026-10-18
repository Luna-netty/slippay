// /pay — REAL biometric payment on Stellar, presented as a premium, human
// experience (no dev terminal). Editorial monumental register. Same logic: a
// device passkey (biometrics) is minted, the gas-sponsor relayer deploys a
// smart-wallet bound to it and fronts a small float, and "pay" moves funds
// authorized ONLY by a live biometric tap, verified on-chain by __check_auth.
// The relayer pays network fees only. Progress shows as elegant live steps;
// errors are friendly, never raw.

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { QrScanner } from "../components/QrScanner";
import { decodeRequest, stroopsToXlm, type PayRequest } from "../lib/slippayqr";
import { createPasskey, payViaRelayer, type PasskeyHandle } from "../lib/passkey";
import { FaceScan } from "../components/FaceScan";
import { LiveProof } from "../components/LiveProof";

const display = { fontFamily: "'DM Sans', sans-serif" } as const;
const RELAYER_BASE = (import.meta.env.VITE_RELAYER_BASE as string | undefined)
  ?? "https://api.slippay.cc/api/v1/relayer";

const CREATE_STEPS = ["Securing a private channel", "Creating your key with biometrics", "Building your wallet on-chain", "Your wallet is ready"];
const PAY_STEPS = ["Authorizing with biometrics", "Settling on Stellar", "Paid · final in seconds"];

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function short(s: string, h = 6, t = 6) { return s.length <= h + t + 1 ? s : `${s.slice(0, h)}…${s.slice(-t)}`; }
function friendly(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/NotAllowed|timed out|not allowed|abort|cancel/i.test(m)) return "We couldn't read your biometrics. Tap to try again.";
  if (/balance|insufficient|trustline|trust line|#10\b|#13\b/i.test(m)) return "This wallet has no USDC yet. Add money (Pix → USDC) first, then pay.";
  if (/rejected|simulation|sim failed|Contract,|HostError|Error\(/i.test(m)) return "The network rejected this payment — usually the wallet has no USDC, or no USDC trustline yet. Add money first.";
  if (/relayer|sponsor|no response/i.test(m)) return "Our network sponsor is waking up. Try again in a moment.";
  if (/deploy/i.test(m)) return "Your wallet didn't finish setting up. Tap to try again.";
  return "Something interrupted the flow. Tap to try again.";
}

export default function PayDemo() {
  const [handle, setHandle] = useState<PasskeyHandle | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [sponsor, setSponsor] = useState<string | null>(null);
  const [network, setNetwork] = useState<"TESTNET" | "PUBLIC">("TESTNET");
  const [scanning, setScanning] = useState(false);
  const [req, setReq] = useState<PayRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [payHash, setPayHash] = useState<string | null>(null);
  const [paidLabel, setPaidLabel] = useState<string | null>(null);
  const [paidReq, setPaidReq] = useState<{ to: string; amount: string; asset: string; at: string } | null>(null);
  // premium status model (replaces the dev log)
  const [flow, setFlow] = useState<null | "create" | "pay">(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rawErr, setRawErr] = useState<string | null>(null);
  const [verified, setVerified] = useState<"checking" | "ok" | "fail">("checking");
  const [shared, setShared] = useState(false);

  const explorerNet = network === "PUBLIC" ? "public" : "testnet";
  const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* unsupported */ } };

  // zero-friction pay link: a shared link like /pay?to=…&amount=…&asset=USDC
  // pre-fills the request — no QR scan needed. Open link -> touch -> paid.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const to = sp.get("to"); const amount = sp.get("amount"); const asset = sp.get("asset");
    if (to && amount && /^[GC][A-Z2-7]{55}$/.test(to) && /^\d+$/.test(amount)) {
      setReq({ to, amount, asset: asset === "USDC" || asset === "XLM" ? asset : undefined });
    }
  }, []);

  // living receipt: actually re-check the tx on the network when it lands.
  useEffect(() => {
    if (!payHash) return;
    setVerified("checking");
    const base = network === "PUBLIC" ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org";
    fetch(`${base}/transactions/${payHash}`)
      .then((r) => r.json())
      .then((j) => { setVerified(j?.successful ? "ok" : "fail"); if (j?.successful) buzz([15, 30, 15, 30, 50]); })
      .catch(() => setVerified("fail"));
  }, [payHash, network]);

  // k-factor: share an IN-PRODUCT receipt (carries a "pay/get paid with a touch"
  // CTA) instead of a dead-end explorer link — every shared receipt recruits.
  function receiptUrl() {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://app.slippay.cc";
    const q = paidReq ? `?to=${paidReq.to}&amount=${stroopsToXlm(paidReq.amount)}&asset=${paidReq.asset}&net=${explorerNet}` : "";
    return `${origin}/comprovante/${payHash}${q}`;
  }
  async function shareReceipt() {
    const url = receiptUrl();
    const data = { title: "SlipPay receipt", text: `Paid ${paidLabel ?? ""} with one touch — no app, no seed phrase. Pay or get paid:`, url };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard?.writeText(url);
      setShared(true); setTimeout(() => setShared(false), 2000);
    } catch { /* user dismissed */ }
  }
  const steps = flow === "pay" ? PAY_STEPS : CREATE_STEPS;
  const biometricStep = flow === "create" ? 1 : 0;
  const showScan = busy && !error && flow !== null && step === biometricStep;

  async function onCreateAccount() {
    setBusy(true); setError(null); setPayHash(null); setPaidLabel(null); setFlow("create"); setStep(0);
    try {
      const info = await fetch(`${RELAYER_BASE}/info`).then((r) => r.json()).catch(() => ({}));
      if (!info.sponsor) throw new Error("relayer: no response");
      setSponsor(info.sponsor);
      setNetwork(info.network === "PUBLIC" ? "PUBLIC" : "TESTNET");
      setStep(1);
      const h = await createPasskey("slippay");
      setHandle(h);
      setStep(2);
      const resp = await fetch(`${RELAYER_BASE}/deploy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passkey_pubkey_hex: bytesToHex(h.pubKey), cred_id_hex: bytesToHex(h.credId) }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || !j.wallet_id) throw new Error("deploy: " + (j.reason ?? j.error ?? resp.status));
      setWallet(j.wallet_id);
      setStep(3);
    } catch (e) { setError(friendly(e)); setRawErr((e as Error)?.message ?? String(e)); } finally { setBusy(false); }
  }

  function onScanned(text: string) {
    setScanning(false);
    try { setReq(decodeRequest(text)); setError(null); }
    catch (e) { setError("That QR isn't a SlipPay request. Scan another."); }
  }

  async function onPayReq() {
    if (!handle || !wallet || !sponsor || !req) return;
    const label = `${stroopsToXlm(req.amount)} ${req.asset ?? "USDC"}`;
    setBusy(true); setError(null); setPayHash(null); setFlow("pay"); setStep(0);
    buzz(20); // tactile cue at the authorization moment
    try {
      const hash = await payViaRelayer({
        network, relayerBase: RELAYER_BASE, sponsor,
        walletId: wallet, recipient: req.to, amount: req.amount,
        asset: req.asset ?? "USDC", credId: handle.credId,
      });
      setStep(2); setPayHash(hash); setPaidLabel(label);
      setPaidReq({ to: req.to, amount: req.amount, asset: req.asset ?? "USDC", at: new Date().toLocaleString() });
      setReq(null);
    } catch (e) { setError(friendly(e)); setRawErr((e as Error)?.message ?? String(e)); } finally { setBusy(false); }
  }

  const accountReady = !!wallet;

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain overflow-x-hidden">
      <header className="px-6 md:px-12 py-7 flex items-center justify-between">
        <Link to="/" className="text-lg font-semibold tracking-[-0.04em]" style={display}>slippay<span className="text-[#FDDA24]">.</span></Link>
        <Link to="/" className="text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]">Home</Link>
      </header>

      <main className="max-w-[720px] mx-auto px-6 md:px-12 pt-10 md:pt-16 pb-28">
        <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#0a0a0a]/45">
          <span className="text-[#0a0a0a]/70">001</span>
          <span className="h-px w-8 bg-current opacity-40" />
          <span>pay with a touch · {network === "PUBLIC" ? "mainnet" : "testnet"}</span>
        </div>

        <h1 className="mt-10 font-bold uppercase tracking-[-0.05em] leading-[0.85] text-[clamp(2.75rem,11vw,6.5rem)] break-words" style={display}>
          Pay with a touch.
        </h1>
        <p className="mt-8 text-xl leading-relaxed max-w-[48ch] text-[#0a0a0a]/75">
          This is the rail your agent uses to pay. Create a wallet with your biometrics and send a real
          payment — authorized only by you, verified on-chain.
          <span className="text-[#0a0a0a] font-medium"> Free, on your phone. No app, no seed phrase.</span>
        </p>
        <a href="/cash" className="mt-5 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 hover:text-[#0a0a0a] border-b border-[#0a0a0a]/20 pb-0.5">
          No dollars yet? Add funds<span className="text-[#0a0a0a]/40">→</span>
        </a>

        <div className="mt-12 flex flex-col gap-3 max-w-[400px]">
          <button onClick={onCreateAccount} disabled={busy}
            className="lift px-7 py-4 rounded-full bg-[#FDDA24] text-[#0a0a0a] text-[11px] uppercase tracking-[0.22em] disabled:opacity-40">
            {accountReady ? "Wallet ready ✓" : "1 · Create my wallet"}
          </button>
          <button onClick={() => setScanning(true)} disabled={busy || !accountReady}
            className="lift px-7 py-4 rounded-full bg-[#FDDA24] text-[#0a0a0a] text-[11px] uppercase tracking-[0.22em] font-medium disabled:opacity-40">
            2 · Pay a request (QR)
          </button>
        </div>

        {/* confirm — see WHO and HOW MUCH before you authorize */}
        {req && !busy && (
          <div className="mt-8 p-6 rounded-2xl border-2 border-[#0a0a0a] max-w-[400px]">
            <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 font-mono mb-3">Confirm the payment</div>
            <div className="text-4xl font-medium tabular-nums tracking-[-0.03em]" style={display}>{stroopsToXlm(req.amount)} <span className="text-base text-[#0a0a0a]/55">{req.asset ?? "USDC"}</span></div>
            <div className="text-xs font-mono text-[#0a0a0a]/55 mt-2 break-all">to {short(req.to, 8, 8)}</div>
            {wallet ? (
              <button onClick={onPayReq}
                className="lift mt-5 w-full px-6 py-4 rounded-full bg-[#FDDA24] text-[#0a0a0a] text-[11px] uppercase tracking-[0.22em] font-medium">
                Authorize with a touch
              </button>
            ) : (
              <button onClick={onCreateAccount}
                className="lift mt-5 w-full px-6 py-4 rounded-full bg-[#FDDA24] text-[#0a0a0a] text-[11px] uppercase tracking-[0.22em] font-medium">
                Create wallet to pay (a touch)
              </button>
            )}
            <button onClick={() => setReq(null)}
              className="mt-2 w-full px-6 py-3 text-[11px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]">
              Cancel
            </button>
          </div>
        )}

        {scanning && <QrScanner onScan={onScanned} onClose={() => setScanning(false)} />}

        {/* PREMIUM STATUS — the experience, not a terminal */}
        {flow !== null && (
          <div className="mt-10 max-w-[440px] rounded-[24px] overflow-hidden text-[#f1eee7]"
            style={{
              background: "linear-gradient(160deg,#15151a 0%,#0a0a0c 55%,#101013 100%)",
              boxShadow: "0 30px 80px -30px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.06)",
              border: "1px solid rgba(255,255,255,.08)",
            }}>
            <div className="h-[3px] w-full bg-gradient-to-r from-[#cabfb0] via-[#cabfb0]/40 to-transparent" />
            <div className="px-7 py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.24em] text-[#f1eee7]/55">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FDDA24] animate-pulse" />
                  slippay · secure
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#f1eee7]/40">Stellar · {network === "PUBLIC" ? "mainnet" : "testnet"}</span>
              </div>

              {/* biometric moment */}
              {showScan && (
                <div className="mt-5"><FaceScan state="scanning" /></div>
              )}

              {/* paid celebration */}
              {payHash && (
                <div className="mt-6 text-center">
                  <div className="mx-auto"><FaceScan state="done" /></div>
                  <div className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-[#cabfb0]" style={display}>Paid.</div>
                  {paidLabel && <div className="mt-1 text-lg tabular-nums text-[#f1eee7]/85">{paidLabel}</div>}
                  <div className="mt-1 font-mono text-[11px] text-[#f1eee7]/45">moved on-chain · only your touch authorized it</div>
                  {/* inline receipt — generated right here, on the same screen */}
                  <div className="mt-6 mx-auto max-w-[360px] rounded-2xl bg-[#f1eee7]/[0.04] border border-[#f1eee7]/12 p-5 text-left">
                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/45">
                      <span>receipt</span>
                      <span style={{ color: verified === "fail" ? "#f87171" : "#cabfb0" }}>
                        {verified === "ok" ? "✓ verified on-chain" : verified === "checking" ? "verifying…" : "unconfirmed"}
                      </span>
                    </div>
                    <div className="mt-4 divide-y divide-[#f1eee7]/8 text-[13px]">
                      {[
                        ["Amount", paidLabel ?? ""],
                        ["To", short(paidReq?.to ?? "", 8, 6)],
                        ["From", "your wallet · " + short(wallet ?? "", 6, 4)],
                        ["Network", network === "PUBLIC" ? "Stellar mainnet" : "Stellar testnet"],
                        ["When", paidReq?.at ?? ""],
                      ].map(([k, v]) => (
                        <div key={k} className="flex items-baseline justify-between gap-4 py-2">
                          <span className="text-[#f1eee7]/45">{k}</span>
                          <span className="font-mono text-[12px] text-[#f1eee7]/90 text-right break-all">{v}</span>
                        </div>
                      ))}
                      <div className="flex items-baseline justify-between gap-4 py-2">
                        <span className="text-[#f1eee7]/45">Tx</span>
                        <a href={`https://stellar.expert/explorer/${explorerNet}/tx/${payHash}`} target="_blank" rel="noopener noreferrer"
                          className="font-mono text-[12px] text-[#cabfb0] hover:underline underline-offset-4 break-all text-right">
                          {short(payHash, 8, 6)} ↗
                        </a>
                      </div>
                    </div>
                    <div className="mt-4 font-mono text-[9px] uppercase tracking-[0.18em] text-[#f1eee7]/35 leading-relaxed">
                      Public &amp; permanent · anyone can verify this payment on the blockchain.
                    </div>
                    <button onClick={shareReceipt}
                      className="lift mt-4 w-full inline-flex items-center justify-center rounded-full px-6 py-3 text-[10px] uppercase tracking-[0.2em] bg-[#cabfb0] text-[#0a0a0a] font-medium">
                      {shared ? "Link copied ✓" : "Share receipt"}
                    </button>
                  </div>
                  {/* k-factor: turn the payer into a receiver — they make their own link and share it */}
                  <Link to="/cobrar"
                    className="mt-4 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[#f1eee7]/70 hover:text-[#cabfb0] border-b border-[#f1eee7]/25 pb-1">
                    Now get paid too — create your link →
                  </Link>
                </div>
              )}

              {/* error, human */}
              {error && (
                <div className="mt-6">
                  <div className="text-lg font-medium tracking-[-0.01em]">{error}</div>
                  {rawErr && <div className="mt-2 font-mono text-[10px] text-[#0a0a0a]/40 break-all max-w-[420px]">{rawErr.slice(0, 240)}</div>}
                  <button
                    onClick={() => (flow === "pay" && handle && wallet ? setScanning(true) : onCreateAccount())}
                    className="lift mt-4 inline-flex items-center rounded-full px-6 py-3 text-[10px] uppercase tracking-[0.2em] bg-[#cabfb0] text-[#0a0a0a]">
                    Try again
                  </button>
                </div>
              )}

              {/* steps */}
              {!payHash && !error && (
                <div className="mt-6 space-y-3.5">
                  {steps.map((label, i) => {
                    const done = i < step;
                    const active = i === step && busy;
                    return (
                      <div key={label} className="flex items-center gap-3.5 transition-all duration-500"
                        style={{ opacity: i <= step ? 1 : 0.35 }}>
                        <span className="grid place-items-center w-6 h-6 rounded-full text-[11px] shrink-0"
                          style={{
                            background: done ? "#cabfb0" : "transparent",
                            color: done ? "#0a0a0a" : "#f1eee7",
                            border: done ? "none" : "1px solid rgba(241,238,231,.25)",
                          }}>
                          {done ? "✓" : active ? <span className="w-2 h-2 rounded-full bg-[#FDDA24] animate-pulse" /> : i + 1}
                        </span>
                        <span className={`text-[15px] ${active ? "text-[#f1eee7]" : "text-[#f1eee7]/75"}`}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <p className="mt-8 text-xs text-[#0a0a0a]/45 leading-relaxed max-w-[52ch]">
          {network === "PUBLIC"
            ? "Mainnet — real money. The relayer sponsors only the network fee; your money stays in a wallet that only your touch can move."
            : "Testnet (free play money) — to prove the flow on your device."}
          {" "}Works on any device with biometrics + a modern browser.
        </p>
        <div className="mt-12"><LiveProof /></div>
      </main>
    </div>
  );
}
