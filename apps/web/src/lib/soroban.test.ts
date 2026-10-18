import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// wallet.ts initializes the browser wallet-kit at import time — stub it out so
// the module can be loaded in the node test environment.
vi.mock("./wallet.ts", () => ({ signTx: vi.fn(async (xdr: string) => xdr) }));

import { signTx } from "./wallet.ts";
import {
  requestOnchainCharge,
  signAndSubmitContractCharge,
  approveAllowance,
} from "./soroban.ts";
import {
  rpc as SorobanRpc,
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

const PASSPHRASE = Networks.TESTNET;
const SAC = Asset.native().contractId(PASSPHRASE);

type InvokeOp = {
  type: string;
  func: { invokeContract: () => { functionName: () => { toString: () => string }; args: () => unknown[] } };
};

const invokeOf = (tx: { operations: InvokeOp[] }) => tx.operations[0]!.func.invokeContract();

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(signTx).mockImplementation(async (value: string) => value);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function buildChargeXdr(): string {
  const account = new Account(Keypair.random().publicKey(), "1");
  return new TransactionBuilder(account, { fee: "1000000", networkPassphrase: PASSPHRASE })
    .addOperation(
      new Contract(SAC).call(
        "charge",
        nativeToScVal("sub-1", { type: "string" }),
        nativeToScVal(BigInt(123), { type: "i128" }),
      ),
    )
    .setTimeout(60)
    .build()
    .toXDR();
}

// A pre-parsed, successful Soroban simulation — enough for the SDK's real
// assembleTransaction to attach the footprint and resource fee.
function successfulSim() {
  return {
    _parsed: true,
    latestLedger: 100,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: "1000",
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
    events: [],
  };
}

describe("requestOnchainCharge — API → unsigned XDR", () => {
  it("POSTs buyer_address and returns the assembled charge", async () => {
    const oc = {
      unsigned_xdr: "AAAA",
      rpc_url: "https://rpc.example",
      passphrase: "Test SDF Network ; September 2015",
      contract_id: SAC,
      simulation_ok: true,
      next_due_at: 42,
    };
    const post = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ onchain_charge: oc }) });
    vi.stubGlobal("fetch", post);

    await expect(requestOnchainCharge("https://api.example", "sub1", "GBUYER", "sk_live_key")).resolves.toEqual(oc);

    const [url, opts] = post.mock.calls[0]! as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.example/v1/subscriptions/sub1/onchain-charge");
    expect(opts.method).toBe("POST");
    expect(opts.headers.authorization).toBe("Bearer sk_live_key");
    expect(JSON.parse(opts.body)).toEqual({ buyer_address: "GBUYER" });
  });

  it("throws the API detail on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: "subscription_not_found" }) }));

    await expect(requestOnchainCharge("https://api.example", "nope", "GBUYER", "k")).rejects.toThrow("subscription_not_found");
  });

  it("rejects an un-simulated charge rather than signing garbage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ onchain_charge: { simulation_ok: false, simulation_error: "host trap" } }),
    }));

    await expect(requestOnchainCharge("https://api.example", "sub1", "GBUYER", "k")).rejects.toThrow(/simulation_failed: host trap/);
  });
});

describe("signAndSubmitContractCharge — sign, submit, poll", () => {
  it("submits the assembled XDR and decodes the operation it carries", async () => {
    const unsignedXdr = buildChargeXdr();
    const send = vi.spyOn(SorobanRpc.Server.prototype, "sendTransaction")
      .mockResolvedValue({ status: "PENDING", hash: "deadbeef" } as never);
    vi.spyOn(SorobanRpc.Server.prototype, "getTransaction")
      .mockResolvedValue({ status: "SUCCESS", returnValue: xdr.ScVal.scvU64(xdr.Uint64.fromString("777")) } as never);

    const res = await signAndSubmitContractCharge(unsignedXdr, "https://rpc.example");

    expect(res).toEqual({ hash: "deadbeef", status: "SUCCESS", nextDueAt: 777 });
    expect(signTx).toHaveBeenCalledWith(unsignedXdr);

    // Decode the submitted envelope: assert on the decoded operation, not the raw XDR.
    const submitted = send.mock.calls[0]![0] as unknown as { operations: InvokeOp[] };
    const invoke = invokeOf(submitted);
    expect(invoke.functionName().toString()).toBe("charge");
    expect(invoke.args().map((a) => scValToNative(a as never))).toEqual(["sub-1", 123n]);
  });

  it("throws a tagged error when the RPC rejects the submit", async () => {
    vi.spyOn(SorobanRpc.Server.prototype, "sendTransaction")
      .mockResolvedValue({ status: "ERROR", errorResult: { code: "txMalformed" } } as never);

    await expect(signAndSubmitContractCharge(buildChargeXdr(), "https://rpc.example")).rejects.toThrow(/soroban_send_error/);
  });
});

describe("approveAllowance — SEP-41 approve invocation", () => {
  const owner = Keypair.random().publicKey();
  const spender = Keypair.random().publicKey();

  function primeServer(hash = "approvehash") {
    vi.spyOn(SorobanRpc.Server.prototype, "getAccount").mockResolvedValue(new Account(owner, "1") as never);
    vi.spyOn(SorobanRpc.Server.prototype, "simulateTransaction").mockResolvedValue(successfulSim() as never);
    vi.spyOn(SorobanRpc.Server.prototype, "sendTransaction").mockResolvedValue({ status: "PENDING", hash } as never);
    vi.spyOn(SorobanRpc.Server.prototype, "getTransaction").mockResolvedValue({ status: "SUCCESS" } as never);
  }

  it("builds an approve call with (owner, spender, i128 amount, u32 expiry) in ABI order", async () => {
    primeServer();

    const hash = await approveAllowance({
      sacAddress: SAC,
      owner,
      spender,
      amount: "50000000",
      expirationLedger: 3600,
      rpcUrl: "https://rpc.example",
    });

    expect(hash).toBe("approvehash");

    const signedXdr = vi.mocked(signTx).mock.calls.at(-1)![0];
    const parsed = TransactionBuilder.fromXDR(signedXdr, PASSPHRASE) as unknown as { operations: InvokeOp[] };
    const invoke = invokeOf(parsed);

    expect(invoke.functionName().toString()).toBe("approve");
    const args = invoke.args().map((a) => scValToNative(a as never));
    expect(args[0]).toBe(new Address(owner).toString());
    expect(args[1]).toBe(new Address(spender).toString());
    expect(typeof args[2]).toBe("bigint");
    expect(args[2]).toBe(50000000n);
    expect(typeof args[3]).toBe("number");
    expect(args[3]).toBe(3600);
  });

  it("rejects a malformed address before building any invocation", async () => {
    primeServer();

    await expect(
      approveAllowance({
        sacAddress: SAC,
        owner: "not-an-address",
        spender,
        amount: "1",
        expirationLedger: 1,
        rpcUrl: "https://rpc.example",
      }),
    ).rejects.toThrow();

    expect(signTx).not.toHaveBeenCalled();
    expect(SorobanRpc.Server.prototype.sendTransaction).not.toHaveBeenCalled();
  });
});
