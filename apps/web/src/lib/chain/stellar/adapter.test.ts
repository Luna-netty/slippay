import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The Soroban RPC server is the only thing in the Stellar SDK the adapter touches
// over the wire; swap just `rpc.Server` for a fake that returns a fixed ledger so
// the suite stays offline. Asset/Networks stay REAL so the SAC comparison below is
// a genuine contract-id derivation, not a re-implementation.
const sdk = vi.hoisted(() => ({ latestLedger: 5_000 }));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class FakeSorobanServer {
    constructor(_url: string) {}
    async getLatestLedger(): Promise<{ sequence: number }> {
      return { sequence: sdk.latestLedger };
    }
  }
  return { ...actual, rpc: { ...(actual.rpc as object), Server: FakeSorobanServer } };
});

// Wallet + classic-path + Soroban helpers are all external side effects; stub them.
const wallet = vi.hoisted(() => ({ connectWallet: vi.fn(), signTx: vi.fn() }));
vi.mock("../../wallet.ts", () => ({ connectWallet: wallet.connectWallet, signTx: wallet.signTx }));

const stellar = vi.hoisted(() => ({
  fetchSequence: vi.fn(),
  submitSignedTx: vi.fn(),
  buildAtomicTx: vi.fn(),
  isValidStellarAddress: vi.fn(),
  checkReceiveAddress: vi.fn(),
}));
vi.mock("../../stellar.ts", () => stellar);

const soroban = vi.hoisted(() => ({ approveAllowance: vi.fn() }));
vi.mock("../../soroban.ts", () => soroban);

import { Asset, Networks } from "@stellar/stellar-sdk";
import { NETWORK } from "@slippay/shared";
import { stellarAdapter } from "./adapter.ts";

// The adapter's default subscription contract (SEP-41 spender) — mainnet CBJMQ6ZY.
const SUB_CONTRACT = "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN";
// Default recurring duration = 5_000_000 ledgers when no durationSecs is given.
const DEFAULT_DURATION_LEDGERS = 5_000_000;

const BUYER = "GBUYER" + "A".repeat(49);
const MERCHANT = "GMERCHANT" + "B".repeat(47);
const PLATFORM = "GPLATFORM" + "C".repeat(47);
const MEMO = "ab".repeat(32);

describe("stellarAdapter · identity and address handling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports the stellar chain id", () => {
    expect(stellarAdapter.id).toBe("stellar");
  });

  it("delegates isValidAddress to the strkey check (no network)", () => {
    stellar.isValidStellarAddress.mockReturnValue(true);
    expect(stellarAdapter.isValidAddress(BUYER)).toBe(true);
    expect(stellar.isValidStellarAddress).toHaveBeenCalledWith(BUYER);

    stellar.isValidStellarAddress.mockReturnValue(false);
    expect(stellarAdapter.isValidAddress("nope")).toBe(false);
  });

  it("checkReceiveAddress runs against the default (TESTNET) network", async () => {
    const check = { validFormat: true, accountExists: true, hasUsdcTrustline: true };
    stellar.checkReceiveAddress.mockResolvedValue(check);
    await expect(stellarAdapter.checkReceiveAddress(MERCHANT)).resolves.toEqual(check);
    expect(stellar.checkReceiveAddress).toHaveBeenCalledWith("TESTNET", MERCHANT);
  });
});

