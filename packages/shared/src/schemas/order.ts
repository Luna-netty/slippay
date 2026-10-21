import { z } from "zod";

const fiatAmount = z.string().regex(/^\d{1,9}\.\d{2}$/, "must be string with 2 decimals");

// USDC amount schema: decimal-string with max 7 fractional places and > 0.
export const UsdcAmountSchema = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,7})?$/, "must be decimal string with at most 7 fractional places")
  .refine(v => parseFloat(v) > 0, "must be > 0");

// Either brl_amount OR usd_amount must be set, not both. usd_amount lets
// BR-export merchants invoice global customers in USD without going through
// a BRL conversion round-trip — usdc_amount = usd_amount (1:1, USDC is a
// USD-pegged stablecoin, ignoring CoinGecko spread).
export const CreateOrderInputSchema = z.object({
  brl_amount: fiatAmount.refine(v => parseFloat(v) > 0, "must be > 0").optional(),
  usd_amount: UsdcAmountSchema.optional(),
  external_ref: z.string().max(120).optional(),
  expires_in_minutes: z.number().int().min(5).max(1440).optional(),
}).refine(
  (d) => (d.brl_amount && !d.usd_amount) || (!d.brl_amount && d.usd_amount),
  { message: "exactly one of brl_amount or usd_amount must be set" },
);

export const OrderStatusSchema = z.enum([
  "pending","paid","underpaid","expired","cancelled","dead",
]);

export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
