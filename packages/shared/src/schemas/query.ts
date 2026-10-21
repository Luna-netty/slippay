import { z } from "zod";

/**
 * Validates list limit query parameter:
 * - undefined -> 50
 * - integer string >= 1 -> capped at 200 (Math.min(val, 200))
 * - non-integer, <= 0, or non-numeric -> ZodError (yields 400 validation_error)
 */
export const LimitQuerySchema = z
  .string()
  .optional()
  .refine(
    (val) => {
      if (val === undefined) return true;
      return /^\d+$/.test(val);
    },
    { message: "limit must be a positive integer" },
  )
  .transform((val) => {
    if (val === undefined) return 50;
    return parseInt(val, 10);
  })
  .refine((val) => val >= 1, { message: "limit must be at least 1" })
  .transform((val) => Math.min(val, 200));
