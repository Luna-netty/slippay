// SEP-10 + SEP-24 client for Stellar anchors.
// Supports both TESTNET (defaulting to testanchor.stellar.org) and PUBLIC networks.
// Network selection is driven by VITE_STELLAR_NETWORK ("TESTNET" | "PUBLIC").
//
// Flow:
//   1. SEP-10 web auth (GET challenge, sign, POST, receive JWT)
//   2. SEP-24 deposit interactive (POST, open popup, poll transaction)
//   3. Surface USDC arrival on the buyer wallet via Horizon
//
// Configuration:
//   - Network: VITE_STELLAR_NETWORK ("TESTNET" | "PUBLIC", defaults to "TESTNET").
//     Derives both the network passphrase and Horizon URL together.
//   - Anchor home: VITE_ANCHOR_HOME (defaults to "https://testanchor.stellar.org" on TESTNET).
//     On PUBLIC network, VITE_ANCHOR_HOME must be explicitly set to a production anchor
//     and cannot point to testanchor.stellar.org.
//   - Asset: VITE_ANCHOR_ASSET_CODE (defaults to "SRT" on TESTNET), VITE_ANCHOR_ISSUER.

import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  Memo,
  Horizon,
} from "@stellar/stellar-sdk";

export type StellarNetwork = "TESTNET" | "PUBLIC";

export interface AnchorConfig {
  network: StellarNetwork;
  networkPassphrase: string;
  horizonUrl: string;
  anchorHome: string;
  authUrl: string;
  sep24Url: string;
}

const STELLAR_NETWORKS: Record<
  StellarNetwork,
  { passphrase: string; horizonUrl: string; defaultAnchorHome?: string }
> = {
  TESTNET: {
    passphrase: Networks.TESTNET,
    horizonUrl: "https://horizon-testnet.stellar.org",
    defaultAnchorHome: "https://testanchor.stellar.org",
  },
  PUBLIC: {
    passphrase: Networks.PUBLIC,
    horizonUrl: "https://horizon.stellar.org",
  },
};

export function resolveAnchorConfig(
  rawNetwork?: string,
  rawAnchorHome?: string,
): AnchorConfig {
  const normalizedNetwork = (rawNetwork ?? "TESTNET").toUpperCase();
  if (normalizedNetwork !== "TESTNET" && normalizedNetwork !== "PUBLIC") {
    throw new Error(
      `anchor.ts: unsupported network "${normalizedNetwork}". Supported networks are "TESTNET" and "PUBLIC".`,
    );
  }
  const network = normalizedNetwork as StellarNetwork;
  const netInfo = STELLAR_NETWORKS[network];
  const anchorHome = rawAnchorHome || netInfo.defaultAnchorHome;

  if (!anchorHome) {
    throw new Error(
      `anchor.ts: VITE_ANCHOR_HOME must be explicitly configured when VITE_STELLAR_NETWORK is "${network}".`,
    );
  }

  if (network === "PUBLIC" && anchorHome.includes("testanchor.stellar.org")) {
    throw new Error(
      `anchor.ts: testanchor.stellar.org cannot be used on network "${network}". ` +
        `Configure a production anchor URL via VITE_ANCHOR_HOME.`,
    );
  }

  return {
    network,
    networkPassphrase: netInfo.passphrase,
    horizonUrl: netInfo.horizonUrl,
    anchorHome,
    authUrl: `${anchorHome}/auth`,
    sep24Url: `${anchorHome}/sep24`,
  };
}

const env = import.meta.env as Record<string, string | undefined>;
export const ANCHOR_CONFIG: AnchorConfig = resolveAnchorConfig(
  env.VITE_STELLAR_NETWORK,
  env.VITE_ANCHOR_HOME,
);

export const STELLAR_NETWORK = ANCHOR_CONFIG.network;
export const ANCHOR_HOME = ANCHOR_CONFIG.anchorHome;
export const ANCHOR_AUTH = ANCHOR_CONFIG.authUrl;
export const ANCHOR_SEP24 = ANCHOR_CONFIG.sep24Url;
export const HORIZON_URL = ANCHOR_CONFIG.horizonUrl;
/** Kept for backwards compatibility with existing imports */
export const HORIZON_TESTNET = ANCHOR_CONFIG.horizonUrl;
export const NETWORK_PASSPHRASE = ANCHOR_CONFIG.networkPassphrase;

// Default to SRT (testanchor's always-liquid reference token); the testanchor
// USDC pool drains periodically. Override to USDC for MoneyGram via env.
export const ANCHOR_SRT_ISSUER =
  "GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B";
