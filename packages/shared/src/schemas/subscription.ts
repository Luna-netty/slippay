import { z } from "zod";
import { httpsWebhookUrl } from "./webhook-url.ts";

const brlAmount = z.string().regex(/^\d{1,9}\.\d{2}$/, "must be string with 2 decimals");

export const SubscriptionStatusSchema = z.enum([
  "active", "paused", "cancelled", "expired",
]);

export const AssetCodeSchema = z.enum(["USDC", "PYUSD"]);

export const CreateSubscriptionInputSchema = z.object({
  external_ref: z.string().max(120).optional(),
  buyer_stellar_address: z.string().length(56).optional(),
  buyer_email: z.string().email().optional(),
  asset_code: AssetCodeSchema.default("USDC"),
  brl_amount: brlAmount.refine(v => parseFloat(v) > 0, "must be > 0"),
  period_seconds: z.number().int().min(86400).max(31_536_000),  // 1 day to 1 year
  max_periods: z.number().int().min(1).max(120).optional(),
  expires_at: z.string().datetime().optional(),
  webhook_url: httpsWebhookUrl.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateSubscriptionInputSchema = z.object({
  status: SubscriptionStatusSchema.optional(),
  webhook_url: httpsWebhookUrl.nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  // Promote a subscription to on-chain by linking it to a deployed Soroban
  // subscription contract instance. Both fields go together.
  soroban_contract_id: z.string().length(56).startsWith("C").nullable().optional(),
  soroban_subscription_id: z.string().regex(/^[a-f0-9]{64}$/, "must be 32-byte hex").nullable().optional(),
});

export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionInputSchema>;
export type UpdateSubscriptionInput = z.infer<typeof UpdateSubscriptionInputSchema>;
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;
export type AssetCode = z.infer<typeof AssetCodeSchema>;
