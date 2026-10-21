import { describe, it, expect } from "vitest";
import { parsePaymentQr } from "./parsePaymentQr.ts";

const RECIP = "0x25d5dCDACFd88Cc902E707823d3c88f584491fF0";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("parsePaymentQr", () => {
  it("parses a bare checksummed address", () => {
    expect(parsePaymentQr(RECIP)).toEqual({ to: RECIP });
  });

  it("checksums a lowercase bare address", () => {
    expect(parsePaymentQr(RECIP.toLowerCase())).toEqual({ to: RECIP });
  });

  it("trims surrounding whitespace", () => {
    expect(parsePaymentQr(`  ${RECIP}  `)).toEqual({ to: RECIP });
  });

  it("parses a plain ethereum: URI", () => {
    expect(parsePaymentQr(`ethereum:${RECIP}`)).toEqual({ to: RECIP });
  });

  it("parses a plain ethereum: URI with a chain id", () => {
    expect(parsePaymentQr(`ethereum:${RECIP}@8453`)).toEqual({ to: RECIP });
  });

  it("parses an EIP-681 ERC-20 transfer with amount", () => {
    const uri = `ethereum:${USDC}@8453/transfer?address=${RECIP}&uint256=1830000`;
    expect(parsePaymentQr(uri)).toEqual({ to: RECIP, amount: "1.83" });
  });

  it("parses an EIP-681 transfer without an amount", () => {
    const uri = `ethereum:${USDC}@8453/transfer?address=${RECIP}`;
    expect(parsePaymentQr(uri)).toEqual({ to: RECIP });
  });

  it("rejects empty / junk input", () => {
    expect(parsePaymentQr("")).toBeNull();
    expect(parsePaymentQr("   ")).toBeNull();
    expect(parsePaymentQr("hello world")).toBeNull();
    expect(parsePaymentQr("https://slippay.cc")).toBeNull();
  });

  it("rejects an address that fails the EVM format", () => {
    expect(parsePaymentQr("0x1234")).toBeNull();
  });

  it("rejects a transfer URI with no valid recipient", () => {
    expect(parsePaymentQr(`ethereum:${USDC}@8453/transfer?uint256=1000000`)).toBeNull();
  });
});
