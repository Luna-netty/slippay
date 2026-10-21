// Stellar adapter — wraps the existing lib/{wallet,stellar,soroban} with ZERO
// behavior change. The classic checkout (buildAtomicTx + Horizon submit) and the
// recurring allowance (Soroban approve) are exactly what shipped on mainnet; this
// only re-exposes them behind ChainAdapter so pages stop importing chain SDKs.

import { Asset, Networks, rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { connectWallet as stellarConnect, signTx } from "../../wallet.ts";
import {
  fetchSequence, submitSignedTx, buildAtomicTx,
  isValidStellarAddress, checkReceiveAddress,
} from "../../stellar.ts";
import { approveAllowance } from "../../soroban.ts";
import type {
  ChainAdapter, AddressCheck, OneTimePayArgs, ApproveArgs, PayResult,
} from "../types.ts";

function network(): "TESTNET" | "PUBLIC" {
  return ((import.meta.env.VITE_STELLAR_NETWORK ?? "TESTNET").toUpperCase()) as "TESTNET" | "PUBLIC";
}

// Recurring-authorization mechanics (SAC, RPC, spender contract) live here, not
// in the page — they are Stellar-specific. Mirrors what Sub.tsx used to compute.
const USDC_ISSUER: Record<"TESTNET" | "PUBLIC", string> = {
  TESTNET: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  PUBLIC:  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
};
const SOROBAN_RPC: Record<"TESTNET" | "PUBLIC", string> = {
  TESTNET: "https://soroban-testnet.stellar.org",
  PUBLIC:  "https://soroban-mainnet.stellar.org",
};
// Subscription contract = the SEP-41 spender. Mainnet = CBJMQ6ZY.
const SUB_CONTRACT = (import.meta.env.VITE_SUB_CONTRACT as string | undefined)
  ?? "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN";
const DEFAULT_DURATION_LEDGERS = 5_000_000; // ~9 months at ~5s/ledger

export const stellarAdapter: ChainAdapter = {
  id: "stellar",

  connectWallet: () => stellarConnect(),

  isValidAddress: (addr) => isValidStellarAddress(addr),

  checkReceiveAddress: (addr): Promise<AddressCheck> => checkReceiveAddress(network(), addr),

  async payOneTime(a: OneTimePayArgs): Promise<PayResult> {
    const net = network();
    const seq = await fetchSequence(net, a.buyerAddress);
    const xdr = await buildAtomicTx({
      buyerPublicKey: a.buyerAddress,
      buyerSequence: seq,
      merchantAddress: a.merchantAddress,
      platformAddress: a.platformAddress,
      usdcAmount: a.usdcAmount,
      platformFeeBp: a.platformFeeBp,
      memo: a.memoHex,
      network: net,
      maxTime: a.maxTime,
    });
    const signed = await signTx(xdr);
    return submitSignedTx(net, signed);
  },

  async approveRecurring(a: ApproveArgs): Promise<PayResult> {
    const net = network();
    const passphrase = net === "PUBLIC" ? Networks.PUBLIC : Networks.TESTNET;
    const rpcUrl = SOROBAN_RPC[net];
    const sac = new Asset("USDC", USDC_ISSUER[net]).contractId(passphrase);
    const server = new SorobanRpc.Server(rpcUrl);
    const { sequence } = await server.getLatestLedger();
    const ledgers = a.durationSecs ? Math.floor(a.durationSecs / 5) : DEFAULT_DURATION_LEDGERS;
    // Stellar USDC = 7 decimals (stroops).
    const amount = BigInt(Math.round(Number(a.capUsdc) * 1e7)).toString();
    const hash = await approveAllowance({
      sacAddress: sac,
      owner: a.buyerAddress,
      spender: SUB_CONTRACT,
      amount,
      expirationLedger: sequence + ledgers,
      rpcUrl,
    });
    return { hash };
  },
};
