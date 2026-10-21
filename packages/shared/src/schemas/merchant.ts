import { z } from "zod";
import { STELLAR_ADDRESS_LENGTH } from "../constants.ts";
import { httpsWebhookUrl } from "./webhook-url.ts";

const stellarAddress = z.string().length(STELLAR_ADDRESS_LENGTH).regex(/^G[A-Z2-7]{55}$/);

export const CreateMerchantInputSchema = z.object({
  display_name: z.string().min(1).max(120),
  stellar_address: stellarAddress.optional(),
  webhook_url: httpsWebhookUrl.optional(),
});

export const PatchMerchantInputSchema = CreateMerchantInputSchema.partial();

export type CreateMerchantInput = z.infer<typeof CreateMerchantInputSchema>;
export type PatchMerchantInput = z.infer<typeof PatchMerchantInputSchema>;
