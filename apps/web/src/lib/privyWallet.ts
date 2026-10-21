import { TransactionBuilder, FeeBumpTransaction, Networks, StrKey, xdr } from "@stellar/stellar-sdk";

const PASS: Record<string, string> = { TESTNET: Networks.TESTNET, PUBLIC: Networks.PUBLIC };

/** Stellar DecoratedSignature from a G... public key and a raw Ed25519 signature. */
export function decoratedSignatureFor(publicKey: string, signature: Buffer): xdr.DecoratedSignature {
  const raw = StrKey.decodeEd25519PublicKey(publicKey.trim()); // 32 bytes
  const hint = Buffer.from(raw.subarray(raw.length - 4)); // last 4 bytes, copied (no aliasing)
  return new xdr.DecoratedSignature({ hint, signature });
}

/** Attach a raw signature to an unsigned XDR; returns the signed XDR. Fee-bump not supported. */
export function attachSignature(
  xdrStr: string, network: "TESTNET" | "PUBLIC", publicKey: string, signature: Buffer,
): string {
  const tx = TransactionBuilder.fromXDR(xdrStr, PASS[network]!);
  if (tx instanceof FeeBumpTransaction) {
    throw new Error("attachSignature: fee-bump transactions não são suportadas");
  }
  tx.signatures.push(decoratedSignatureFor(publicKey, signature));
  return tx.toXDR();
}

/** Privy raw-sign over Ed25519. NOT unit-tested (network). Signs the hash already re-derived locally. */
export async function rawSignHash(privy: any, walletId: string, hash: Buffer): Promise<Buffer> {
  const { signature } = await privy.walletApi.rawSign({ walletId, hash: `0x${hash.toString("hex")}` });
  return Buffer.from(String(signature).replace(/^0x/, ""), "hex");
}