describe("stellarAdapter · payOneTime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stellar.fetchSequence.mockResolvedValue("12345");
    stellar.buildAtomicTx.mockResolvedValue("UNSIGNED_XDR");
    wallet.signTx.mockResolvedValue("SIGNED_XDR");
    stellar.submitSignedTx.mockResolvedValue({ hash: "TXHASH" });
  });

  it("builds the atomic transfer from the fetched sequence and reports the submitted hash", async () => {
    const args = {
      buyerAddress: BUYER,
      merchantAddress: MERCHANT,
      platformAddress: PLATFORM,
      usdcAmount: "12.50",
      platformFeeBp: 297,
      memoHex: MEMO,
      maxTime: 1_800_000_000,
    };

    await expect(stellarAdapter.payOneTime(args)).resolves.toEqual({ hash: "TXHASH" });

    // Asserted on the argument STRUCTURE, never on a hard-coded XDR string.
    expect(stellar.fetchSequence).toHaveBeenCalledWith("TESTNET", BUYER);
    expect(stellar.buildAtomicTx).toHaveBeenCalledWith({
      buyerPublicKey: BUYER,
      buyerSequence: "12345",
      merchantAddress: MERCHANT,
      platformAddress: PLATFORM,
      usdcAmount: "12.50",
      platformFeeBp: 297,
      memo: MEMO,
      network: "TESTNET",
      maxTime: 1_800_000_000,
    });
    // The unsigned tx is what gets signed, and the signed XDR is what gets submitted.
    expect(wallet.signTx).toHaveBeenCalledWith("UNSIGNED_XDR");
    expect(stellar.submitSignedTx).toHaveBeenCalledWith("TESTNET", "SIGNED_XDR");
  });

  it("does not sign or submit when tx-building fails", async () => {
    stellar.buildAtomicTx.mockRejectedValue(new Error("invalid_amount"));
    await expect(stellarAdapter.payOneTime({
      buyerAddress: BUYER, merchantAddress: MERCHANT, platformAddress: PLATFORM,
      usdcAmount: "0", platformFeeBp: 297, memoHex: MEMO, maxTime: 1,
    })).rejects.toThrow("invalid_amount");
    expect(wallet.signTx).not.toHaveBeenCalled();
    expect(stellar.submitSignedTx).not.toHaveBeenCalled();
  });
});

describe("stellarAdapter · approveRecurring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.latestLedger = 5_000;
    soroban.approveAllowance.mockResolvedValue("APPROVE_HASH");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("approves the SEP-41 spender over the TESTNET SAC that matches the shared USDC issuer", async () => {
    await expect(
      stellarAdapter.approveRecurring({ buyerAddress: BUYER, capUsdc: "12", durationSecs: 3_600 }),
    ).resolves.toEqual({ hash: "APPROVE_HASH" });

    // The SAC the adapter approves is derived from packages/shared's testnet issuer —
    // this is the "reported asset matches the shared constants" guarantee.
    const expectedSac = new Asset("USDC", NETWORK.testnet.usdc_issuer).contractId(Networks.TESTNET);
    expect(soroban.approveAllowance).toHaveBeenCalledWith({
      sacAddress: expectedSac,
      owner: BUYER,
      spender: SUB_CONTRACT,
      amount: "120000000", // 12 USDC at 7 dp
      expirationLedger: 5_000 + Math.floor(3_600 / 5), // durationSecs -> ledgers
      rpcUrl: "https://soroban-testnet.stellar.org",
    });
  });

  it("defaults the expiration to ~9 months of ledgers when durationSecs is omitted", async () => {
    await stellarAdapter.approveRecurring({ buyerAddress: BUYER, capUsdc: "1" });
    expect(soroban.approveAllowance).toHaveBeenCalledWith(
      expect.objectContaining({ expirationLedger: 5_000 + DEFAULT_DURATION_LEDGERS, amount: "10000000" }),
    );
  });

  it("switches to the mainnet SAC/URL and shared mainnet issuer under PUBLIC", async () => {
    vi.stubEnv("VITE_STELLAR_NETWORK", "PUBLIC");
    await stellarAdapter.approveRecurring({ buyerAddress: BUYER, capUsdc: "5" });

    const expectedSac = new Asset("USDC", NETWORK.mainnet.usdc_issuer).contractId(Networks.PUBLIC);
    expect(soroban.approveAllowance).toHaveBeenCalledWith(
      expect.objectContaining({ sacAddress: expectedSac, rpcUrl: "https://soroban-mainnet.stellar.org" }),
    );
  });
});
