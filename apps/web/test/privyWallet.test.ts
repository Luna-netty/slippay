import { describe, it, expect } from "vitest";
import { Keypair, Account, Asset, Operation, TransactionBuilder, Networks, BASE_FEE } from "@stellar/stellar-sdk";
import { attachSignature } from "../src/lib/privyWallet.ts";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function unsigned(src: string): string {
  return new TransactionBuilder(new Account(src, "1"), {
    fee: BASE_FEE, networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: 0 },
  }).addOperation(Operation.payment({
      destination: "GC4HWUN3LGTPZTU3ET2COOBPSWEV6IZHPCWOJURPG6FD7KAX6OAGM6UZ",
      asset: new Asset("USDC", ISSUER), amount: "1",
    })).build().toXDR();
}

describe("attachSignature", () => {
  it("produces a tx whose signature hint matches the signer's key (matches native signing)", () => {
    const kp = Keypair.random();
    const xdr = unsigned(kp.publicKey());
    const hash = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC).hash();
    const rawSig = kp.sign(hash);
    const signedXdr = attachSignature(xdr, "PUBLIC", kp.publicKey(), rawSig);
    const signed = TransactionBuilder.fromXDR(signedXdr, Networks.PUBLIC);
    expect(signed.signatures.length).toBe(1);
    expect(signed.signatures[0]!.hint()!.equals(kp.signatureHint())).toBe(true);
  });

  it("the attached signature actually verifies against the tx hash", () => {
    const kp = Keypair.random();
    const xdr = unsigned(kp.publicKey());
    const tx = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC);
    const rawSig = kp.sign(tx.hash());
    const signed = TransactionBuilder.fromXDR(attachSignature(xdr, "PUBLIC", kp.publicKey(), rawSig), Networks.PUBLIC);
    expect(kp.verify(signed.hash(), signed.signatures[0]!.signature()!)).toBe(true);
  });

  it("rejects fee-bump transactions", () => {
    const kp = Keypair.random();
    const feeSource = Keypair.random();
    const inner = TransactionBuilder.fromXDR(unsigned(kp.publicKey()), Networks.PUBLIC);
    inner.sign(kp);
    const fb = TransactionBuilder.buildFeeBumpTransaction(feeSource, "200", inner as any, Networks.PUBLIC);
    expect(() => attachSignature(fb.toXDR(), "PUBLIC", kp.publicKey(), Buffer.alloc(64))).toThrow(/fee-bump/);
  });
});
