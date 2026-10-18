// Solana connect button — biometric (passkey) wallet connect via LazorKit.
// Rendered by PayButton only when VITE_CHAIN=solana (lazy). On connect, reports
// the smart-wallet address up; the SolanaWalletBridge binder wires execution.

import { useState } from "react";
import { useWallet } from "@lazorkit/wallet";

export default function SolanaPayButton({ onConnected }: { onConnected: (addr: string) => void }) {
  const w = useWallet();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        disabled={w.isConnecting}
        onClick={async () => {
          setError(null);
          try {
            const info = await w.connect();
            // Full smart-wallet address, copyable from the browser console.
            console.log("[slippay] smart wallet:", info.smartWallet);
            onConnected(info.smartWallet);
          } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "wallet error");
          }
        }}
        className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-50"
      >
        {w.isConnecting ? "Conectando…" : "Conectar com Face ID"}
      </button>
      {error && <div className="mt-3 text-xs uppercase tracking-[0.18em] text-red-700 border-l-2 border-red-700 pl-3">{error}</div>}
    </div>
  );
}
