import { useState } from "react";
import { Link } from "react-router-dom";
import { createDemoOrder } from "../lib/api.ts";

const KLEIN = "#FDDA24";

// A fictional storefront ("Ateliê Norte") used for the end-user purchase
// demo. The product is priced in BRL; checkout converts to USDC live and
// settles on Stellar. This page is the BUYER's point of view — the person
// buying a product — not the merchant dashboard.
const PRODUCT = {
  name: "Cadeira Lina",
  tagline: "Edição limitada · madeira maciça + couro natural",
  priceBRL: "1290.00",
  priceLabel: "R$ 1.290,00",
  blurb:
    "Assento esculpido à mão pelo Ateliê Norte, em Blumenau. Estrutura em " +
    "imbuia, acabamento em couro curtido vegetal. Produzida sob encomenda, " +
    "enviada para qualquer lugar do mundo.",
};

export default function Store() {
  const [phase, setPhase] = useState<"idle" | "creating" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    setPhase("creating");
    setError(null);
    try {
      const { checkout_url } = await createDemoOrder(PRODUCT.priceBRL);
      // Navigate the buyer to the Slippay checkout. Same-tab so the demo
      // reads as a single continuous purchase flow.
      window.location.assign(checkout_url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "erro ao criar pedido");
      setPhase("error");
    }
  }

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain">
      <header className="border-b border-[#0a0a0a]/8">
        <div className="max-w-[1280px] mx-auto px-5 md:px-10 py-5 md:py-6 flex items-center justify-between">
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em]">
            <span className="w-2 h-2" style={{ background: KLEIN }} />
            Ateliê Norte
          </div>
          <nav className="flex items-center gap-6 text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/60">
            <span className="hidden md:inline">Catálogo</span>
            <span className="hidden md:inline">Sobre</span>
            <span>Carrinho · 1</span>
          </nav>
        </div>
      </header>

      <main className="max-w-[1280px] mx-auto px-5 md:px-10 py-10 md:py-20">
        <div className="grid grid-cols-12 gap-8 md:gap-12">
          {/* Product visual */}
          <div className="col-span-12 md:col-span-7">
            <div
              className="aspect-[4/5] w-full flex items-end p-8 md:p-12"
              style={{
                background:
                  "linear-gradient(135deg,#2b2622 0%,#3d352d 55%,#1c1916 100%)",
              }}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#f1eee7]/70">
                ┃ ref · LN-001 · feito sob encomenda
              </div>
            </div>
          </div>

          {/* Product detail + buy */}
          <div className="col-span-12 md:col-span-5 md:pt-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/55 mb-5">
              Ateliê Norte · mobiliário
            </div>
            <h1 className="text-4xl md:text-5xl font-medium leading-[0.98] tracking-[-0.03em]">
              {PRODUCT.name}
            </h1>
            <div className="mt-3 text-sm uppercase tracking-[0.16em] text-[#0a0a0a]/60">
              {PRODUCT.tagline}
            </div>

            <div className="mt-8 text-3xl font-medium tracking-[-0.02em]">
              {PRODUCT.priceLabel}
            </div>

            <p className="mt-6 text-base leading-relaxed text-[#0a0a0a]/75 max-w-[46ch]">
              {PRODUCT.blurb}
            </p>

            <button
              onClick={buy}
              disabled={phase === "creating"}
              className="mt-10 w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {phase === "creating" ? (
                "Gerando pedido…"
              ) : (
                <>
                  Pagar com
                  <span className="inline-flex items-center gap-1.5 font-mono lowercase tracking-normal">
                    <span className="w-1.5 h-1.5" style={{ background: KLEIN }} />
                    slippay
                  </span>
                </>
              )}
            </button>

            <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45 leading-relaxed">
              pix in · dollars out · cash anywhere<br />
              preço em BRL · liquidação em USDC na Stellar
            </div>

            {error && (
              <div className="mt-5 text-xs uppercase tracking-[0.16em] text-red-700 border-l-2 border-red-700 pl-3">
                {error}
              </div>
            )}

            <div className="mt-12 text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/40">
              <Link to="/" className="hover:opacity-60">powered by slippay ↗</Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
