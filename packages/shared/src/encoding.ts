/**
 * Common byte encoding and decoding primitives shared across API, web, and listener.
 */

/**
 * Converts an ArrayBuffer or Uint8Array into a lowercase hex string.
 */
export function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Converts a hex string (optionally prefixed with '0x' or '0X') into a Uint8Array.
 * Throws an Error if the hex string has an odd length or contains invalid hex characters.
 */
export function hexToBuf(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error("hex length must be even");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const pair = clean.slice(i * 2, i * 2 + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) {
      throw new Error(`invalid hex byte: ${pair}`);
    }
    out[i] = parseInt(pair, 16);
  }
  return out;
}

/**
 * Alias for hexToBuf for backwards compatibility and parity with Stellar/Deno conventions.
 */
export const hexToUint8Array = hexToBuf;

/**
 * Encodes an ArrayBuffer or Uint8Array into an unpadded URL-safe base64 string (RFC 4648 §5).
 */
export function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) {
    s += String.fromCharCode(b);
  }
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * Decodes a URL-safe base64 string (padded or unpadded) into a Uint8Array.
 */
export function b64urlDecode(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "");
  const pad = clean.length % 4 === 0 ? "" : "=".repeat(4 - (clean.length % 4));
  const std = (clean + pad).replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}
