import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import {
  generateSessionKey,
  normalizeSessionPubkey,
  buildConnectRequest,
  parseConnectRequest,
  computeSslHash,
  toStroops,
  installAgentSession,
  ZERO_SSL,
  type ConnectRequest,
  type InstallParams,
} from "./agentSession.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const sampleRequest = (): ConnectRequest => ({
  v: 1,
  session_pubkey: "ab".repeat(32),
  requested: {
    token: "USDC",
    per_tx_cap: "5",
    window_seconds: 86400,
    window_cap: "50",
    expires_at: 2_000_000_000,
    allow_recipients: [],
    policy_uri: "https://agent.example/policy.json",
  },
  agent: { name: "Budget Bot", domain: "agent.example" },
  callback: "https://agent.example/connect/cb",
});

describe("generateSessionKey", () => {
  it("mints an ed25519 key with hex pubkey, G-address and S-secret", () => {
    const k = generateSessionKey();

    expect(k.pubkeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(k.address).toMatch(/^G[A-Z0-9]{55}$/);
    expect(k.secret).toMatch(/^S[A-Z0-9]{55}$/);
    // The displayed G-address must normalize back to the same on-chain hex.
    expect(normalizeSessionPubkey(k.address)).toBe(k.pubkeyHex);
  });

  it("produces a unique key each call", () => {
    expect(generateSessionKey().pubkeyHex).not.toBe(generateSessionKey().pubkeyHex);
  });
});

describe("normalizeSessionPubkey", () => {
  it("lowercases a 64-hex public key and trims surrounding whitespace", () => {
    const hex = "AB".repeat(32);
    expect(normalizeSessionPubkey(`  ${hex}  `)).toBe(hex.toLowerCase());
  });

  it("accepts a G-address and returns its canonical hex", () => {
    const kp = Keypair.random();
    const expected = Buffer.from(kp.rawPublicKey()).toString("hex");

    expect(normalizeSessionPubkey(kp.publicKey())).toBe(expected);
  });

  it("rejects anything that is neither a G-address nor 64-hex, with a specific reason", () => {
    expect(() => normalizeSessionPubkey("not-a-key")).toThrow(/invalid session key/);
    expect(() => normalizeSessionPubkey("ab".repeat(31))).toThrow(/invalid session key/);
    expect(() => normalizeSessionPubkey("")).toThrow(/invalid session key/);
  });
});

describe("connect request handshake (§3)", () => {
  it("round-trips a request through build → parse", () => {
    const req = sampleRequest();

    const parsed = parseConnectRequest(buildConnectRequest(req));

    expect(parsed).toEqual(req);
  });

  it("rejects a request with an unsupported version or missing surface", () => {
    const wrongVersion = btoa(unescape(encodeURIComponent(JSON.stringify({ v: 2, session_pubkey: "x", requested: {} }))));
    expect(() => parseConnectRequest(wrongVersion)).toThrow(/malformed connect request/);

    const missingRequested = btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, session_pubkey: "x" }))));
    expect(() => parseConnectRequest(missingRequested)).toThrow(/malformed connect request/);

    const missingPubkey = btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, requested: {} }))));
    expect(() => parseConnectRequest(missingPubkey)).toThrow(/malformed connect request/);
  });
});

describe("computeSslHash — policy binding (§4)", () => {
  it("is order-independent and matches the sha256 of the canonical document", async () => {
    const a = { zeta: 1, alpha: { beta: 2, gamma: 3 } };
    const b = { alpha: { gamma: 3, beta: 2 }, zeta: 1 };

    const expected = createHash("sha256")
      .update(JSON.stringify({ alpha: { beta: 2, gamma: 3 }, zeta: 1 }))
      .digest("hex");

    expect(await computeSslHash(a)).toBe(expected);
    expect(await computeSslHash(b)).toBe(expected);
  });

  it("exposes the all-zero ssl hash used when no policy is attached", () => {
    expect(ZERO_SSL).toBe("00".repeat(32));
    expect(ZERO_SSL).toHaveLength(64);
  });
});

describe("toStroops — human USDC decimals → i128 stroops", () => {
  it("converts integer and fractional human units", () => {
    expect(toStroops("5")).toBe("50000000");
    expect(toStroops("5.5")).toBe("55000000");
    expect(toStroops("5.50")).toBe("55000000");
    expect(toStroops("10")).toBe("100000000");
  });

  it("truncates beyond the 7-decimal USDC limit", () => {
    expect(toStroops("0.0000001")).toBe("1");
    expect(toStroops("1.23456789")).toBe("12345678");
  });

  it("treats empty/garbage integer parts as zero", () => {
    expect(toStroops("")).toBe("0");
    expect(toStroops(".5")).toBe("5000000");
  });
});

describe("installAgentSession — admin-signed install envelope", () => {
  const params: InstallParams = {
    walletId: "CABC",
    sessionPubkeyHex: "ab".repeat(32),
    tokenAddress: "CUSDC",
    perTxCap: "50000000",
    windowSeconds: 86400,
    windowCap: "500000000",
    expiresAt: 2_000_000_000,
    allowRecipients: [],
    sslHash: ZERO_SSL,
  };

  it("returns the parsed install result on success", async () => {
    const result = { txHash: "abc123", walletId: "CABC", expiresAt: 2_000_000_000 };
    const post = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(result) });
    vi.stubGlobal("fetch", post);

    await expect(installAgentSession(params)).resolves.toEqual(result);
    expect(post).toHaveBeenCalledOnce();
    expect(JSON.parse(post.mock.calls[0]![1].body as string)).toEqual(params);
  });

  it("surfaces the server error message without throwing a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => JSON.stringify({ error: "out_of_surface_recipient" }) }));

    await expect(installAgentSession(params)).rejects.toThrow("out_of_surface_recipient");
  });

  it("falls back to a status-tagged error when the body carries no message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "" }));

    await expect(installAgentSession(params)).rejects.toThrow("install_failed_500");
  });
});
