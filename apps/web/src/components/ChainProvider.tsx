// Mounts chain-specific React context at the app root. Stellar (default) needs
// none — its wallet kit is imperative. Solana mounts the LazorKit provider +
// wallet binder, lazy-loaded so @lazorkit never enters the Stellar bundle.

import { type ReactNode, Suspense, lazy } from "react";
import { chainId } from "../lib/chain/validate.ts";

const SolanaWalletBridge = lazy(() =>
  import("./solana/SolanaWalletBridge.tsx").then((m) => ({ default: m.SolanaWalletBridge })),
);

export function ChainProvider({ children }: { children: ReactNode }) {
  if (chainId() === "solana") {
    return (
      <Suspense fallback={null}>
        <SolanaWalletBridge>{children}</SolanaWalletBridge>
      </Suspense>
    );
  }
  return <>{children}</>;
}
