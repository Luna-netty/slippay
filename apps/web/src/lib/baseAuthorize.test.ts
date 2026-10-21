import { describe, it, expect, vi } from "vitest";
import {
  buildUsdcTransfer,
  decodeUsdcTransfer,
  assertTransferMatches,
  authorizeBasePayment,
} from "./baseAuthorize.ts";
import { USDC_ADDRESS } from "./chain/base/usdc.ts";

const ADDR_A = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as `0x${string}`;
const ADDR_B = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B" as `0x${string}`;

describe("buildUsdcTransfer + decodeUsdcTransfer round-trip", () => {
  it("extracts correct to and amount from a built transfer", () => {
    const tx = buildUsdcTransfer(ADDR_A, "10.5");
    expect(tx.to).toBe(USDC_ADDRESS);
    expect(tx.value).toBe(0n);
    const decoded = decodeUsdcTransfer(tx);
    expect(decoded.to.toLowerCase()).toBe(ADDR_A.toLowerCase());
    expect(decoded.amount).toBe("10.5");
  });

  it("round-trips integer amounts", () => {
    const tx = buildUsdcTransfer(ADDR_A, "100");
    const decoded = decodeUsdcTransfer(tx);
    expect(decoded.amount).toBe("100");
  });

  it("round-trips minimum unit", () => {
    const tx = buildUsdcTransfer(ADDR_A, "0.000001");
    const decoded = decodeUsdcTransfer(tx);
    expect(decoded.amount).toBe("0.000001");
  });
});

describe("decodeUsdcTransfer rejects bad calldata", () => {
  it("throws on empty/junk data", () => {
    expect(() => decodeUsdcTransfer({ data: "0x" })).toThrow();
    expect(() => decodeUsdcTransfer({ data: "0xdeadbeef" })).toThrow();
  });

  it("throws on non-transfer selector (approve)", () => {
    // approve(address,uint256) selector = 0x095ea7b3
    const approveData = "0x095ea7b3" +
      ADDR_A.slice(2).padStart(64, "0") +
      "0000000000000000000000000000000000000000000000000000000000989680";
    expect(() =>
      decodeUsdcTransfer({ data: approveData as `0x${string}` })
    ).toThrow();
  });
});

describe("assertTransferMatches", () => {
  it("passes on exact match", () => {
    expect(() =>
      assertTransferMatches({ to: ADDR_A, amount: "10.5" }, { to: ADDR_A, amount: "10.5" })
    ).not.toThrow();
  });

  it("passes on case-insensitive address match", () => {
    expect(() =>
      assertTransferMatches(
        { to: ADDR_A.toLowerCase(), amount: "10" },
        { to: ADDR_A.toUpperCase(), amount: "10" },
      )
    ).not.toThrow();
  });

  it("throws on recipient mismatch", () => {
    expect(() =>
      assertTransferMatches({ to: ADDR_A, amount: "10" }, { to: ADDR_B, amount: "10" })
    ).toThrow(/destinatário divergente/);
  });

  it("throws on amount drift > 1e-6", () => {
    expect(() =>
      assertTransferMatches({ to: ADDR_A, amount: "10.5" }, { to: ADDR_A, amount: "10.6" })
    ).toThrow(/valor divergente/);
  });

  it("passes on amount within 1e-6 tolerance", () => {
    // Same amount encoded and decoded — no drift expected, but tolerance is 1e-6.
    expect(() =>
      assertTransferMatches({ to: ADDR_A, amount: "10.000001" }, { to: ADDR_A, amount: "10.000001" })
    ).not.toThrow();
  });
});

describe("authorizeBasePayment gate order", () => {
  it("returns hash on happy path", async () => {
    const mockSend = vi.fn().mockResolvedValue({ hash: "0xabc123" as `0x${string}` });
    const mockConfirm = vi.fn().mockResolvedValue(true);

    const result = await authorizeBasePayment({
      to: ADDR_A,
      amount: "10",
      sendTransaction: mockSend,
      confirm: mockConfirm,
    });

    expect(result.hash).toBe("0xabc123");
    expect(mockConfirm).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("throws 'cancelado' when user cancels", async () => {
    const mockSend = vi.fn();
    const mockConfirm = vi.fn().mockResolvedValue(false);

    await expect(
      authorizeBasePayment({
        to: ADDR_A,
        amount: "10",
        sendTransaction: mockSend,
        confirm: mockConfirm,
      })
    ).rejects.toThrow("cancelado");

    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does NOT call sendTransaction if confirm returns false", async () => {
    const mockSend = vi.fn();
    const mockConfirm = vi.fn().mockResolvedValue(false);
    try {
      await authorizeBasePayment({
        to: ADDR_A,
        amount: "5",
        sendTransaction: mockSend,
        confirm: mockConfirm,
      });
    } catch {
      // expected
    }
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects bad amounts before reaching confirm", async () => {
    const mockSend = vi.fn();
    const mockConfirm = vi.fn();
    await expect(
      authorizeBasePayment({
        to: ADDR_A,
        amount: "1e3",
        sendTransaction: mockSend,
        confirm: mockConfirm,
      })
    ).rejects.toThrow();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
