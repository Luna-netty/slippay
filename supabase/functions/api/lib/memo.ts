import { bufToHex } from "@slippay/shared";

/**
 * Generates a 64-character hex memo for Stellar payments and order correlation.
 *
 * Design note (fixes #71):
 * We generate 32 cryptographically secure random bytes (256 bits of CSPRNG entropy)
 * directly from the system entropy source and hex-encode them. The previous intermediate
 * SHA-256 digest added no additional entropy (as SHA-256 is deterministic over 256 random
 * bits) and incurred pure hashing overhead. Uniqueness and collision protection are
 * strictly enforced at the database level via a UNIQUE constraint on `orders.memo`.
 */
export async function generateMemo(): Promise<string> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return bufToHex(buf);
}