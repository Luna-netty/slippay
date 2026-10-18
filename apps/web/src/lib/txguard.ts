import { TransactionBuilder, Networks, StrKey } from "@stellar/stellar-sdk";

const PASS: Record<string, string> = { TESTNET: Networks.TESTNET, PUBLIC: Networks.PUBLIC };

export interface OpSummary { type: string; destination?: string; amount?: string; assetCode?: string }
export interface TxSummary { source: string; fee: string; memo?: string; operations: OpSummary[] }

export function decodeTx(xdr: string, network: "TESTNET" | "PUBLIC"): TxSummary {
  const tx = TransactionBuilder.fromXDR(xdr, PASS[network]!) as any;
  const ops: OpSummary[] = (tx.operations ?? []).map((op: any) => {
    if (op.type === "payment") {
      return { type: "payment", destination: op.destination, amount: op.amount,
               assetCode: op.asset?.isNative?.() ? "XLM" : op.asset?.code };
    }
    return { type: op.type };
  });
  return {
    source: tx.source,
    fee: String(tx.fee),
    memo: (tx.memo && tx.memo.type === "text" && typeof tx.memo.value === "string") ? tx.memo.value : undefined,
    operations: ops,
  };
}

export function localHash(xdr: string, network: "TESTNET" | "PUBLIC"): Buffer {
  return TransactionBuilder.fromXDR(xdr, PASS[network]!).hash();
}

export function isValidStellarAddress(address: string): boolean {
  try { return StrKey.isValidEd25519PublicKey(address); } catch { return false; }
}

export function assertPaymentMatches(
  s: TxSummary,
  expect: { destination: string; amount: string; assetCode: string },
): void {
  const pays = s.operations.filter((o) => o.type === "payment");
  if (pays.length !== 1) {
    throw new Error(`guard: esperava exatamente 1 pagamento, encontrei ${pays.length}`);
  }
  const pay = pays[0]!;
  if (pay.destination !== expect.destination.trim()) {
    throw new Error(`guard: destino divergente (assinaria ${pay.destination}, esperado ${expect.destination})`);
  }
  if (pay.assetCode !== expect.assetCode) {
    throw new Error(`guard: ativo divergente (${pay.assetCode} vs ${expect.assetCode})`);
  }
  const got = Number(pay.amount);
  const want = Number(expect.amount);
  if (!Number.isFinite(got) || !Number.isFinite(want)) {
    throw new Error("guard: valor não numérico");
  }
  if (Math.abs(got - want) > 1e-7) {
    throw new Error(`guard: valor divergente (assinaria ${pay.amount}, esperado ${expect.amount})`);
  }
}
