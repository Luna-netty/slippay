// Base EVM USDC transfer security gate — mirrors solanaAuthorize.ts for the Solana path.
//
// Gate order (NON-NEGOTIABLE):
//   1. build   — buildUsdcTransfer (construct calldata locally with viem encodeFunctionData)
//   2. decode  — decodeUsdcTransfer (extract to+amount from BUILT calldata — validate selector)
//   3. assert  — assertTransferMatches (machine check: decoded vs caller's expected)
//   4. confirm — human confirmation callback (user sees decoded details)
//   5. send    — sendTransaction (Privy embedded wallet) — ONLY after confirm=true
//   6. return  — { hash }
//
// Sending before human confirms is a violation of this contract.

import { encodeFunctionData, decodeFunctionData } from "viem";
import { USDC_ADDRESS, toBaseUnits, fromBaseUnits, USDC_DECIMALS } from "./chain/base/usdc.ts";

// ERC-20 ABI — only the transfer function needed here.
const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface BuiltTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value: 0n;
}

/**
 * Encodes an ERC-20 transfer(address,uint256) calldata for USDC on Base.
 * Uses viem encodeFunctionData — no network call.
 */
export function buildUsdcTransfer(
  to: `0x${string}`,
  usdcAmount: string,
): BuiltTx {
  const amount = toBaseUnits(usdcAmount); // strict gate inside toBaseUnits
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [to, amount],
  });
  return { to: USDC_ADDRESS, data, value: 0n };
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

export interface DecodedTransfer {
  to: string;
  amount: string;
}

/**
 * Decodes an ERC-20 transfer calldata built by buildUsdcTransfer.
 * Returns human-readable { to, amount }.
 *
 * Validates that the function selector is `transfer(address,uint256)`.
 * Throws if selector is absent, wrong, or data is malformed.
 */
export function decodeUsdcTransfer(tx: { data: `0x${string}` }): DecodedTransfer {
  let decoded: { functionName: string; args: readonly unknown[] };
  try {
    decoded = decodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      data: tx.data,
    });
  } catch (err) {
    throw new Error(
      `baseAuthorize: failed to decode calldata — not a valid ERC-20 transfer: ${String(err)}`,
    );
  }

  if (decoded.functionName !== "transfer") {
    throw new Error(
      `baseAuthorize: unexpected function selector (not transfer): "${decoded.functionName}"`,
    );
  }

  const [toAddr, rawAmount] = decoded.args as [`0x${string}`, bigint];
  return {
    to: toAddr,
    amount: fromBaseUnits(rawAmount),
  };
}

// ---------------------------------------------------------------------------
// Assert
// ---------------------------------------------------------------------------

/**
 * Machine guard: asserts decoded transfer matches what the caller expected.
 * Throws with a diagnostic message on any mismatch — never silently continues.
 *
 * Recipient: case-insensitive 0x comparison.
 * Amount tolerance: 1e-6 USDC (the minimum representable unit at 6 dp).
 */
export function assertTransferMatches(
  decoded: DecodedTransfer,
  expect: { to: string; amount: string },
): void {
  if (decoded.to.toLowerCase() !== expect.to.toLowerCase()) {
    throw new Error(
      `baseAuthorize: destinatário divergente (assinaria ${decoded.to}, esperado ${expect.to})`,
    );
  }
  const got = Number(decoded.amount);
  const want = Number(expect.amount);
  if (!Number.isFinite(got) || !Number.isFinite(want)) {
    throw new Error("baseAuthorize: valor não numérico");
  }
  const tolerance = 1 / 10 ** USDC_DECIMALS; // 1e-6
  if (Math.abs(got - want) > tolerance) {
    throw new Error(
      `baseAuthorize: valor divergente (assinaria ${decoded.amount}, esperado ${expect.amount})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Full gate: build → decode → assert → human-confirm → send
// ---------------------------------------------------------------------------

export interface AuthorizeBasePaymentArgs {
  to: `0x${string}`;
  amount: string;
  sendTransaction: (tx: BuiltTx) => Promise<{ hash: `0x${string}` }>;
  /**
   * Human confirmation callback.
   * Returns true = proceed, false = cancel.
   */
  confirm: (decoded: DecodedTransfer) => Promise<boolean>;
}

export interface AuthorizeBasePaymentResult {
  hash: `0x${string}`;
}

/**
 * Authorizes and executes a USDC transfer on Base.
 *
 * Gate order enforcement:
 *   1. build  → buildUsdcTransfer
 *   2. decode → decodeUsdcTransfer  (validates function selector)
 *   3. assert → assertTransferMatches
 *   4. human confirm → confirm(decoded) ← if false, throw "cancelado"
 *   5. send   → sendTransaction (only reached if confirmed)
 *   6. return → { hash }
 */
export async function authorizeBasePayment(
  args: AuthorizeBasePaymentArgs,
): Promise<AuthorizeBasePaymentResult> {
  const { to, amount, sendTransaction, confirm } = args;

  // 1. Build
  const tx = buildUsdcTransfer(to, amount);

  // 2. Decode (includes selector validation)
  const decoded = decodeUsdcTransfer(tx);

  // 3. Assert (machine check before human ever sees it)
  assertTransferMatches(decoded, { to, amount });

  // 4. Human confirm — MUST happen before send.
  const approved = await confirm(decoded);
  if (!approved) {
    throw new Error("cancelado");
  }

  // 5. Send — only reached if human confirmed.
  const { hash } = await sendTransaction(tx);

  // 6. Return
  return { hash };
}
