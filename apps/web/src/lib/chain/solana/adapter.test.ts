import { describe, it, expect, vi, beforeEach } from "vitest";

// Only `Connection` talks to the network on the reads path; keep the rest of
// @solana/web3.js REAL (PublicKey derivation, ATA math) and stub getAccountInfo.
const getAccountInfo = vi.hoisted(() => vi.fn());

vi.mock("@solana/web3.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class FakeConnection {
    getAccountInfo = getAccountInfo;
    constructor(..._args: unknown[]) {}
  }
  return { ...actual, Connection: FakeConnection };
});

// Anchor is heavy and irrelevant here: the adapter only constructs a BN.
vi.mock("@coral-xyz/anchor", () => ({
  BN: class BN {
    constructor(public readonly value: unknown) {}
    toString(): string { return String(this.value); }
  },
}));

// The mandate program client is exercised by mandate.test.ts; here we only need
// to observe HOW the adapter calls it.
const mandate = vi.hoisted(() => ({
  mandatePda: vi.fn(),
  buildPaySplitIx: vi.fn(),
  orderIdFromHex: vi.fn(),
}));
vi.mock("./mandate.ts", () => mandate);

const wallet = vi.hoisted(() => ({ boundSolanaWallet: vi.fn(), bindSolanaWallet: vi.fn() }));
vi.mock("./wallet.ts", () => wallet);

import { Keypair, PublicKey } from "@solana/web3.js";
import { solanaAdapter } from "./adapter.ts";

const MANDATE_PDA = new PublicKey("CmDKY8MxCWkCN9etSeKApHKnGuTKK6vn7qzhTkAtM9Bv");
const SYSTEM = new PublicKey("11111111111111111111111111111111");

let execute: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  execute = vi.fn(async () => "SOLANA_SIGNATURE");
  wallet.boundSolanaWallet.mockReturnValue({ address: Keypair.generate().publicKey.toBase58(), execute });
  mandate.mandatePda.mockReturnValue(MANDATE_PDA);
  mandate.orderIdFromHex.mockReturnValue(new Array(32).fill(0));
  mandate.buildPaySplitIx.mockResolvedValue({ programId: SYSTEM, keys: [], data: Buffer.alloc(0) });
  getAccountInfo.mockResolvedValue({});
});

describe("solanaAdapter · identity and addresses", () => {
  it("reports the solana chain id", () => {
    expect(solanaAdapter.id).toBe("solana");
  });

  it("isValidAddress accepts on-curve pubkeys and rejects junk", () => {
    const good = Keypair.generate().publicKey.toBase58();
    expect(solanaAdapter.isValidAddress(good)).toBe(true);
    expect(solanaAdapter.isValidAddress("not-an-address")).toBe(false);
    expect(solanaAdapter.isValidAddress("")).toBe(false);
  });

  it("checkReceiveAddress maps on-chain state to the AddressCheck shape", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    // wallet exists, USDC ATA does not
    getAccountInfo.mockReset();
    getAccountInfo.mockResolvedValueOnce({}).mockResolvedValueOnce(null);
    await expect(solanaAdapter.checkReceiveAddress(owner)).resolves.toEqual({
      validFormat: true, accountExists: true, hasUsdcTrustline: false,
    });
  });

  it("checkReceiveAddress short-circuits a malformed address without an RPC call", async () => {
    getAccountInfo.mockClear();
    await expect(solanaAdapter.checkReceiveAddress("nope")).resolves.toEqual({
      validFormat: false, accountExists: null, hasUsdcTrustline: null,
    });
    expect(getAccountInfo).not.toHaveBeenCalled();
  });

  it("checkReceiveAddress reports unknown (null) on an RPC error rather than asserting absence", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    getAccountInfo.mockReset();
    getAccountInfo.mockRejectedValue(new Error("rpc down"));
    await expect(solanaAdapter.checkReceiveAddress(owner)).resolves.toEqual({
      validFormat: true, accountExists: null, hasUsdcTrustline: null,
    });
  });
});

describe("solanaAdapter · payOneTime", () => {
  const buyer = Keypair.generate().publicKey.toBase58();
  const recipient = Keypair.generate().publicKey.toBase58();
  const platform = Keypair.generate().publicKey.toBase58();

  it("builds one pay_split instruction and hands it to the bound wallet", async () => {
    const args = {
      buyerAddress: buyer, merchantAddress: recipient, platformAddress: platform,
      usdcAmount: "12.5", platformFeeBp: 297, memoHex: "cd".repeat(32), maxTime: 1,
    };

    await expect(solanaAdapter.payOneTime(args)).resolves.toEqual({ hash: "SOLANA_SIGNATURE" });

    expect(mandate.buildPaySplitIx).toHaveBeenCalledTimes(1);
    const [conn, buildArgs] = mandate.buildPaySplitIx.mock.calls[0]!;
    expect(conn).toBeDefined();
    expect(buildArgs).toMatchObject({
      payer: new PublicKey(buyer),
      merchantToken: expect.anything(),
      platformToken: expect.anything(),
      feeBp: 297,
    });
    expect(buildArgs.amount.toString()).toBe("12500000"); // 12.5 USDC at 6 dp
    expect(mandate.orderIdFromHex).toHaveBeenCalledWith(args.memoHex);
    expect(execute).toHaveBeenCalledWith([expect.objectContaining({ programId: SYSTEM })]);
  });

  it("rejects a Stellar-format merchant address with a diagnostic error", async () => {
    const stellarMerchant = "G" + "M".repeat(55);
    await expect(solanaAdapter.payOneTime({
      buyerAddress: buyer, merchantAddress: stellarMerchant, platformAddress: platform,
      usdcAmount: "1", platformFeeBp: 297, memoHex: "cd".repeat(32), maxTime: 1,
    })).rejects.toThrow(/merchant address is not a valid Solana address/);
    expect(mandate.buildPaySplitIx).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("solanaAdapter · approveRecurring", () => {
  it("delegates bounded spend to the owner+mint mandate PDA in one approval", async () => {
    const owner = Keypair.generate().publicKey.toBase58();
    await expect(
      solanaAdapter.approveRecurring({ buyerAddress: owner, capUsdc: "12" }),
    ).resolves.toEqual({ hash: "SOLANA_SIGNATURE" });

    expect(mandate.mandatePda).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    const [ixs] = execute.mock.calls[0]!;
    expect(Array.isArray(ixs)).toBe(true);
    expect(ixs).toHaveLength(1);
    // The SPL `approve` delegate must be the derived mandate PDA.
    expect(ixs[0].keys[1].pubkey.equals(MANDATE_PDA)).toBe(true);
  });
});