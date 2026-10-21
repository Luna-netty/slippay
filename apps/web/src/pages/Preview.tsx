import { useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo.tsx";

type Step = "browse" | "modal-amount" | "modal-wallet" | "modal-approve" | "modal-success";
type Network = "STELLAR" | "SOLANA";

const PRODUCT = {
  brand: "Vortex Athletic",
  name: "Court Pro 90 — High Cut",
  sku: "VRX-CP90-WT-42",
  brl: "899.90",
  image: "🏷",  // placeholder swap to actual product image when ready
};

const WALLETS: { id: string; name: string; net: Network[]; available: boolean; tag?: string }[] = [
  { id: "freighter", name: "Freighter",   net: ["STELLAR"],          available: true,  tag: "Most popular" },
  { id: "lobstr",    name: "Lobstr",      net: ["STELLAR"],          available: true                   },
  { id: "xbull",     name: "xBull",       net: ["STELLAR"],          available: true                   },
  { id: "albedo",    name: "Albedo",      net: ["STELLAR"],          available: true                   },
  { id: "hana",      name: "Hana",        net: ["STELLAR"],          available: true                   },
  { id: "phantom",   name: "Phantom",     net: ["SOLANA"],           available: false, tag: "Soon"     },
  { id: "solflare",  name: "Solflare",    net: ["SOLANA"],           available: false, tag: "Soon"     },
];

export default function Preview() {
  const [step, setStep]   = useState<Step>("browse");
  const [net, setNet]     = useState<Network>("STELLAR");
  const [wallet, setWallet] = useState<string | null>(null);

  const usdcAmount = (Number(PRODUCT.brl) / 5.50).toFixed(2);   // mock rate
  const fakeTxHash = "0x" + Math.random().toString(16).slice(2, 18) + Math.random().toString(16).slice(2, 18);

  const close = () => { setStep("browse"); setWallet(null); };

  return (
    <div className="min-h-screen bg-[#fff] text-[#111] font-sans">
      {/* Mock e-commerce nav (Netshoes-like) */}
      <header className="border-b border-[#e6e6e6]">
        <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <span className="text-xl font-extrabold tracking-tight text-[#e63946]">runfast.</span>
            <nav className="hidden md:flex items-center gap-6 text-xs text-[#444]">
              <a className="hover:text-[#111]" href="#">running</a>
              <a className="hover:text-[#111]" href="#">basquete</a>
              <a className="hover:text-[#111]" href="#">academia</a>
              <a className="hover:text-[#111]" href="#">streetwear</a>
              <a className="hover:text-[#111]" href="#">ofertas</a>
            </nav>
          </div>
          <div className="flex items-center gap-5 text-xs text-[#444]">
            <span>📦 Frete grátis acima de R$ 199</span>
            <span className="hidden md:inline">|</span>
            <span className="hidden md:inline">Olá, visitante</span>
            <span className="bg-[#e63946] text-white rounded-full w-6 h-6 inline-flex items-center justify-center text-[10px] font-bold">1</span>
          </div>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-3 text-xs text-[#888]">
        <Link to="/" className="hover:text-[#111]">slippay.preview</Link>
        <span className="mx-2">/</span>
        <span>buyer-flow simulation</span>
        <span className="float-right">
          <Link to="/" className="text-[#888] hover:text-[#111]">← back to slippay</Link>
        </span>
      </div>

      {/* Product card */}
      <main className="max-w-[1200px] mx-auto px-6 py-8 grid md:grid-cols-12 gap-10">
        <div className="md:col-span-7">
          <div className="aspect-square bg-[#f3f3f3] rounded-lg flex items-center justify-center text-9xl select-none">
            {PRODUCT.image}
          </div>
        </div>

        <div className="md:col-span-5">
          <div className="text-xs uppercase tracking-wider text-[#888]">{PRODUCT.brand}</div>
          <h1 className="text-2xl md:text-3xl font-bold mt-1 leading-tight">{PRODUCT.name}</h1>
          <div className="text-[10px] text-[#999] mt-1 tabular-nums">SKU {PRODUCT.sku}</div>

          <div className="mt-6 flex items-baseline gap-3">
            <span className="text-[15px] line-through text-[#999]">R$ 1.099,90</span>
            <span className="text-3xl font-extrabold tracking-tight">R$ {PRODUCT.brl.replace(".", ",")}</span>
            <span className="text-xs bg-[#e63946] text-white px-2 py-0.5 rounded">-18%</span>
          </div>
          <div className="text-[12px] text-[#666] mt-1">ou 10x R$ 89,99 sem juros no cartão</div>

          <div className="mt-6">
            <div className="text-xs uppercase tracking-wider text-[#888] mb-2">tamanho</div>
            <div className="flex gap-2 flex-wrap">
              {[38, 39, 40, 41, 42, 43, 44].map(s => (
                <button key={s}
                  className={`w-11 h-11 border ${s === 42 ? "border-[#111] bg-[#111] text-white" : "border-[#ddd] text-[#444]"} rounded text-sm`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <button className="w-full bg-[#e63946] text-white py-4 text-sm font-bold uppercase tracking-wide rounded">
              Comprar com cartão
            </button>
            <button className="w-full bg-white border border-[#ddd] py-4 text-sm font-medium uppercase tracking-wide rounded text-[#444]">
              Pix · à vista
            </button>

            {/* SLIPPAY CTA */}
            <button onClick={() => setStep("modal-amount")}
              className="w-full bg-[#0a0a0a] text-[#f1eee7] py-4 text-sm font-bold uppercase tracking-wide rounded border-2 border-[#0a0a0a] hover:bg-[#1a1a1a] flex items-center justify-center gap-3">
              <span className="inline-block w-2 h-2 bg-[#FDDA24]" />
              Pagar com SlipPay (USDC · cripto)
            </button>
            <div className="text-[11px] text-[#888] text-center -mt-1">
              recebimento direto do merchant em USDC · sem chargeback · finality 6s
            </div>
          </div>

          <div className="mt-8 p-4 bg-[#f7f7f7] rounded text-xs text-[#444] leading-relaxed">
            <strong>Demonstração.</strong> Esta é uma simulação de uma loja parceira fictícia para mostrar como
            o SlipPay aparece num checkout real. Nada cobrado, nenhum produto enviado. Volte para
            <Link to="/" className="underline ml-1">slippay</Link> para o produto real.
          </div>
        </div>
      </main>

      {/* SLIPPAY MODAL */}
      {step !== "browse" && (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4">
          <div className="bg-[#f1eee7] text-[#0a0a0a] w-full max-w-md max-h-[90vh] overflow-auto">
            {/* modal header */}
            <div className="border-b border-[#0a0a0a]/15 px-6 py-5 flex items-center justify-between">
              <Logo />
              <button onClick={close} className="text-[#0a0a0a]/55 hover:text-[#0a0a0a] text-xl leading-none">×</button>
            </div>

            {step === "modal-amount" && (
              <div className="p-6 space-y-5">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 font-mono">001 · review</div>
                <div className="space-y-2">
                  <div className="text-xs text-[#0a0a0a]/55">paying for</div>
                  <div className="text-sm">{PRODUCT.brand} — {PRODUCT.name}</div>
                </div>
                <div className="border-y border-[#0a0a0a]/15 py-5 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#0a0a0a]/55">amount</span>
                    <span className="tabular-nums">R$ {PRODUCT.brl.replace(".", ",")}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#0a0a0a]/55">rate</span>
                    <span className="tabular-nums">1 USDC = R$ 5,50</span>
                  </div>
                  <div className="flex justify-between font-medium pt-2">
                    <span>you pay</span>
                    <span className="tabular-nums">{usdcAmount} USDC</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55">network</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setNet("STELLAR")}
                      className={`p-3 border-2 ${net === "STELLAR" ? "border-[#0a0a0a]" : "border-[#0a0a0a]/15"} text-left`}>
                      <div className="text-sm font-medium flex items-center gap-2">
                        Stellar
                        <span className="text-[9px] uppercase bg-[#FDDA24] text-[#0a0a0a] px-1 py-0.5">Live</span>
                      </div>
                      <div className="text-[10px] text-[#0a0a0a]/55 mt-1">~6s · sub-cent fee</div>
                    </button>
                    <button onClick={() => setNet("SOLANA")} disabled
                      className="p-3 border-2 border-[#0a0a0a]/15 text-left opacity-50 cursor-not-allowed">
                      <div className="text-sm font-medium flex items-center gap-2">
                        Solana
                        <span className="text-[9px] uppercase bg-[#0a0a0a]/15 text-[#0a0a0a] px-1 py-0.5">Soon</span>
                      </div>
                      <div className="text-[10px] text-[#0a0a0a]/55 mt-1">in roadmap</div>
                    </button>
                  </div>
                </div>
                <button onClick={() => setStep("modal-wallet")}
                  className="w-full bg-[#0a0a0a] text-[#f1eee7] py-4 text-[11px] uppercase tracking-[0.22em] hover:bg-[#1a1a1a]">
                  Continue → connect wallet
                </button>
              </div>
            )}

            {step === "modal-wallet" && (
              <div className="p-6 space-y-5">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 font-mono">002 · wallet</div>
                <div className="text-sm text-[#0a0a0a]/75">
                  Pick your wallet. SlipPay is non-custodial — your keys never leave your device.
                </div>
                <div className="space-y-2">
                  {WALLETS.filter(w => w.net.includes(net)).map(w => (
                    <button key={w.id} onClick={() => { if (w.available) { setWallet(w.id); setStep("modal-approve"); } }}
                      disabled={!w.available}
                      className={`w-full px-4 py-3 border text-left flex items-center justify-between
                        ${w.available ? "border-[#0a0a0a]/15 hover:border-[#0a0a0a] cursor-pointer" : "border-[#0a0a0a]/10 opacity-50 cursor-not-allowed"}`}>
                      <span className="text-sm font-medium">{w.name}</span>
                      {w.tag && (
                        <span className={`text-[9px] uppercase px-1.5 py-0.5 ${w.available ? "bg-[#FDDA24]" : "bg-[#0a0a0a]/15"} text-[#0a0a0a]`}>
                          {w.tag}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <button onClick={() => setStep("modal-amount")}
                  className="w-full text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 hover:text-[#0a0a0a] py-3">
                  ← back
                </button>
              </div>
            )}

            {step === "modal-approve" && (
              <div className="p-6 space-y-5">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 font-mono">003 · approve</div>
                <div className="text-sm text-[#0a0a0a]/75">
                  Your wallet (<strong>{WALLETS.find(w => w.id === wallet)?.name}</strong>) will request signature for one
                  payment operation: <strong className="tabular-nums">{usdcAmount} USDC</strong> to the seller
                  on the <strong>{net.toLowerCase()}</strong> network. Settles in roughly 6 seconds.
                </div>
                <div className="bg-[#0a0a0a] text-[#f1eee7] p-4 font-mono text-[11px] leading-[1.6]">
                  &gt; signing transaction...<br/>
                  &gt; memo (hash): <span className="text-[#FDDA24]">{Math.random().toString(16).slice(2, 14)}</span>...<br/>
                  &gt; awaiting your wallet approval
                </div>
                <button onClick={() => setStep("modal-success")}
                  className="w-full bg-[#0a0a0a] text-[#f1eee7] py-4 text-[11px] uppercase tracking-[0.22em] hover:bg-[#1a1a1a]">
                  Approve in wallet (mock)
                </button>
                <button onClick={() => setStep("modal-wallet")}
                  className="w-full text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 hover:text-[#0a0a0a] py-3">
                  ← back
                </button>
              </div>
            )}

            {step === "modal-success" && (
              <div className="p-6 space-y-5 text-center">
                <div className="w-12 h-12 bg-[#FDDA24] mx-auto flex items-center justify-center">
                  <span className="text-3xl text-[#0a0a0a]">✓</span>
                </div>
                <div className="text-2xl font-medium tracking-tight">Payment confirmed</div>
                <div className="text-sm text-[#0a0a0a]/75">
                  Merchant received <strong className="tabular-nums">{usdcAmount} USDC</strong> on {net.toLowerCase()}.
                  No chargeback possible. Webhook fired.
                </div>
                <div className="bg-[#0a0a0a]/[0.04] p-3 text-[11px] font-mono text-[#0a0a0a]/75 break-all">
                  tx: {fakeTxHash}
                </div>
                <button onClick={close}
                  className="w-full bg-[#0a0a0a] text-[#f1eee7] py-4 text-[11px] uppercase tracking-[0.22em] hover:bg-[#1a1a1a]">
                  Continue shopping (mock)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
