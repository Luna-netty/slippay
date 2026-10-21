// slippay_mandate client — ported from ~/projects/slippay-solana/sdk/mandate.ts
// (canonical source). Wallet-agnostic: any Anchor-compatible wallet plugs in via
// the provider (the biometric passkey/relayer signer in the browser; a Keypair
// in Node). Program proven on Solana: 5/5 bounded-autonomy tests green (2026-06-17).

import { AnchorProvider, Program, BN, type Idl } from "@coral-xyz/anchor";
import {
  Connection, PublicKey, SystemProgram, type TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import idlJson from "./idl/slippay_mandate.json";

export const MANDATE_PROGRAM_ID = new PublicKey(
  "CmDKY8MxCWkCN9etSeKApHKnGuTKK6vn7qzhTkAtM9Bv",
);

const SEED = Buffer.from("mandate");

type MethodBuilder = (...args: unknown[]) => { accounts(a: unknown): { rpc(): Promise<string> } };

/** Mandate PDA for owner + mint. Pure derivation — no provider/network needed. */
export function mandatePda(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEED, owner.toBuffer(), mint.toBuffer()],
    MANDATE_PROGRAM_ID,
  )[0];
}

// Read-only provider just to build instructions (signing is done by the bound
// wallet, e.g. LazorKit). The stub wallet is never asked to sign.
function readProvider(connection: Connection, payer: PublicKey): AnchorProvider {
  const stub = {
    publicKey: payer,
    signTransaction: async <T>(t: T) => t,
    signAllTransactions: async <T>(t: T[]) => t,
  };
  return new AnchorProvider(connection, stub as unknown as AnchorProvider["wallet"], { commitment: "confirmed" });
}

/** Build the single pay_split instruction for a one-time checkout. The buyer
 *  (payer) is the authority; merchant + platform token accounts must already
 *  exist (guarded at onboarding via checkReceiveAddress). One instruction → one
 *  CPI for a single-CPI smart wallet (LazorKit). */
export async function buildPaySplitIx(connection: Connection, a: {
  payer: PublicKey; mint: PublicKey; payerToken: PublicKey;
  merchantToken: PublicKey; platformToken: PublicKey; amount: BN; feeBp: number;
  orderId: number[]; // 32 bytes — binds the payment to the order (on-chain event)
}): Promise<TransactionInstruction> {
  if (a.orderId.length !== 32) throw new Error("orderId must be 32 bytes");
  const program = new Program(idlJson as Idl, readProvider(connection, a.payer));
  // methods is IDL-runtime-typed; cast to reach paySplit + instruction().
  const methods = program.methods as unknown as {
    paySplit(amount: BN, feeBp: number, orderId: number[]): { accounts(a: unknown): { instruction(): Promise<TransactionInstruction> } };
  };
  return methods.paySplit(a.amount, a.feeBp, a.orderId).accounts({
    payer: a.payer, mint: a.mint,
    payerToken: a.payerToken, merchantToken: a.merchantToken, platformToken: a.platformToken,
    tokenProgram: TOKEN_PROGRAM_ID,
  }).instruction();
}

/** 32-byte hex (the order memo) → number[32] for the program's order_id arg. */
export function orderIdFromHex(hex: string): number[] {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length !== 64 || !/^[0-9a-fA-F]+$/.test(h)) throw new Error("order memo must be 32-byte hex");
  const out: number[] = [];
  for (let i = 0; i < 64; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  return out;
}

export interface MandateRules {
  agent: PublicKey;
  perPaymentCap: BN;   // base units (USDC = 6 decimals)
  monthlyCap: BN;
  periodSecs: BN;      // e.g. 2_592_000 (30d)
  allowed: PublicKey[]; // recipient owners on the allowlist (<= 8)
}

export class SlippayMandate {
  readonly program: Program;
  constructor(provider: AnchorProvider) {
    this.program = new Program(idlJson as Idl, provider);
  }

  // Anchor types methods loosely under a generic Idl; narrow to named builders
  // (named props avoid noUncheckedIndexedAccess making them possibly-undefined).
  private get methods(): {
    initMandate: MethodBuilder;
    charge: MethodBuilder;
    setPaused: MethodBuilder;
  } {
    return this.program.methods as never;
  }

  /** PDA for a given owner + mint. */
  pda(owner: PublicKey, mint: PublicKey): PublicKey {
    return mandatePda(owner, mint);
  }

  /** Owner creates the mandate (delegates bounded spend to `agent`). */
  async initMandate(owner: PublicKey, mint: PublicKey, r: MandateRules): Promise<string> {
    const mandate = this.pda(owner, mint);
    return this.methods
      .initMandate(r.agent, r.perPaymentCap, r.monthlyCap, r.periodSecs, r.allowed)
      .accounts({ owner, mint, mandate, systemProgram: SystemProgram.programId })
      .rpc();
  }

  /** Agent charges `amount` to a recipient token account. Fail-closed on rules. */
  async charge(opts: {
    owner: PublicKey; mint: PublicKey; agent: PublicKey;
    ownerToken: PublicKey; recipientToken: PublicKey; amount: BN;
  }): Promise<string> {
    const mandate = this.pda(opts.owner, opts.mint);
    return this.methods.charge(opts.amount).accounts({
      agent: opts.agent, mandate, mint: opts.mint,
      ownerToken: opts.ownerToken, recipientToken: opts.recipientToken,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
  }

  async setPaused(owner: PublicKey, mint: PublicKey, paused: boolean): Promise<string> {
    return this.methods.setPaused(paused)
      .accounts({ owner, mandate: this.pda(owner, mint) }).rpc();
  }
}

export { BN, PublicKey };
