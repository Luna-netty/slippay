import { useState, Suspense, lazy } from "react";
import { getChainAdapter } from "../lib/chain/index.ts";
import { chainId } from "../lib/chain/validate.ts";

// Solana connect uses LazorKit's hook (must run inside its provider) — lazy so
// @lazorkit stays out of the default Stellar bundle.
const SolanaPayButton = lazy(() => import("./solana/SolanaPayButton.tsx"));

export function PayButton({ onConnected }: { onConnected: (addr: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (chainId() === "solana") {
    return (
      <Suspense fallback={<button disabled className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] opacity-50">Carregando…</button>}>
        <SolanaPayButton onConnected={onConnected} />
      </Suspense>
    );
  }

  return (
    <div>
      <button
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            const addr = await (await getChainAdapter()).connectWallet();
            onConnected(addr);
          } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "wallet error");
          } finally {
            setLoading(false);
          }
        }}
        className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-50"
      >
        {loading ? "Connecting..." : "Connect wallet"}
      </button>
      {error && <div className="mt-3 text-xs uppercase tracking-[0.18em] text-red-700 border-l-2 border-red-700 pl-3">{error}</div>}
    </div>
  );
}
