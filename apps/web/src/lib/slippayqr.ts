// Slippay payment-request QR format. A merchant encodes "pay <amount> to <me>"
// into a QR; the payer scans it, sees who/how-much, taps Face ID to authorize.
//
// URI: slippay:pay?to=<G…|C…>&amount=<stroops>&label=<optional>
//   - to      = recipient (merchant) Stellar address
//   - amount  = stroops (7-decimal; 1 XLM = 10_000_000)
//   - label   = human note shown on the confirm screen (optional)

export interface PayRequest {
  to: string;
  amount: string; // stroops (7-decimal; USDC and XLM both use 7 decimals)
  asset?: "USDC" | "XLM"; // default USDC for new charges; absent → legacy XLM
  label?: string;
}

export function encodeRequest(r: PayRequest): string {
  const p = new URLSearchParams({ to: r.to, amount: r.amount });
  if (r.asset) p.set("asset", r.asset);
  if (r.label) p.set("label", r.label);
  return `slippay:pay?${p.toString()}`;
}

export function decodeRequest(raw: string): PayRequest {
  const s = raw.trim();
  const m = s.match(/^slippay:pay\?(.*)$/i);
  if (!m) throw new Error("Esse QR não é um pedido de pagamento Slippay.");
  const p = new URLSearchParams(m[1]);
  const to = p.get("to");
  const amount = p.get("amount");
  if (!to || !amount) throw new Error("QR incompleto (falta destinatário ou valor).");
  if (!/^[GC][A-Z2-7]{55}$/.test(to)) throw new Error("Endereço do QR é inválido.");
  if (!/^\d+$/.test(amount)) throw new Error("Valor do QR é inválido.");
  const asset = p.get("asset");
  return {
    to, amount,
    asset: asset === "USDC" || asset === "XLM" ? asset : undefined,
    label: p.get("label") || undefined,
  };
}

/** stroops → human XLM string, e.g. "3000000" → "0,3". */
export function stroopsToXlm(stroops: string): string {
  const n = Number(stroops) / 1e7;
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 7 });
}
