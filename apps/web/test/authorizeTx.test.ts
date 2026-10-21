import { describe, it, expect, vi } from "vitest";
import { Keypair, Account, Asset, Operation, TransactionBuilder, Networks, BASE_FEE } from "@stellar/stellar-sdk";
import { authorizePayment } from "../src/lib/authorizeTx.ts";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const DEST = "GC4HWUN3LGTPZTU3ET2COOBPSWEV6IZHPCWOJURPG6FD7KAX6OAGM6UZ";

function unsigned(src: string, amount: string): string {
  return new TransactionBuilder(new Account(src, "1"), {
    fee: BASE_FEE, networkPassphrase: Networks.PUBLIC, timebounds: { minTime: 0, maxTime: 0 },
  }).addOperation(Operation.payment({ destination: DEST, asset: new Asset("USDC", ISSUER), amount }))
    .build().toXDR();
}

describe("authorizePayment", () => {
  it("aborts before signing when the decoded destination does not match expected", async () => {
    const kp = Keypair.random();
    const signHash = vi.fn();
    await expect(authorizePayment({
      xdr: unsigned(kp.publicKey(), "100"), network: "PUBLIC", publicKey: kp.publicKey(), signHash,
      confirm: async () => true,
      expect: { destination: "GBBKIN4ZQWJUND63GSFEXLKZFLXZ3J265FPGYKPLGXA34QYSAFFC3C5X", amount: "100", assetCode: "USDC" },
    })).rejects.toThrow(/destino divergente/);
    expect(signHash).not.toHaveBeenCalled();
  });

  it("aborts when the human rejects the confirmation (never signs)", async () => {
    const kp = Keypair.random();
    const signHash = vi.fn();
    await expect(authorizePayment({
      xdr: unsigned(kp.publicKey(), "5"), network: "PUBLIC", publicKey: kp.publicKey(), signHash,
      confirm: async () => false,
      expect: { destination: DEST, amount: "5", assetCode: "USDC" },
    })).rejects.toThrow(/cancelad/i);
    expect(signHash).not.toHaveBeenCalled();
  });
});
