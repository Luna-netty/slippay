import { describe, it, expect, afterEach, vi } from "vitest";
import {
  chainId,
  isValidAddress,
  isValidSolanaAddress,
  isValidStellarAddress,
} from "./validate.ts";

// Known-valid Stellar ed25519 public key (base32, 56 chars, correct checksum).
const STELLAR = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
// Valid base58 Solana addresses: the 32-byte system program and the USDC mint.
const SOLANA_SHORT = "11111111111111111111111111111111";
const SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chainId", () => {
  it("defaults to stellar when VITE_CHAIN is unset", () => {
    expect(import.meta.env.VITE_CHAIN).toBeUndefined();
    expect(chainId()).toBe("stellar");
  });

  it("lower-cases the configured chain", () => {
    vi.stubEnv("VITE_CHAIN", "SOLANA");
    expect(chainId()).toBe("solana");
  });
});

describe("isValidStellarAddress", () => {
  it("accepts a valid ed25519 public key, trimming whitespace", () => {
    expect(isValidStellarAddress(STELLAR)).toBe(true);
    expect(isValidStellarAddress(`  ${STELLAR}  `)).toBe(true);
  });

  it("rejects a wrong checksum (one base32 char flipped)", () => {
    expect(isValidStellarAddress(`${STELLAR.slice(0, -1)}6`)).toBe(false);
  });

  it("rejects a wrong length", () => {
    expect(isValidStellarAddress(STELLAR.slice(0, 55))).toBe(false);
    expect(isValidStellarAddress(`${STELLAR}A`)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidStellarAddress("")).toBe(false);
    expect(isValidStellarAddress("   ")).toBe(false);
  });

  it("rejects a Solana-style base58 address", () => {
    expect(isValidStellarAddress(SOLANA_MINT)).toBe(false);
  });

  it("throws (fails closed) on non-string input", () => {
    expect(() => isValidStellarAddress(null as unknown as string)).toThrow();
    expect(() => isValidStellarAddress(undefined as unknown as string)).toThrow();
  });
});

describe("isValidSolanaAddress", () => {
  it("accepts valid base58 addresses, trimming whitespace", () => {
    expect(isValidSolanaAddress(SOLANA_SHORT)).toBe(true);
    expect(isValidSolanaAddress(SOLANA_MINT)).toBe(true);
    expect(isValidSolanaAddress(`  ${SOLANA_MINT}  `)).toBe(true);
  });

  it("rejects characters outside the base58 alphabet", () => {
    expect(isValidSolanaAddress("0".repeat(32))).toBe(false); // 0 not in base58
    expect(isValidSolanaAddress("O".repeat(32))).toBe(false); // O not in base58
    expect(isValidSolanaAddress("I".repeat(32))).toBe(false); // I not in base58
    expect(isValidSolanaAddress("l".repeat(32))).toBe(false); // l not in base58
  });

  it("rejects a wrong length", () => {
    expect(isValidSolanaAddress("abc")).toBe(false);
    expect(isValidSolanaAddress("1".repeat(31))).toBe(false);
    expect(isValidSolanaAddress("1".repeat(45))).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidSolanaAddress("")).toBe(false);
  });

  it("rejects a Stellar address", () => {
    expect(isValidSolanaAddress(STELLAR)).toBe(false);
  });

  it("throws (fails closed) on non-string input", () => {
    expect(() => isValidSolanaAddress(null as unknown as string)).toThrow();
  });
});

describe("isValidAddress — active-chain dispatch", () => {
  it("checks Stellar format when the chain is stellar (default)", () => {
    vi.stubEnv("VITE_CHAIN", "stellar");
    expect(isValidAddress(STELLAR)).toBe(true);
    expect(isValidAddress(SOLANA_MINT)).toBe(false);
  });

  it("checks Solana format when the chain is solana", () => {
    vi.stubEnv("VITE_CHAIN", "solana");
    expect(isValidAddress(SOLANA_MINT)).toBe(true);
    expect(isValidAddress(STELLAR)).toBe(false);
  });
});
