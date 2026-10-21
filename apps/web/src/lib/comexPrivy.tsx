// VERIFY-WITH-KEYS: Privy API calls used (from @privy-io/react-auth@3.32.2 installed types):
//
// Wallet creation (extended-chains):
//   const { createWallet } = useCreateWallet();
//   const { wallet } = await createWallet({ chainType: 'stellar' });
//   // wallet.address → G... (Stellar Ed25519 public key / account ID)
//
// Wallet lookup from user:
//   user.linkedAccounts.find((a) => a.type === 'wallet' && a.chainType === 'stellar')
//   // returns WalletWithMetadata | undefined; .address is the G... address
//
// Sign raw hash (extended-chains):
//   const { signRawHash } = useSignRawHash();
//   const { signature } = await signRawHash({ address, chainType: 'stellar', hash: `0x${hexHash}` });
//   // signature: `0x${string}` — 64-byte Ed25519 signature (r+s)

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import {
  PrivyProvider,
  usePrivy,
  type PrivyClientConfig,
} from "@privy-io/react-auth";
import {
  useCreateWallet,
  useSignRawHash,
} from "@privy-io/react-auth/extended-chains";

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

const PRIVY_CONFIG: PrivyClientConfig = {
  loginMethods: ["email"],
  // Stellar is an extended chain — not listed under embeddedWallets.
  // We create the Stellar wallet imperatively after login via useCreateWallet.
  embeddedWallets: {
    ethereum: { createOnLogin: "off" },
  },
  mfa: {
    noPromptOnMfaRequired: false,
  },
};

export function ComexPrivyProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID ?? ""}
      config={PRIVY_CONFIG}
    >
      <ComexWalletProviderInner>{children}</ComexWalletProviderInner>
    </PrivyProvider>
  );
}

// ---------------------------------------------------------------------------
// Wallet context
// ---------------------------------------------------------------------------

interface ComexWalletCtx {
  ready: boolean;
  authenticated: boolean;
  email: string | null;
  /** Stellar account ID (G... address) of the user's Privy-managed Ed25519 wallet. */
  address: string | null;
  walletId: string | null;
  login: () => void;
  logout: () => Promise<void>;
  /**
   * Signs a raw 32-byte hash using the Stellar Ed25519 embedded wallet via
   * useSignRawHash from @privy-io/react-auth/extended-chains.
   * Returns a 64-byte Buffer (Ed25519 r+s signature, no EIP-191 prefix).
   */
  signHash: (hash: Buffer) => Promise<Buffer>;
}

const ComexWalletContext = createContext<ComexWalletCtx>({
  ready: false,
  authenticated: false,
  email: null,
  address: null,
  walletId: null,
  login: () => {},
  logout: async () => {},
  signHash: async () => Buffer.alloc(0),
});

// ---------------------------------------------------------------------------
// Inner provider — lives inside PrivyProvider tree
// ---------------------------------------------------------------------------

function ComexWalletProviderInner({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();

  // Track whether we have already attempted wallet creation this session
  // to avoid duplicate calls during re-renders.
  const creatingRef = useRef(false);

  // Resolve email from linked accounts
  const emailAccount = user?.linkedAccounts?.find((a) => a.type === "email") as
    | { type: "email"; address: string }
    | undefined;
  const email = emailAccount?.address ?? null;

  // Find existing Stellar wallet from linked accounts
  const stellarAccount = user?.linkedAccounts?.find(
    (a) => a.type === "wallet" && (a as { chainType?: string }).chainType === "stellar",
  ) as { type: "wallet"; chainType: string; address: string; id?: string | null } | undefined;

  const address: string | null = stellarAccount?.address ?? null;
  const walletId: string | null = stellarAccount?.id ?? null;

  // Auto-create Stellar wallet on first login if absent
  useEffect(() => {
    if (!authenticated || !ready || address || creatingRef.current) return;
    creatingRef.current = true;
    createWallet({ chainType: "stellar" })
      .catch((err: unknown) => {
        // Non-fatal: user can retry; log for debugging
        console.error("comexPrivy: failed to create Stellar wallet", err);
      })
      .finally(() => {
        creatingRef.current = false;
      });
  }, [authenticated, ready, address, createWallet]);

  const signHash = useCallback(
    async (hash: Buffer): Promise<Buffer> => {
      if (!address) throw new Error("comexPrivy: Stellar wallet not available");
      const hexHash = hash.toString("hex");
      const { signature } = await signRawHash({
        address,
        chainType: "stellar",
        hash: `0x${hexHash}`,
      });
      // signature is 0x-prefixed 64-byte hex Ed25519 (r+s)
      return Buffer.from(signature.replace(/^0x/, ""), "hex");
    },
    [address, signRawHash],
  );

  return (
    <ComexWalletContext.Provider
      value={{ ready, authenticated, email, address, walletId, login, logout, signHash }}
    >
      {children}
    </ComexWalletContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

export function useComexWallet(): ComexWalletCtx {
  return useContext(ComexWalletContext);
}
