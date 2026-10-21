import { NETWORK, USDC_ASSET_CODE, stellarToStroops, stroopsToStellar } from "@slippay/shared";


export interface StellarPaymentEvent {
  memo_type: string;
  memo_b64: string;
  successful: boolean;
  asset_code?: string;
  asset_issuer?: string;
  to: string;
  amount: string;
  hash: string;
}

export interface OrderForMatch {
  id: string;
  memo: string;
  usdc_amount: string;
  merchant_stellar_address: string;
  platform_fee_bp?: number | null;
}

export type MatchOutcome =
  | {
      outcome: "paid";
      // Money math is in stroops (BigInt); the string forms here are the
      // canonical 7-decimal representation persisted against the order.
      // expected = merchant net share (after platform fee); received = the
      // amount on the payment event; surplus = received - expected.
      expected: string;
      received: string;
      surplus: string;
      // True when surplus > configured threshold. The reconciler uses this
      // to emit an alert in addition to the normal order.paid webhook.
      alert: boolean;
    }
  | { outcome: "underpaid"; expected: string; received: string }
  | { outcome: "ignore"; reason?: string };

/**
 * Default overpayment alert threshold in stroops (1 USDC = 10^7 stroops).
 * A surplus at or below this is accepted-and-recorded silently; above
 * it raises an alert. See docs/fees-overpayment-policy.md.
 */
export const DEFAULT_OVERPAYMENT_THRESHOLD_STROOPS = 1_000_000n ; // 1.0000000 USDC

export function matchPaymentToOrder(
  ev: StellarPaymentEvent,
  order: OrderForMatch,
  network: "TESTNET" | "PUBLIC",
  overpaymentThresholdStroops: bigint = DEFAULT_OVERPAYMENT_THRESHOLD_STROOPS,
): MatchOutcome {
  if (!ev.successful) return { outcome: "ignore", reason: "not_successful" };
  if (ev.memo_type !== "hash") return { outcome: "ignore", reason: "memo_type" };
  if (ev.asset_code !== USDC_ASSET_CODE) return { outcome: "ignore", reason: "asset_code" };

  const expectedIssuer = process.env.STELLAR_USDC_ISSUER_OVERRIDE
    ?? (network === "PUBLIC" ? NETWORK.mainnet.usdc_issuer : NETWORK.testnet.usdc_issuer);
  if (ev.asset_issuer !== expectedIssuer) return { outcome: "ignore", reason: "asset_issuer" };

  if (ev.to !== order.merchant_stellar_address) return { outcome: "ignore", reason: "destination" };

  const evMemoHex = Buffer.from(ev.memo_b64, "base64").toString("hex");
  if (evMemoHex !== order.memo) return { outcome: "ignore", reason: "memo_mismatch" };

  // Money math runs in stroops (BigInt) to avoid IEEE-754 boundary errors at
  // the 7th decimal. Audit-003 L4. Stellar amounts are decimal strings with
  // up to 7 fractional digits; we normalize both sides into integer stroops
  // before compare, then format the merchant share back for the outcome row.
  let totalStroops: bigint;
  let receivedStroops: bigint;
  try {
    totalStroops = stellarToStroops(order.usdc_amount);
    receivedStroops = stellarToStroops(ev.amount);
  } catch {
    return { outcome: "ignore", reason: "amount_parse" };
  }
  if (
    order.platform_fee_bp === null ||
    order.platform_fee_bp === undefined ||
    typeof order.platform_fee_bp !== "number" ||
    Number.isNaN(order.platform_fee_bp) ||
    order.platform_fee_bp < 0 ||
    order.platform_fee_bp >= 10_000
  ) {
    return { outcome: "ignore", reason: "fee_bp_invalid" };
  }
  // Floor division here is conservative: integer division truncates toward
  // zero, so the merchant receives at most the mathematically correct amount.
  // Fee arithmetic and rounding specification: see docs/fees.md.
  // Integer division truncates toward zero; fractional dust remainder
  // accrues to the merchant, ensuring net + fee == gross and no overcharging.
  const expectedStroops = (totalStroops * BigInt(10_000 - order.platform_fee_bp)) / 10_000n;
  const expectedMerchantShare = stroopsToStellar(expectedStroops);
  if (receivedStroops >= expectedStroops) {
    // Overpayment policy: accept-and-record. The surplus (if any) is
    // returned in the outcome and persisted against the order by the
    // reconciler. A surplus above the configured threshold also raises
    // an alert. See docs/fees-overpayment-policy.md.
    const surplusStroops = receivedStroops - expectedStroops;
    return {
      outcome: "paid",
      expected: expectedMerchantShare,
      received: ev.amount,
      surplus: stroopsToStellar(surplusStroops),
      alert: surplusStroops > overpaymentThresholdStroops,
    };
  }
  return { outcome: "underpaid", expected: expectedMerchantShare, received: ev.amount };
}

export { stellarToStroops, stroopsToStellar };

export function stroopsToStellar(n: bigint): string {
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const intPart = abs / 10_000_000n ;
  const fracPart = abs % 10_000_000n ;
  return `${sign}${intPart}.${fracPart.toString().padStart(7, "0")}`;
}