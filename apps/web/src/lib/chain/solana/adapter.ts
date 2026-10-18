// Solana adapter. Implements ChainAdapter against Solana + the slippay_mandate
// program (bounded-autonomy moat, proven 5/5 on 2026-06-17).
//
// - payOneTime    = a 2-transfer SPL split (merchant + platform fee), the Solana
//                   analogue of the Stellar 2-op atomic payment.
// - approveRecurring = the single SPL `approve` that delegates bounded spend to
//                   the mandate PDA (mirrors the Stellar SEP-41 allowance). The
//                   PDA is derived from owner+mint, not the passed spender.
//
// Signing is done by the bound biometric wallet (LazorKit passkey + paymaster):
// the adapter builds instructions and hands them to wallet.execute(), which
// signs with the passkey, sponsors gas, and submits. The wallet is bound by the
// React gate (components/SolanaWalletGate) on connect; until then the payment
// methods throw via boundSolanaWallet().

import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createApproveInstruction,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import type {
  ChainAdapter, AddressCheck, OneTimePayArgs, ApproveArgs, PayResult,
} from "../types.ts";
import { usdcMint, rpcUrl, toBaseUnits } from "./usdc.ts";
import { mandatePda, buildPaySplitIx, orderIdFromHex } from "./mandate.ts";
import { boundSolanaWallet } from "./wallet.ts";

export { bindSolanaWallet, type SolanaWallet } from "./wallet.ts";

function connection(): Connection { return new Connection(rpcUrl(), "confirmed"); }

// Parse a Solana address with a diagnostic error. Guards the #1 cross-chain
// trap: an order built for Stellar carries a G... merchant address, which is not
// a valid Solana pubkey — fail with a clear message instead of "Invalid public key".
function solPubkey(addr: string, label: string): PublicKey {
  try { return new PublicKey(addr.trim()); }
  catch { throw new Error(`${label} is not a valid Solana address ("${addr.slice(0, 12)}…") — Solana checkout needs a Solana merchant address (the order carries a Stellar one)`); }
}

export const solanaAdapter: ChainAdapter = {
  id: "solana",

  async connectWallet(): Promise<string> {
    // The connect UX is the React gate (LazorKit hook); here we just report the
    // already-connected address. Throws if nothing is bound yet.
    return boundSolanaWallet().address;
  },

  isValidAddress(addr: string): boolean {
    try { return PublicKey.isOnCurve(new PublicKey(addr.trim())); }
    catch { return false; }
  },

  async checkReceiveAddress(addr: string): Promise<AddressCheck> {
    const a = addr.trim();
    if (!this.isValidAddress(a)) return { validFormat: false, accountExists: null, hasUsdcTrustline: null };
    try {
      const conn = connection();
      const owner = new PublicKey(a);
      const wallet = await conn.getAccountInfo(owner);
      // Stellar "USDC trustline" ⇄ Solana "recipient has a USDC ATA". USDC can't
      // land without it; surface at input time (mirrors checkReceiveAddress).
      const ata = getAssociatedTokenAddressSync(usdcMint(), owner, true);
      const ataInfo = await conn.getAccountInfo(ata);
      return { validFormat: true, accountExists: wallet !== null, hasUsdcTrustline: ataInfo !== null };
    } catch {
      // Network/RPC error — never assert existence we couldn't verify.
      return { validFormat: true, accountExists: null, hasUsdcTrustline: null };
    }
  },

  async payOneTime(a: OneTimePayArgs): Promise<PayResult> {
    const wallet = boundSolanaWallet();
    const mint = usdcMint();
    const buyer = solPubkey(a.buyerAddress, "buyer");
    const merchant = solPubkey(a.merchantAddress, "merchant address");
    const platform = solPubkey(a.platformAddress, "platform address");

    // allowOwnerOffCurve=true: the buyer is a LazorKit smart wallet (a PDA, off
    // curve); merchant/platform may also be PDAs. Relaxing the assertion is safe —
    // the ATA derivation is identical for on-curve owners.
    const buyerAta = getAssociatedTokenAddressSync(mint, buyer, true);
    const merchantAta = getAssociatedTokenAddressSync(mint, merchant, true);
    const platformAta = getAssociatedTokenAddressSync(mint, platform, true);

    // ONE instruction (pay_split) — the program splits merchant vs fee on-chain.
    // Fits a single-CPI smart wallet (LazorKit). Merchant/platform ATAs must
    // pre-exist (guarded at onboarding via checkReceiveAddress).
    // order_id binds the payment to the order on-chain (emitted in SplitPaid) —
    // the Solana analogue of the Stellar Memo.hash, in the same single CPI.
    const ix = await buildPaySplitIx(connection(), {
      payer: buyer, mint, payerToken: buyerAta,
      merchantToken: merchantAta, platformToken: platformAta,
      amount: new BN(toBaseUnits(a.usdcAmount).toString()),
      feeBp: a.platformFeeBp,
      orderId: orderIdFromHex(a.memoHex),
    });

    const hash = await wallet.execute([ix]);
    return { hash };
  },

  async approveRecurring(a: ApproveArgs): Promise<PayResult> {
    const wallet = boundSolanaWallet();
    const mint = usdcMint();
    const owner = new PublicKey(a.buyerAddress);
    // off-curve: the owner is a LazorKit smart wallet PDA.
    const ownerAta = getAssociatedTokenAddressSync(mint, owner, true);

    // The single signature that delegates bounded spend: approve the mandate PDA
    // (derived from owner+mint) as the SPL delegate up to the cap. durationSecs is
    // ignored — an SPL delegate has no ledger ttl. Caps/allowlist are set
    // separately via SlippayMandate.initMandate at subscription setup.
    const spenderPda = mandatePda(owner, mint);
    const amount = toBaseUnits(a.capUsdc); // 6-dp base units

    const ix = createApproveInstruction(ownerAta, spenderPda, owner, amount);
    const hash = await wallet.execute([ix]);
    return { hash };
  },
};
