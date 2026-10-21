// Browser-side Soroban contract settlement — the piece the classic checkout
// path (lib/stellar.ts `buildAtomicTx` + `submitSignedTx`) does NOT cover.
//
// The classic path builds a 2-op CLASSIC payment and submits via Horizon.
// A Soroban contract.charge(id) is different: it needs simulate → assemble →
// sign → submit via the Soroban RPC (Horizon won't take the assembled
// invokeHostFunction the same way). The unsigned, already-assembled XDR comes
// from the API (`POST /v1/subscriptions/:id/onchain-charge` → buildChargeTransaction),
// which simulated it against the buyer's account. Here we only sign + submit + poll.
//
// This is the rail proven on mainnet via scripts/e2e-subscription-charge-mainnet.mjs
// (charge tx 5da9741f… , 2026-06-03), now reachable from a browser wallet.

import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { signTx } from "./wallet.ts";

export interface SorobanChargeResult {
  hash: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  nextDueAt?: number;
}

/**
 * Sign an unsigned (already-assembled, already-simulated) Soroban charge XDR
 * with the connected wallet and submit it via the Soroban RPC.
 *
 * @param unsignedXdr  assembled XDR from the API's onchain-charge endpoint
 * @param rpcUrl       Soroban RPC url returned alongside the XDR
 * @param passphrase   network passphrase the XDR was built for
 */
export async function signAndSubmitContractCharge(
  unsignedXdr: string,
  rpcUrl: string,
): Promise<SorobanChargeResult> {
  // 1. Buyer signs the assembled tx with their wallet (Freighter/Lobstr/xBull/…).
  //    signTx() uses the kit's configured network passphrase.
  const signedXdr = await signTx(unsignedXdr);

  // 2. Submit via Soroban RPC (NOT Horizon — this carries a Soroban footprint).
  const server = new SorobanRpc.Server(rpcUrl);
  const { TransactionBuilder, Networks } = await import("@stellar/stellar-sdk");
  const network = (import.meta.env.VITE_STELLAR_NETWORK ?? "TESTNET").toUpperCase();
  const passphrase = network === "PUBLIC" ? Networks.PUBLIC : Networks.TESTNET;
  const signed = TransactionBuilder.fromXDR(signedXdr, passphrase);

  const sent = await server.sendTransaction(signed);
  if (sent.status === "ERROR") {
    throw new Error(`soroban_send_error: ${JSON.stringify(sent.errorResult ?? sent)}`);
  }

  // 3. Poll for the final result.
  let res = await server.getTransaction(sent.hash);
  for (let i = 0; i < 40 && res.status === "NOT_FOUND"; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await server.getTransaction(sent.hash);
  }

  if (res.status === "SUCCESS") {
    let nextDueAt: number | undefined;
    try {
      // charge() returns u64 = next_due_at
      if (res.returnValue) nextDueAt = Number(res.returnValue.u64().toString());
    } catch { /* best-effort */ }
    return { hash: sent.hash, status: "SUCCESS", nextDueAt };
  }
  return { hash: sent.hash, status: res.status === "NOT_FOUND" ? "PENDING" : "FAILED" };
}

/**
 * Ask the API to build the unsigned on-chain charge for a subscription, bound to
 * the connected buyer wallet. Returns the assembled XDR + rpc url to sign+submit.
 *
 * NOTE on auth: `/v1/subscriptions/:id/onchain-charge` is merchant-authed. For a
 * customer-facing checkout the key cannot live in the browser — productionizing
 * this needs a public, checkout-token-gated variant (mirroring the public order
 * fetch). For the demo flow a scoped demo merchant key is acceptable (same pattern
 * as createDemoOrder in lib/api.ts).
 */
export interface UnsignedCharge {
  unsigned_xdr: string;
  rpc_url: string;
  passphrase: string;
  contract_id: string;
  simulation_ok: boolean;
  simulation_error?: string;
  next_due_at?: number;
}

/**
 * The ONE signature that enables autonomous recurring debit: the buyer approves
 * the subscription contract as a SEP-41 spender on the token, up to `amount`
 * until `expirationLedger`. After this, the scheduler can call autocharge(id)
 * each period with no further buyer signature (proven on testnet 2026-06-03,
 * autocharge tx 40e19a7a…). Built + simulated + signed client-side via wallet-kit.
 */
export async function approveAllowance(opts: {
  sacAddress: string;
  owner: string;
  spender: string;
  amount: string;        // stroops (i128)
  expirationLedger: number;
  rpcUrl: string;
}): Promise<string> {
  const sdk = await import("@stellar/stellar-sdk");
  const { Contract, TransactionBuilder, Networks, nativeToScVal, Address } = sdk;
  const server = new SorobanRpc.Server(opts.rpcUrl);
  const network = (import.meta.env.VITE_STELLAR_NETWORK ?? "TESTNET").toUpperCase();
  const passphrase = network === "PUBLIC" ? Networks.PUBLIC : Networks.TESTNET;

  const account = await server.getAccount(opts.owner);
  const c = new Contract(opts.sacAddress);
  const tx = new TransactionBuilder(account, { fee: "1000000", networkPassphrase: passphrase })
    .addOperation(c.call(
      "approve",
      new Address(opts.owner).toScVal(),
      new Address(opts.spender).toScVal(),
      nativeToScVal(BigInt(opts.amount), { type: "i128" }),
      nativeToScVal(opts.expirationLedger, { type: "u32" }),
    ))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(`approve_sim_failed: ${sim.error}`);
  const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
  const signedXdr = await signTx(assembled.toXDR());
  const sent = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr, passphrase));
  if (sent.status === "ERROR") throw new Error(`approve_send_error: ${JSON.stringify(sent.errorResult ?? sent)}`);
  let res = await server.getTransaction(sent.hash);
  for (let i = 0; i < 40 && res.status === "NOT_FOUND"; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await server.getTransaction(sent.hash);
  }
  if (res.status !== "SUCCESS") throw new Error(`approve_tx_${res.status.toLowerCase()}`);
  return sent.hash;
}

export async function requestOnchainCharge(
  apiBase: string,
  subscriptionId: string,
  buyerAddress: string,
  merchantApiKey: string,
): Promise<UnsignedCharge> {
  const r = await fetch(`${apiBase}/v1/subscriptions/${subscriptionId}/onchain-charge`, {
    method: "POST",
    headers: { authorization: `Bearer ${merchantApiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ buyer_address: buyerAddress }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body?.detail ?? body?.error ?? `onchain_charge_${r.status}`);
  const oc = body.onchain_charge as UnsignedCharge;
  if (!oc?.simulation_ok) throw new Error(`simulation_failed: ${oc?.simulation_error ?? "unknown"}`);
  return oc;
}
