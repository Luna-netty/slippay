// VERIFY-WITH-KEYS: Privy Solana API used (from @privy-io/react-auth@3.32.2 installed types):
//
// Wallet creation:
//   const { createWallet } = useCreateWallet(); // from @privy-io/react-auth/solana
//   const { wallet } = await createWallet();    // no chainType arg (Solana-specific hook)
//   // wallet.address → base58 Solana pubkey
//
// Wallet lookup:
//   const { wallets } = useWallets();  // ConnectedStandardSolanaWallet[] (solana.d.ts line 156-166)
//   wallets[0].address → base58 pubkey
//
// Sign transaction (without sending):
//   const { signTransaction } = useSignTransaction(); // from @privy-io/react-auth/solana (solana.d.ts line 266)
//   const { signedTransaction } = await signTransaction({ transaction: Uint8Array, wallet });
//   // signedTransaction: Uint8Array → deserialize with Transaction.from()
//
// PrivyClientConfig.embeddedWallets.solana.createOnLogin (types-sr2FRXdy.d.ts line 1805-1823):
//   'all-users' | 'users-without-wallets' | 'off'
//   comex uses 'all-users': every corporate login gets a Solana wallet automatically.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  PrivyProvider,
  usePrivy,
  type PrivyClientConfig,
} from "@privy-io/react-auth";
import {
  useCreateWallet,
  useSignTransaction,
  useWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { Transaction } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Provider config — corporate: email + MFA only, NO biometric.
// LazorKit is the biometric/passkey path for the consumer product; comex B2B
// treasury uses Privy embedded wallet with email auth + MFA enforcement.
// ---------------------------------------------------------------------------

const PRIVY_CONFIG: PrivyClientConfig = {
  loginMethods: ["email"],
  embeddedWallets: {
    // VERIFY-WITH-KEYS: solana.createOnLogin confirmed from types-sr2FRXdy.d.ts line 1805-1823.
    solana: { createOnLogin: "all-users" },
    ethereum: { createOnLogin: "off" },
  },
  mfa: {
    // Show MFA prompt automatically — do not suppress. Corporate requirement.
    noPromptOnMfaRequired: false,
  },
};

export function ComexSolanaProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID ?? ""}
      config={PRIVY_CONFIG}
    >
      <ComexSolanaProviderInner>{children}</ComexSolanaProviderInner>
    </PrivyProvider>
  );
}

// ---------------------------------------------------------------------------
// Wallet context
// ---------------------------------------------------------------------------

interface ComexSolanaCtx {
  ready: boolean;
  authenticated: boolean;
  email: string | null;
  /** Base58 Solana pubkey of the Privy embedded wallet. Null before wallet is created. */
  address: string | null;
  login: () => void;
  logout: () => Promise<void>;
  /**
   * Sign a @solana/web3.js Transaction (legacy) using the Privy Solana embedded wallet.
   * Does NOT submit to the network — the security gate (authorizeSolanaPayment) calls
   * this ONLY after build→decode→assert→human-confirm have all passed.
   *
   * VERIFY-WITH-KEYS: signTransaction from @privy-io/react-auth/solana (solana.d.ts line 260-261).
   * Accepts: { transaction: Uint8Array, wallet: ConnectedStandardSolanaWallet }
   * Returns: { signedTransaction: Uint8Array } — caller deserializes with Transaction.from().
   */
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

const ComexSolanaContext = createContext<ComexSolanaCtx>({
  ready: false,
  authenticated: false,
  email: null,
  address: null,
  login: () => {},
  logout: async () => {},
  signTransaction: async () => {
    throw new Error("comexSolana: wallet not ready");
  },
});

// ---------------------------------------------------------------------------
// Inner provider — lives inside PrivyProvider tree
// ---------------------------------------------------------------------------

function ComexSolanaProviderInner({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signTransaction: privySignTx } = useSignTransaction();
  // VERIFY-WITH-KEYS: useWallets from @privy-io/react-auth/solana (solana.d.ts line 156-166).
  // Returns ConnectedStandardSolanaWallet[] — Privy embedded wallets only.
  const { wallets } = useWallets();

  const creatingRef = useRef(false);

  // Resolve email from linked accounts
  const emailAccount = user?.linkedAccounts?.find((a) => a.type === "email") as
    | { type: "email"; address: string }
    | undefined;
  const email = emailAccount?.address ?? null;

  // [M-3] Defensively pick the embedded Solana wallet. With createOnLogin='all-users'
  // there should always be one after auth, but guard against empty array.
  // wallets[0] is fine when the array is non-empty; the guard is against an empty array
  // and ensures we never throw on undefined before address is accessible.
  const solanaWallet: ConnectedStandardSolanaWallet | undefined =
    wallets.length > 0 ? wallets[0] : undefined;
  const address: string | null = solanaWallet?.address ?? null;

  // Auto-create Solana wallet on first login if absent
  useEffect(() => {
    if (!authenticated || !ready || address || creatingRef.current) return;
    creatingRef.current = true;
    createWallet()
      .catch((err: unknown) => {
        console.error("comexSolana: failed to create Solana wallet", err);
      })
      .finally(() => {
        creatingRef.current = false;
      });
  }, [authenticated, ready, address, createWallet]);

  const signTransaction = useCallback(
    async (tx: Transaction): Promise<Transaction> => {
      if (!solanaWallet) {
        throw new Error("comexSolana: Solana wallet not available — authenticate first");
      }
      // Serialize without requiring all signatures (pre-sign state).
      const serialized = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      // VERIFY-WITH-KEYS: privySignTx signature (solana.d.ts line 260):
      // signTransaction({ transaction: Uint8Array, wallet: ConnectedStandardSolanaWallet })
      // → Promise<{ signedTransaction: Uint8Array }>
      const { signedTransaction } = await privySignTx({
        transaction: serialized,
        wallet: solanaWallet,
      });
      return Transaction.from(signedTransaction);
    },
    [solanaWallet, privySignTx],
  );

  return (
    <ComexSolanaContext.Provider
      value={{ ready, authenticated, email, address, login, logout, signTransaction }}
    >
      {children}
    </ComexSolanaContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

export function useComexSolanaWallet(): ComexSolanaCtx {
  return useContext(ComexSolanaContext);
}