export const ANCHOR_ASSET_CODE = env.VITE_ANCHOR_ASSET_CODE ?? "SRT";
export const ANCHOR_ASSET_ISSUER = env.VITE_ANCHOR_ISSUER ?? ANCHOR_SRT_ISSUER;
export const ANCHOR_ASSET = new Asset(ANCHOR_ASSET_CODE, ANCHOR_ASSET_ISSUER);

export interface BuyerWallet {
  publicKey: string;
  secretKey: string;
}

const STORAGE_KEY = "slippay.anchor.buyer.v1";

// SECURITY (audit L3): this module persists a Stellar SECRET key to localStorage
// in cleartext. That is acceptable ONLY for throwaway TESTNET demo wallets. Real
// funds (PUBLIC network) MUST use a passkey / external wallet (Freighter et al.
// via src/lib/wallet.ts) and never touch localStorage. We assert the app is on
// testnet before writing.
function assertTestnetForLocalSecret(): void {
  if (STELLAR_NETWORK !== "TESTNET") {
    throw new Error(
      "anchor.ts: refusing to persist a Stellar secret to localStorage on " +
        `network "${STELLAR_NETWORK}". Real funds must use a passkey / external wallet, ` +
        "not localStorage-stored secrets.",
    );
  }
}

export function getOrCreateBuyer(): BuyerWallet {
  const cached = localStorage.getItem(STORAGE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as BuyerWallet;
      if (parsed.publicKey && parsed.secretKey) return parsed;
    } catch { /* fall through */ }
  }
  // Fail closed: never mint + store a fresh secret outside testnet.
  assertTestnetForLocalSecret();
  const kp = Keypair.random();
  const wallet: BuyerWallet = { publicKey: kp.publicKey(), secretKey: kp.secret() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
  return wallet;
}

export function resetBuyer(): BuyerWallet {
  localStorage.removeItem(STORAGE_KEY);
  return getOrCreateBuyer();
}

/** Fund a testnet account via friendbot. Idempotent — succeeds if already funded. */
export async function fundIfNeeded(publicKey: string): Promise<"funded" | "already"> {
  const horizon = new Horizon.Server(HORIZON_URL);
  try {
    await horizon.loadAccount(publicKey);
    return "already";
  } catch {
    if (STELLAR_NETWORK !== "TESTNET") {
      throw new Error(
        `anchor.ts: cannot fund account on network "${STELLAR_NETWORK}". Friendbot is only available on TESTNET.`,
      );
    }
    const res = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
    if (!res.ok) throw new Error(`friendbot failed: ${res.status}`);
    return "funded";
  }
}

/** Add the anchor's asset trustline so the anchor can pay this wallet. */
export async function ensureUsdcTrustline(buyer: BuyerWallet): Promise<"added" | "exists"> {
  const horizon = new Horizon.Server(HORIZON_URL);
  const account = await horizon.loadAccount(buyer.publicKey);
  const has = account.balances.some((b: any) =>
    b.asset_code === ANCHOR_ASSET_CODE && b.asset_issuer === ANCHOR_ASSET_ISSUER,
  );
  if (has) return "exists";

  const tx = new TransactionBuilder(account, {
    fee: "1000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: ANCHOR_ASSET }))
    .setTimeout(60)
    .build();
  tx.sign(Keypair.fromSecret(buyer.secretKey));
  await horizon.submitTransaction(tx);
  return "added";
}

/** SEP-10 web auth: returns a JWT bound to the buyer account. */
export async function sep10Authenticate(buyer: BuyerWallet): Promise<string> {
  // 1. GET challenge
  const challengeRes = await fetch(`${ANCHOR_AUTH}?account=${buyer.publicKey}`);
  if (!challengeRes.ok) throw new Error(`SEP-10 challenge failed: ${challengeRes.status}`);
  const { transaction, network_passphrase } = await challengeRes.json();
  if (network_passphrase !== NETWORK_PASSPHRASE) {
    throw new Error(
      `anchor.ts: network mismatch — anchor challenge declares network passphrase "${network_passphrase}", ` +
        `but app network "${STELLAR_NETWORK}" requires "${NETWORK_PASSPHRASE}"`,
    );
  }
  // 2. Sign challenge with buyer key
  const tx = TransactionBuilder.fromXDR(transaction, NETWORK_PASSPHRASE);
  tx.sign(Keypair.fromSecret(buyer.secretKey));
  const signedXDR = tx.toEnvelope().toXDR("base64");
  // 3. POST signed
  const tokenRes = await fetch(ANCHOR_AUTH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transaction: signedXDR }),
  });
  if (!tokenRes.ok) throw new Error(`SEP-10 token failed: ${tokenRes.status}`);
  const { token } = await tokenRes.json();
  if (!token) throw new Error("no token returned");
  return token;
}

export interface DepositInteractive {
  url: string;
  id: string;
}

