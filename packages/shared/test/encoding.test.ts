import { describe, it, expect } from "vitest";
import {
  bufToHex,
  hexToBuf,
  hexToUint8Array,
  b64url,
  b64urlDecode,
} from "../src/index.ts";

describe("packages/shared encoding primitives", () => {
  describe("bufToHex & hexToBuf", () => {
    it("converts known byte arrays to lowercase hex", () => {
      const bytes = new Uint8Array([0x00, 0x0f, 0x10, 0xab, 0xcd, 0xef, 0xff]);
      expect(bufToHex(bytes)).toBe("000f10abcdefff");
      expect(bufToHex(bytes.buffer)).toBe("000f10abcdefff");
    });

    it("handles empty buffers", () => {
      expect(bufToHex(new Uint8Array(0))).toBe("");
      expect(hexToBuf("")).toEqual(new Uint8Array(0));
      expect(hexToBuf("0x")).toEqual(new Uint8Array(0));
    });

    it("parses hex strings with or without 0x prefix", () => {
      const expected = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
      expect(hexToBuf("123456789abcdef0")).toEqual(expected);
      expect(hexToBuf("0x123456789abcdef0")).toEqual(expected);
      expect(hexToBuf("0X123456789ABCDEF0")).toEqual(expected);
      expect(hexToUint8Array("123456789abcdef0")).toEqual(expected);
    });

    it("round-trips arbitrary byte sequences", () => {
      const original = new Uint8Array(64);
      for (let i = 0; i < original.length; i++) {
        original[i] = (i * 37 + 11) % 256;
      }
      const hex = bufToHex(original);
      const decoded = hexToBuf(hex);
      expect(decoded).toEqual(original);
      expect(bufToHex(decoded)).toBe(hex);
    });

    it("throws on odd length or invalid hex characters", () => {
      expect(() => hexToBuf("abc")).toThrow("hex length must be even");
      expect(() => hexToBuf("0xabc")).toThrow("hex length must be even");
      expect(() => hexToBuf("123g")).toThrow("invalid hex byte");
      expect(() => hexToBuf("zz")).toThrow("invalid hex byte");
    });
  });

  describe("b64url & b64urlDecode", () => {
    it("converts standard test vectors to unpadded URL-safe base64", () => {
      // RFC 4648 vectors
      const enc = new TextEncoder();
      expect(b64url(enc.encode(""))).toBe("");
      expect(b64url(enc.encode("f"))).toBe("Zg");
      expect(b64url(enc.encode("fo"))).toBe("Zm8");
      expect(b64url(enc.encode("foo"))).toBe("Zm9v");
      expect(b64url(enc.encode("foob"))).toBe("Zm9vYg");
      expect(b64url(enc.encode("fooba"))).toBe("Zm9vYmE");
      expect(b64url(enc.encode("foobar"))).toBe("Zm9vYmFy");
    });

    it("replaces + with - and / with _ and removes trailing =", () => {
      // 0xfb, 0xff, 0xfe -> base64 "-__-"
      const bytes = new Uint8Array([0xfb, 0xff, 0xfe]);
      const res = b64url(bytes);
      expect(res).not.toContain("+");
      expect(res).not.toContain("/");
      expect(res).not.toContain("=");
      expect(res).toBe("-__-");
      
      const roundTrip = b64urlDecode(res);
      expect(roundTrip).toEqual(bytes);
    });

    it("decodes both padded and unpadded base64url strings", () => {
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      
      // 3 bytes: unpadded
      expect(dec.decode(b64urlDecode("Zm9v"))).toBe("foo");

      // 2 bytes: unpadded and padded
      expect(dec.decode(b64urlDecode("Zm8"))).toBe("fo");
      expect(dec.decode(b64urlDecode("Zm8="))).toBe("fo");

      // 1 byte: unpadded and padded
      expect(dec.decode(b64urlDecode("Zg"))).toBe("f");
      expect(dec.decode(b64urlDecode("Zg=="))).toBe("f");
    });

    it("round-trips random binary buffers byte-for-byte", () => {
      for (const len of [0, 1, 2, 3, 4, 16, 32, 64, 100, 256]) {
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = (i * 73 + 19) % 256;
        }
        const encoded = b64url(bytes);
        const decoded = b64urlDecode(encoded);
        expect(decoded).toEqual(bytes);
      }
    });

    it("matches checkout-token and apikey byte-for-byte parity", async () => {
      // Test HMAC signature simulation for checkout-token
      const testSecret = "01234567890123456789012345678901";
      const testOrderId = "order_123456789_abcdef";
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(testSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, enc.encode(testOrderId));

      // Hand-rolled b64url from checkout-token.ts:
      const bytes = new Uint8Array(sig);
      let legacyStr = "";
      for (const b of bytes) legacyStr += String.fromCharCode(b);
      const legacyResult = btoa(legacyStr).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

      // Shared b64url:
      const sharedResult = b64url(sig);
      expect(sharedResult).toBe(legacyResult);

      // Verify decode reproduces exact bytes
      expect(b64urlDecode(sharedResult)).toEqual(new Uint8Array(sig));

      // Test bufToHex parity for apikey.ts
      const legacyHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
      const sharedHex = bufToHex(sig);
      expect(sharedHex).toBe(legacyHex);
    });
  });
});
