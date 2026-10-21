// /cobrar — merchant side. Pick an amount, show a QR; the customer scans it on
// /pay and authorizes with a touch. Mainnet, real USDC: the recipient is a real
// account with a USDC trustline. (In production this is the merchant's own
// receive address.) Amounts are kept small for the live demo (the demo wallet is
// funded with 0.2 USDC).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { encodeRequest } from "../lib/slippayqr";
import { LiveProof } from "../components/LiveProof";
import { V3Ribbon } from "../components/V3Ribbon.tsx";

const display = { fontFamily: "'DM Sans', sans-serif" } as const;
// Real mainnet recipient (has a USDC trustline). Demo "merchant" receive address.
const RECIPIENT = "GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P";
const PRESETS = [0.05, 0.1, 0.15];

export default function Cobrar() {
  const [amount, setAmount] = useState(0.1);
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const payLink = `${typeof window !== "undefined" ? window.location.origin : "https://app.slippay.cc"}/pay?to=${RECIPIENT}&amount=${Math.round(amount * 1e7)}&asset=USDC`;
  async function sharePay() {
    const data = { title: "Pay me with SlipPay", text: `Pay ${amount} USDC — one touch, no app:`, url: payLink };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard?.writeText(payLink);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { /* dismissed */ }
  }

  useEffect(() => {
    const uri = encodeRequest({
      to: RECIPIENT,
      amount: String(Math.round(amount * 1e7)),
      asset: "USDC",
      label: "Slippay",
    });
    QRCode.toDataURL(uri, { margin: 1, width: 320, color: { dark: "#0a0a0a", light: "#f1eee7" } })
      .then(setQr).catch((e) => setErr((e as Error).message));
  }, [amount]);

  return (
    <div className="min-h-screen relative bg-transparent text-[#0a0a0a] grain overflow-x-hidden">
      <V3Ribbon />
      <header className="px-6 md:px-12 py-7 flex items-center justify-between">
        <Link to="/" className="text-lg font-semibold tracking-[-0.04em]" style={display}>slippay<span className="text-[#2563eb]">.</span></Link>
        <Link to="/pay" className="text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]">Pay →</Link>
      </header>
      <main className="max-w-[560px] mx-auto px-6 md:px-12 pt-10 md:pt-16 pb-24 text-center">
        <div className="flex items-baseline justify-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#0a0a0a]/45">
          <span className="text-[#0a0a0a]/70">001</span>
          <span className="h-px w-8 bg-current opacity-40" />
          <span>charge · show the QR · mainnet</span>
        </div>
        <h1 className="mt-10 font-bold uppercase tracking-[-0.05em] leading-[0.85] text-[clamp(2.5rem,10vw,5.5rem)]" style={display}>
          How much?
        </h1>

        <div className="mt-10 flex flex-wrap justify-center gap-2">
          {PRESETS.map((p) => (
            <button key={p} onClick={() => setAmount(p)}
              className={"lift px-5 py-3 text-sm font-mono tabular-nums rounded-full border transition-colors " +
                (amount === p ? "bg-[#0a0a0a] text-[#f1eee7] border-[#0a0a0a]" : "border-[#0a0a0a]/25 hover:border-[#0a0a0a]/60")}>
              {p} USDC
            </button>
          ))}
        </div>

        <div className="mt-10 inline-flex flex-col items-center">
          {qr ? (
            <img src={qr} alt="payment QR" className="w-[280px] h-[280px] rounded-2xl border border-[#0a0a0a]/15" />
          ) : (
            <div className="w-[280px] h-[280px] rounded-2xl border border-[#0a0a0a]/15 flex items-center justify-center text-xs text-[#0a0a0a]/45">generating…</div>
          )}
          <div className="mt-5 text-3xl font-medium tabular-nums" style={display}>{amount} USDC</div>
          <div className="mt-2 text-[10px] uppercase tracking-[0.22em] font-mono"
            style={{ color: err ? "#b00" : "#6f6862" }}>
            {err ? "✗ " + err : "● ready to receive · mainnet"}
          </div>
          <button onClick={sharePay}
            className="lift mt-6 inline-flex items-center justify-center rounded-full px-8 py-3.5 text-[11px] uppercase tracking-[0.22em] bg-[#0a0a0a] text-white font-medium">
            {copied ? "Pay link copied ✓" : "Share pay link"}
          </button>
          <div className="mt-3 font-mono text-[10px] text-[#0a0a0a]/40 max-w-[300px] mx-auto break-all">{payLink}</div>
        </div>

        <p className="mt-10 text-xs text-[#0a0a0a]/45 leading-relaxed max-w-[46ch] mx-auto">
          The customer opens <Link to="/pay" className="underline">/pay</Link>, points the camera at this QR,
          sees the amount, and authorizes with a touch. Real dollars (USDC), on the main network.
        </p>
        <div className="mt-12"><LiveProof /></div>
      </main>
    </div>
  );
}