/** SEP-24 deposit/interactive: returns the popup URL + transaction id. */
export async function sep24DepositInteractive(
  jwt: string,
  buyer: BuyerWallet,
): Promise<DepositInteractive> {
  const form = new FormData();
  form.append("asset_code", ANCHOR_ASSET_CODE);
  form.append("account", buyer.publicKey);
  const res = await fetch(`${ANCHOR_SEP24}/transactions/deposit/interactive`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SEP-24 deposit failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  if (!data.url || !data.id) throw new Error("missing url/id in deposit response");
  return { url: data.url, id: data.id };
}

export interface AnchorTx {
  id: string;
  status: string;
  status_eta?: number;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  started_at?: string;
  completed_at?: string;
  message?: string;
  // Withdraw-only: populated once status reaches pending_user_transfer_start.
  // The wallet must send `amount_in` of the asset TO this account with this memo.
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  withdraw_memo_type?: "text" | "id" | "hash";
}

/** SEP-24 withdraw/interactive: returns the popup URL + transaction id.
 *
 * Off-ramp (USDC → cash). Mirror of sep24DepositInteractive but on the
 * withdraw endpoint. After the user completes the popup, poll
 * getAnchorTransaction until status === "pending_user_transfer_start", then
 * call sendWithdrawalPayment to push the USDC to the anchor. This is the leg
 * MoneyGram Access uses for physical cash-out (docs/integrations/moneygram.md).
 */
export async function sep24WithdrawInteractive(
  jwt: string,
  buyer: BuyerWallet,
  amount?: string,
): Promise<DepositInteractive> {
  const form = new FormData();
  form.append("asset_code", ANCHOR_ASSET_CODE);
  form.append("account", buyer.publicKey);
  if (amount) form.append("amount", amount);
  const res = await fetch(`${ANCHOR_SEP24}/transactions/withdraw/interactive`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SEP-24 withdraw failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  if (!data.url || !data.id) throw new Error("missing url/id in withdraw response");
  return { url: data.url, id: data.id };
}

/** Build the SEP-24 memo from the anchor's declared memo + memo_type. */
function withdrawMemo(tx: AnchorTx): Memo {
  if (!tx.withdraw_memo) return Memo.none();
  switch (tx.withdraw_memo_type) {
    case "id":
      return Memo.id(tx.withdraw_memo);
    case "hash":
      // SEP-24 hash memos are base64-encoded over the wire.
      return Memo.hash(Buffer.from(tx.withdraw_memo, "base64"));
    case "text":
    default:
      return Memo.text(tx.withdraw_memo);
  }
}

/** Send the withdrawal payment: USDC FROM the buyer TO the anchor's account.
 *
 * Call only when tx.status === "pending_user_transfer_start" and the anchor has
 * populated withdraw_anchor_account/withdraw_memo. The amount sent is the
 * anchor's amount_in (what the user agreed to withdraw, fees handled anchor-side).
 * Returns the Stellar transaction hash. The anchor matches the payment by memo
 * and dispenses cash; status then advances to completed.
 */
export async function sendWithdrawalPayment(
  buyer: BuyerWallet,
  tx: AnchorTx,
): Promise<string> {
  if (!tx.withdraw_anchor_account) {
    throw new Error("withdraw_anchor_account missing — anchor not at transfer_start");
  }
  if (!tx.amount_in) throw new Error("amount_in missing on withdraw tx");

  const horizon = new Horizon.Server(HORIZON_URL);
  const account = await horizon.loadAccount(buyer.publicKey);
  const payment = new TransactionBuilder(account, {
    fee: "1000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.payment({
      destination: tx.withdraw_anchor_account,
      asset: ANCHOR_ASSET,
      amount: tx.amount_in,
    }))
    .addMemo(withdrawMemo(tx))
    .setTimeout(60)
    .build();
  payment.sign(Keypair.fromSecret(buyer.secretKey));
  const result = await horizon.submitTransaction(payment);
  return result.hash;
}

export async function getAnchorTransaction(jwt: string, id: string): Promise<AnchorTx> {
  const res = await fetch(`${ANCHOR_SEP24}/transaction?id=${id}`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`get transaction failed: ${res.status}`);
  const data = await res.json();
  return data.transaction as AnchorTx;
}

export interface BuyerBalance {
  asset_code: string;
  asset_issuer?: string;
  balance: string;
}

export async function getBuyerBalances(publicKey: string): Promise<BuyerBalance[]> {
  const horizon = new Horizon.Server(HORIZON_URL);
  try {
    const account = await horizon.loadAccount(publicKey);
    return account.balances.map((b: any) => ({
      asset_code: b.asset_code ?? "XLM",
      asset_issuer: b.asset_issuer,
      balance: b.balance,
    }));
  } catch {
    return [];
  }
}
