// Solana USDC transfer security gate — mirrors authorizeTx.ts for the Stellar path.
//
// Gate order (NON-NEGOTIABLE):
//   1. build   — buildUsdcTransfer (construct the tx locally, never from server)
//   2. decode  — decodeUsdcTransfer (extract to+amount from the BUILT tx)
//   3. assert  — assertTransferMatches (machine check: decoded vs caller's expected)
//   4. confirm — human confirmation callback (user sees decoded details + owner address)
//   5. sign    — signTransaction (Privy embedded wallet) — ONLY after confirm=true
//   6. send    — sendRawTransaction (capture sig first), then confirmTransaction
//   7. return  — { signature, confirmed }
//
// Signing before human confirms is a violation of this contract.

import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { usdcMint, toBaseUnits, USDC_DECIMALS } from "./chain/solana/usdc.ts";

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Builds an SPL USDC transferChecked transaction.
 * Uses getAssociatedTokenAddress (async, handles PDAs) to derive source/dest ATAs.
 * The transaction has no blockhash set — caller must set recentBlockhash before signing.
 */
export async function buildUsdcTransfer(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  usdcAmount: string,
): Promise<Transaction> {
  const mint = usdcMint();
  const amount = toBaseUnits(usdcAmount); // bigint, 6-dp base units

  // Derive ATAs. allowOwnerOffCurve=true: PDAs are valid ATA owners.
  const fromAta = await getAssociatedTokenAddress(mint, from, true);
  const toAta = await getAssociatedTokenAddress(mint, to, true);

  const ix = createTransferCheckedInstruction(
    fromAta,
    mint,
    toAta,
    from,
    amount,
    USDC_DECIMALS,
  );

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = from;
  tx.add(ix);
  return tx;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Decodes a Transaction built by buildUsdcTransfer and extracts to+amount.
 * Returns human-readable amount (USDC, NOT base units).
 *
 * Validates that the first instruction is TransferChecked (discriminant byte = 12).
 * Throws if the instruction is absent, malformed, or is not TransferChecked.
 */
export function decodeUsdcTransfer(tx: Transaction): { to: string; amount: string } {
  const ix = tx.instructions[0];
  if (!ix) throw new Error("solanaAuthorize: transaction has no instructions");

  // [M-1] Validate SPL opcode: first byte must be 12 (TransferChecked discriminant).
  const data = ix.data;
  if (data.length < 1 || data[0] !== 12) {
    throw new Error(
      `solanaAuthorize: instrução SPL inesperada (não é TransferChecked) — byte[0]=${data[0] ?? "undefined"}`,
    );
  }

  // TransferChecked layout (spl-token instruction index 12):
  // accounts: [source, mint, dest, authority, ...]
  // data: [instruction(1)] [amount(8 LE u64)] [decimals(1)]
  const accounts = ix.keys;
  if (accounts.length < 3) {
    throw new Error("solanaAuthorize: unexpected instruction account count");
  }

  // dest ATA is accounts[2]; we return the ATA address (not the owner).
  // The caller asserts this against the expected destination.
  const destAta = accounts[2]!.pubkey.toBase58();

  if (data.length < 10) {
    throw new Error("solanaAuthorize: instruction data too short to decode amount");
  }

  // Bytes 1-8 (LE u64) = amount in base units. Use DataView for correct LE read.
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lo = view.getUint32(1, true);
  const hi = view.getUint32(5, true);
  const baseUnits = BigInt(lo) + (BigInt(hi) << 32n);

  // Convert to human-readable with 6 decimals.
  const whole = baseUnits / 1_000_000n;
  const frac = baseUnits % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  const amount = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;

  return { to: destAta, amount };
}

// ---------------------------------------------------------------------------
// Assert
// ---------------------------------------------------------------------------

/**
 * Machine guard: asserts decoded transfer matches what the caller expected.
 * Throws with a diagnostic message on any mismatch — never silently continues.
 *
 * Amount tolerance: 1e-6 USDC (the minimum representable unit at 6 dp).
 * Any larger drift = sign refusal.
 */
export function assertTransferMatches(
  decoded: { to: string; amount: string },
  expect: { to: string; amount: string },
): void {
  if (decoded.to.trim() !== expect.to.trim()) {
    throw new Error(
      `solanaAuthorize: destino divergente (assinaria ${decoded.to}, esperado ${expect.to})`,
    );
  }
  const got = Number(decoded.amount);
  const want = Number(expect.amount);
  if (!Number.isFinite(got) || !Number.isFinite(want)) {
    throw new Error("solanaAuthorize: valor não numérico");
  }
  if (Math.abs(got - want) > 1e-6) {
    throw new Error(
      `solanaAuthorize: valor divergente (assinaria ${decoded.amount}, esperado ${expect.amount})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Full gate: build → decode → assert → human-confirm → sign → send
// ---------------------------------------------------------------------------

export interface AuthorizeSolanaPaymentArgs {
  connection: Connection;
  from: PublicKey;
  /** Owner address (base58) — shown to the human in the confirm modal. */
  to: PublicKey;
  usdcAmount: string;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  /**
   * Human confirmation callback.
   * Receives decoded ATA + amount (for machine display) AND the original owner address
   * so the modal can show "Para: <owner base58>" that the human recognizes.
   */
  confirm: (decoded: { to: string; amount: string; ownerAddress: string }) => Promise<boolean>;
}

/**
 * Result of authorizeSolanaPayment.
 * signature is always present once broadcast (even if confirmation times out).
 * confirmed=false means: tx was sent but on-chain confirmation did not arrive —
 * the caller MUST show the solscan link and a "enviado, confirmando…" state.
 */
export interface AuthorizeSolanaPaymentResult {
  signature: string;
  confirmed: boolean;
}

/**
 * Authorizes and executes a USDC transfer on Solana.
 *
 * Gate order enforcement:
 *   1. build  → buildUsdcTransfer
 *   2. decode → decodeUsdcTransfer  (also validates TransferChecked opcode — M-1)
 *   3. assert → assertTransferMatches
 *   4. human confirm → confirm(decoded + ownerAddress)   ← if false, throw (never reach sign)
 *   5. sign   → signTransaction
 *   6. send   → sendRawTransaction (sig captured FIRST — I-1)
 *   7. confirm → confirmTransaction in separate try (timeout does NOT lose sig)
 *   8. return → { signature, confirmed }
 */
export async function authorizeSolanaPayment(
  args: AuthorizeSolanaPaymentArgs,
): Promise<AuthorizeSolanaPaymentResult> {
  const { connection, from, to, usdcAmount, signTransaction, confirm } = args;

  // 1. Build
  const tx = await buildUsdcTransfer(connection, from, to, usdcAmount);

  // 2. Decode (includes TransferChecked opcode validation per M-1)
  const decoded = decodeUsdcTransfer(tx);

  // 3. Assert (machine check before human ever sees it — catches server-side manipulation)
  const toAta = (await getAssociatedTokenAddress(usdcMint(), to, true)).toBase58();
  assertTransferMatches(decoded, { to: toAta, amount: usdcAmount });

  // 4. Human confirm — MUST happen before sign.
  // Pass ownerAddress (base58) so the modal shows the recognizable address, not the ATA.
  const ownerAddress = to.toBase58();
  const approved = await confirm({ ...decoded, ownerAddress });
  if (!approved) {
    throw new Error("cancelado pelo usuário");
  }

  // 5. Sign — only reached if human confirmed
  const signed = await signTransaction(tx);

  // 6. Send raw — capture signature BEFORE awaiting confirmation (I-1).
  // If confirmTransaction times out, the sig is still returned so the caller
  // can show the solscan link and "enviado, confirmando…" state.
  const raw = signed.serialize();
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  // 7. Confirm on-chain in a separate try — timeout does NOT lose the sig.
  let confirmed = false;
  try {
    await connection.confirmTransaction(signature, "confirmed");
    confirmed = true;
  } catch {
    // Confirmation timed out or network error — tx may still land.
    // Caller receives confirmed=false + signature to surface recovery UI.
  }

  // 8. Return
  return { signature, confirmed };
}
