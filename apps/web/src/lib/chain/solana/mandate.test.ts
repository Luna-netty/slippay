import { describe, it, expect, vi, beforeEach } from "vitest";

// Anchor is only needed to satisfy mandate.ts's top-level import; the pure
// derivation helpers and the class's account wiring are what we exercise. The
// Program is swapped for a controllable stub so `methods` can be inspected.
const anchor = vi.hoisted(() => ({ methods: {} as Record<string, any> }));

vi.mock("@coral-xyz/anchor", () => ({
  BN: class BN {
    constructor(public readonly value: unknown) {}
    toString(): string { return String(this.value); }
  },
  AnchorProvider: class AnchorProvider { constructor(..._a: unknown[]) {} },
  Program: class Program {
    methods = anchor.methods;
    constructor(..._a: unknown[]) {}
  },
}));

import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  mandatePda, orderIdFromHex, MANDATE_PROGRAM_ID, SlippayMandate, BN,
} from "./mandate.ts";

describe("orderIdFromHex", () => {
  it("decodes a 32-byte hex memo into 32 numbers", () => {
    const out = orderIdFromHex("00".repeat(31) + "ff");
    expect(out).toHaveLength(32);
    expect(out[0]).toBe(0);
    expect(out[31]).toBe(255);
  });

  it("accepts a 0x-prefixed memo", () => {
    expect(orderIdFromHex("0x" + "ab".repeat(32))).toEqual(new Array(32).fill(0xab));
  });

  it("rejects anything that is not 32-byte hex", () => {
    expect(() => orderIdFromHex("ab".repeat(31))).toThrow("order memo must be 32-byte hex");
    expect(() => orderIdFromHex("0x1234")).toThrow("order memo must be 32-byte hex");
    expect(() => orderIdFromHex("zz".repeat(32))).toThrow("order memo must be 32-byte hex");
  });
});

describe("mandatePda", () => {
  it("derives the documented seed [mandate, owner, mint] under the program id", () => {
    const owner = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("mandate"), owner.toBuffer(), mint.toBuffer()],
      MANDATE_PROGRAM_ID,
    );
    expect(mandatePda(owner, mint).equals(expected)).toBe(true);
  });

  it("is deterministic and mint-sensitive", () => {
    const owner = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    expect(mandatePda(owner, mint).equals(mandatePda(owner, mint))).toBe(true);
    expect(mandatePda(owner, mint).equals(mandatePda(owner, Keypair.generate().publicKey))).toBe(false);
  });
});

describe("SlippayMandate", () => {
  const owner = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;

  beforeEach(() => { anchor.methods = {}; });

  it("pda() is the same derivation as mandatePda", () => {
    const m = new SlippayMandate({} as never);
    expect(m.pda(owner, mint).equals(mandatePda(owner, mint))).toBe(true);
  });

  it("initMandate forwards the bounded-spend rules and returns the rpc signature", async () => {
    const rpc = vi.fn(async () => "INIT_SIG");
    const accounts = vi.fn(() => ({ rpc }));
    const initMandate = vi.fn(() => ({ accounts }));
    anchor.methods.initMandate = initMandate;

    const agent = Keypair.generate().publicKey;
    const rules = {
      agent,
      perPaymentCap: new BN(100),
      monthlyCap: new BN(1_000),
      periodSecs: new BN(2_592_000),
      allowed: [Keypair.generate().publicKey],
    };

    const m = new SlippayMandate({} as never);
    await expect(m.initMandate(owner, mint, rules)).resolves.toBe("INIT_SIG");
    expect(initMandate).toHaveBeenCalledWith(
      rules.agent, rules.perPaymentCap, rules.monthlyCap, rules.periodSecs, rules.allowed,
    );
    expect(accounts).toHaveBeenCalledWith({
      owner, mint, mandate: mandatePda(owner, mint), systemProgram: SystemProgram.programId,
    });
  });

  it("charge delegates to the agent and passes the mandate + token accounts", async () => {
    const rpc = vi.fn(async () => "CHARGE_SIG");
    const accounts = vi.fn(() => ({ rpc }));
    // Declare the parameter so mock.calls is [arg][] rather than the empty
    // tuple [] — the assertion below reads the amount off that argument.
    const charge = vi.fn((_: unknown) => ({ accounts }));
    anchor.methods.charge = charge;

    const agent = Keypair.generate().publicKey;
    const ownerToken = Keypair.generate().publicKey;
    const recipientToken = Keypair.generate().publicKey;

    const m = new SlippayMandate({} as never);
    await expect(
      m.charge({ owner, mint, agent, ownerToken, recipientToken, amount: new BN(500) }),
    ).resolves.toBe("CHARGE_SIG");

    expect(String(charge.mock.calls[0]![0])).toBe("500");
    expect(accounts).toHaveBeenCalledWith({
      agent, mandate: mandatePda(owner, mint), mint,
      ownerToken, recipientToken, tokenProgram: TOKEN_PROGRAM_ID,
    });
  });

  it("setPaused forwards the flag for the owner's mandate", async () => {
    const rpc = vi.fn(async () => "PAUSE_SIG");
    const accounts = vi.fn(() => ({ rpc }));
    const setPaused = vi.fn(() => ({ accounts }));
    anchor.methods.setPaused = setPaused;

    const m = new SlippayMandate({} as never);
    await expect(m.setPaused(owner, mint, true)).resolves.toBe("PAUSE_SIG");
    expect(setPaused).toHaveBeenCalledWith(true);
    expect(accounts).toHaveBeenCalledWith({ owner, mandate: mandatePda(owner, mint) });
  });
});