// /agents/connect — give an AI agent a bounded, revocable spending allowance on
// your smart wallet. The on-chain primitive is install_agent_session; this is the
// human-facing UX + handshake (AGENT_CONNECT_SPEC.md). Additive route — does NOT
// touch the marketing /agents page.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { loadAccount } from "../lib/account.ts";
import {
  generateSessionKey, normalizeSessionPubkey, parseConnectRequest,
  computeSslHash, installAgentSession, toStroops, ZERO_SSL,
  type ConnectRequest, type AgentSessionKey,
} from "../lib/agentSession.ts";

const USDC_SAC = (import.meta.env.VITE_USDC_SAC as string | undefined) ?? "";
const EXPIRY_OPTS = [
  { label: "24 hours", secs: 86_400 },
  { label: "7 days", secs: 604_800 },
  { label: "30 days", secs: 2_592_000 },
];

type State = "form" | "submitting" | "done" | "error";

export default function AgentConnect() {
  const [sp] = useSearchParams();
  const account = loadAccount();
  const req: ConnectRequest | null = useMemo(() => {
    const r = sp.get("req"); if (!r) return null;
    try { return parseConnectRequest(r); } catch { return null; }
  }, [sp]);

  // session key: from the agent's request, pasted, or generated here
  const [pubkey, setPubkey] = useState("");
  const [generated, setGenerated] = useState<AgentSessionKey | null>(null);
  const [perTx, setPerTx] = useState("5");
  const [daily, setDaily] = useState("50");
  const [expirySecs, setExpirySecs] = useState(604_800);
  const [recipients, setRecipients] = useState("");      // one per line; empty = any
  const [policy, setPolicy] = useState("");              // optional JSON → ssl_hash
  // value is only written (from the connect request), never rendered yet
  const [, setAgentName] = useState("");

  const [state, setState] = useState<State>("form");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txHash: string } | null>(null);

  useEffect(() => {
    if (!req) return;
    setPubkey(req.session_pubkey);
    setPerTx(req.requested.per_tx_cap);
    setDaily(req.requested.window_cap);
    setRecipients((req.requested.allow_recipients ?? []).join("\n"));
    setAgentName(req.agent?.name ?? "");
  }, [req]);

  function genKey() {
    const k = generateSessionKey();
    setGenerated(k); setPubkey(k.pubkeyHex);
  }

  async function authorize() {
    setError(null); setState("submitting");
    try {
      if (!account?.walletId) throw new Error("no wallet — create your account first");
      if (!USDC_SAC) throw new Error("VITE_USDC_SAC not configured (USDC token address)");
      const sessionPubkeyHex = normalizeSessionPubkey(pubkey);
      const allow = recipients.split("\n").map(s => s.trim()).filter(Boolean);
      const sslHash = policy.trim()
        ? await computeSslHash(JSON.parse(policy))
        : ZERO_SSL;
      const r = await installAgentSession({
        walletId: account.walletId,
        sessionPubkeyHex,
        tokenAddress: USDC_SAC,
        perTxCap: toStroops(perTx),
        windowSeconds: 86_400,
        windowCap: toStroops(daily),
        expiresAt: Math.floor(Date.now() / 1000) + expirySecs,
        allowRecipients: allow,
        sslHash,
      });
      setResult(r); setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "install failed"); setState("error");
    }
  }

  const ink = "#0a0a0a", bone = "#f1eee7", lime = "#C5F23B";

  return (
    <div style={{ minHeight: "100vh", background: bone, color: ink }} className="px-6 md:px-12 py-10">
      <header className="max-w-3xl mx-auto flex items-center justify-between mb-12">
        <Link to="/agents" className="font-semibold tracking-tight">slippay.</Link>
        <span className="text-[10px] uppercase tracking-[0.22em] opacity-55">Connect agent</span>
      </header>

      <main className="max-w-3xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[0.95] mb-4">
          Give an agent an allowance.
        </h1>
        <p className="text-base md:text-lg opacity-65 max-w-xl mb-10">
          It pays for you, within limits you set on-chain — and can never exceed them, or be
          unfrozen by us. Revoke anytime.
        </p>

        {req && (
          <div className="mb-8 border-l-2 pl-4" style={{ borderColor: lime }}>
            <div className="text-[10px] uppercase tracking-[0.18em] opacity-55">Connection request</div>
            <div className="text-lg font-medium mt-1">{req.agent?.name || "An agent"} wants a session</div>
            <div className="text-sm opacity-60">You can only tighten what it asked for. Nothing is auto-granted.</div>
          </div>
        )}

        {!account?.walletId && (
          <div className="mb-8 text-sm border-l-2 border-red-700 pl-3 text-red-700">
            No wallet on this device. <Link to="/pay" className="underline">Create your account</Link> first.
          </div>
        )}

        {/* agent key */}
        <Field label="Agent session key">
          <input value={pubkey} onChange={e => setPubkey(e.target.value)} placeholder="G… address or 64-hex pubkey"
            className="w-full bg-transparent border-b py-2 font-mono text-sm" style={{ borderColor: "#0a0a0a33" }} />
          <button onClick={genKey} className="mt-2 text-xs underline opacity-70">generate one for me</button>
          {generated && (
            <div className="mt-2 text-[11px] font-mono break-all p-2 rounded" style={{ background: "#0a0a0a", color: lime }}>
              SECRET (give to the agent, store in a KMS — never the human):<br />{generated.secret}
            </div>
          )}
        </Field>

        <div className="grid md:grid-cols-2 gap-6">
          <Field label="Per-transaction limit (USDC)">
            <input value={perTx} onChange={e => setPerTx(e.target.value)} inputMode="decimal"
              className="w-full bg-transparent border-b py-2 text-2xl tabular-nums" style={{ borderColor: "#0a0a0a33" }} />
          </Field>
          <Field label="Daily limit (USDC)">
            <input value={daily} onChange={e => setDaily(e.target.value)} inputMode="decimal"
              className="w-full bg-transparent border-b py-2 text-2xl tabular-nums" style={{ borderColor: "#0a0a0a33" }} />
          </Field>
        </div>

        <Field label="Expires">
          <div className="flex gap-2 mt-1">
            {EXPIRY_OPTS.map(o => (
              <button key={o.secs} onClick={() => setExpirySecs(o.secs)}
                className="px-4 py-2 text-sm border rounded"
                style={{ borderColor: expirySecs === o.secs ? lime : "#0a0a0a22", background: expirySecs === o.secs ? lime : "transparent" }}>
                {o.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Allowed recipients (one per line · empty = any, within budget)">
          <textarea value={recipients} onChange={e => setRecipients(e.target.value)} rows={3}
            placeholder="G… / C…  (leave blank to allow any recipient within the limits)"
            className="w-full bg-transparent border p-3 font-mono text-xs rounded" style={{ borderColor: "#0a0a0a22" }} />
        </Field>

        <details className="mb-8">
          <summary className="text-sm opacity-70 cursor-pointer">Advanced · bind a policy (ssl_hash)</summary>
          <Field label="Policy JSON (hashed → ssl_hash, bound to the session on-chain)">
            <textarea value={policy} onChange={e => setPolicy(e.target.value)} rows={4}
              placeholder='{"purpose":"buy x402 API calls","max_per_day":"50"}'
              className="w-full bg-transparent border p-3 font-mono text-xs rounded" style={{ borderColor: "#0a0a0a22" }} />
          </Field>
        </details>

        {state === "done" && result ? (
          <div className="border-l-2 pl-4" style={{ borderColor: lime }}>
            <div className="text-[10px] uppercase tracking-[0.18em]">Session granted</div>
            <a className="text-xs font-mono mt-1 block break-all hover:opacity-60"
               href={`https://stellar.expert/explorer/testnet/tx/${result.txHash}`} target="_blank" rel="noreferrer">
              {result.txHash}
            </a>
          </div>
        ) : (
          <button onClick={authorize} disabled={state === "submitting" || !pubkey || !account?.walletId}
            className="w-full py-5 text-sm uppercase tracking-[0.18em] disabled:opacity-40"
            style={{ background: ink, color: bone }}>
            {state === "submitting" ? "Authorizing…" : "Authorize with Face ID"}
          </button>
        )}
        {error && <div className="mt-4 text-xs uppercase tracking-[0.18em] text-red-700 border-l-2 border-red-700 pl-3">{error}</div>}

        <p className="mt-10 text-[11px] opacity-45 leading-relaxed">
          Testnet · v0.1. The install is admin-signed today (M6 admin pattern); the Face-ID-signed
          path lands with the v0.2 admin→passkey migration. The agent holds its session key; the
          contract enforces the caps + allowlist on-chain via <code>__check_auth</code>.
        </p>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="text-[10px] uppercase tracking-[0.18em] opacity-55 mb-1">{label}</div>
      {children}
    </div>
  );
}
