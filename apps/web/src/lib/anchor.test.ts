import { describe, it, expect, vi, beforeEach } from "vitest";
import { Networks, Keypair, TransactionBuilder, Operation } from "@stellar/stellar-sdk";
import {
  resolveAnchorConfig,
  sep10Authenticate,
  NETWORK_PASSPHRASE,
  STELLAR_NETWORK,
  HORIZON_URL,
  ANCHOR_HOME,
  type BuyerWallet,
} from "./anchor.ts";

describe("anchor.ts · configuration & network declaration", () => {
  it("defaults to TESTNET with testanchor when no env is provided", () => {
    const config = resolveAnchorConfig();
    expect(config.network).toBe("TESTNET");
    expect(config.networkPassphrase).toBe(Networks.TESTNET);
    expect(config.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(config.anchorHome).toBe("https://testanchor.stellar.org");
    expect(config.authUrl).toBe("https://testanchor.stellar.org/auth");
    expect(config.sep24Url).toBe("https://testanchor.stellar.org/sep24");
  });

  it("supports TESTNET with custom anchor home", () => {
    const config = resolveAnchorConfig("TESTNET", "https://custom-test-anchor.example.com");
    expect(config.network).toBe("TESTNET");
    expect(config.networkPassphrase).toBe(Networks.TESTNET);
    expect(config.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    expect(config.anchorHome).toBe("https://custom-test-anchor.example.com");
    expect(config.authUrl).toBe("https://custom-test-anchor.example.com/auth");
    expect(config.sep24Url).toBe("https://custom-test-anchor.example.com/sep24");
  });

  it("supports PUBLIC network with valid production anchor", () => {
    const config = resolveAnchorConfig("PUBLIC", "https://anchor.moneygram.com");
    expect(config.network).toBe("PUBLIC");
    expect(config.networkPassphrase).toBe(Networks.PUBLIC);
    expect(config.horizonUrl).toBe("https://horizon.stellar.org");
    expect(config.anchorHome).toBe("https://anchor.moneygram.com");
    expect(config.authUrl).toBe("https://anchor.moneygram.com/auth");
    expect(config.sep24Url).toBe("https://anchor.moneygram.com/sep24");
  });

  it("fails fast if PUBLIC is chosen without an anchor home", () => {
    expect(() => resolveAnchorConfig("PUBLIC", "")).toThrowError(
      /VITE_ANCHOR_HOME must be explicitly configured when VITE_STELLAR_NETWORK is "PUBLIC"/,
    );
  });

  it("fails fast if PUBLIC is configured with testanchor.stellar.org", () => {
    expect(() =>
      resolveAnchorConfig("PUBLIC", "https://testanchor.stellar.org"),
    ).toThrowError(/testanchor\.stellar\.org cannot be used on network "PUBLIC"/);
  });

  it("fails fast on unknown network names", () => {
    expect(() => resolveAnchorConfig("FUTURENET")).toThrowError(
      /unsupported network "FUTURENET"/,
    );
  });

  it("exports active configuration constants consistent with defaults", () => {
    expect(STELLAR_NETWORK).toBe("TESTNET");
    expect(NETWORK_PASSPHRASE).toBe(Networks.TESTNET);
    expect(HORIZON_URL).toBe("https://horizon-testnet.stellar.org");
    expect(ANCHOR_HOME).toBe("https://testanchor.stellar.org");
  });
});

describe("anchor.ts · sep10Authenticate network mismatch handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws an explicit error naming the network when challenge network passphrase mismatches", async () => {
    const buyer: BuyerWallet = {
      publicKey: Keypair.random().publicKey(),
      secretKey: Keypair.random().secret(),
    };

    // Mock fetch returning a challenge with mainnet passphrase while module is on TESTNET
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        transaction: "dummy_xdr",
        network_passphrase: Networks.PUBLIC,
      }),
    } as Response);

    await expect(sep10Authenticate(buyer)).rejects.toThrowError(
      /network mismatch — anchor challenge declares network passphrase "Public Global Stellar Network ; September 2015", but app network "TESTNET" requires "Test SDF Network ; September 2015"/,
    );
  });

  it("signs and returns token when challenge network matches", async () => {
    const kp = Keypair.random();
    const buyer: BuyerWallet = {
      publicKey: kp.publicKey(),
      secretKey: kp.secret(),
    };

    // Build a valid test challenge transaction
    const serverKp = Keypair.random();
    const sourceAccount = new (await import("@stellar/stellar-sdk")).Account(
      serverKp.publicKey(),
      "100",
    );
    const challengeTx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.manageData({
          name: "client auth",
          value: buyer.publicKey,
        }),
      )
      .setTimeout(300)
      .build();

    const challengeXdr = challengeTx.toEnvelope().toXDR("base64");

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transaction: challengeXdr,
          network_passphrase: NETWORK_PASSPHRASE,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: "mock-jwt-token-xyz",
        }),
      } as Response);

    const token = await sep10Authenticate(buyer);
    expect(token).toBe("mock-jwt-token-xyz");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
