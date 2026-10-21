import { isAddress, getAddress, formatUnits } from "viem";

export interface ParsedPaymentQr {
  to: string; // checksummed 0x recipient
  amount?: string; // human USDC amount, if the QR encoded one
}

// Parse a scanned QR into a Base USDC payment target. Accepts:
//   - a bare EVM address:            "0xabc...def"
//   - EIP-681 plain:                 "ethereum:0xRECIP" (optionally "@8453")
//   - EIP-681 ERC-20 transfer:       "ethereum:0xTOKEN@8453/transfer?address=0xRECIP&uint256=1000000"
// Returns null when no valid recipient address can be extracted. The amount is
// advisory only — the WYSIWYS gate still shows the user the real destination and
// amount before any signature, so a hostile QR cannot make them sign blind.
export function parsePaymentQr(raw: string, usdcDecimals = 6): ParsedPaymentQr | null {
  const text = raw.trim();
  if (!text) return null;

  // 1) bare address
  if (isAddress(text)) return { to: getAddress(text) };

  // 2) ethereum: URI (EIP-681)
  if (text.toLowerCase().startsWith("ethereum:")) {
    const body = text.slice("ethereum:".length);
    const qIndex = body.indexOf("?");
    const pathPart = qIndex >= 0 ? body.slice(0, qIndex) : body;
    const queryPart = qIndex >= 0 ? body.slice(qIndex + 1) : "";
    const params = new URLSearchParams(queryPart);
    const target = (pathPart.split("@")[0] ?? "").split("/")[0] ?? "";

    // ERC-20 transfer: recipient is the `address` param, amount the `uint256`
    if (pathPart.includes("/transfer")) {
      const recip = params.get("address");
      if (!recip || !isAddress(recip)) return null;
      const out: ParsedPaymentQr = { to: getAddress(recip) };
      const units = params.get("uint256") ?? params.get("amount");
      if (units && /^\d+$/.test(units)) {
        out.amount = formatUnits(BigInt(units), usdcDecimals);
      }
      return out;
    }

    // plain ethereum:0xADDR
    if (isAddress(target)) return { to: getAddress(target) };
  }

  return null;
}
