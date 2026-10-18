// Company treasury overview — the post-login landing for a comex merchant.
// REAL data: USDC balance + USDC transfers pulled live from Base (Blockscout),
// filtered to the canonical USDC contract so address-poisoning scam tokens
// (fake "USDC" lookalikes) never appear. Bone skin, pure-SVG chart.
import { useEffect, useState } from "react";
import { useComexBaseWallet } from "../../../lib/comexBase.tsx";
import { publicClient, usdcAddress, fromBaseUnits } from "../../../lib/chain/base/usdc.ts";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // canonical USDC on Base
const SCAN = "https://base.blockscout.com";

type Tx = { dir: "in" | "out"; amount: number; counter: string; ts: number; hash: string };

const ERC20_BALANCE_OF = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const;

const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ago = (ts: number) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const lbl = "text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/55 font-semibold";
const card = "bg-white border border-[#0a0a0a]/10 rounded-2xl p-5";
const big = "text-[30px] font-extrabold tracking-tight mt-2 tabular-nums";

export default function BaseOverview() {
  const { address } = useComexBaseWallet();
  const [txs, setTxs] = useState<Tx[] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!address) return;
    let on = true;
    publicClient.readContract({ address: usdcAddress(), abi: ERC20_BALANCE_OF, functionName: "balanceOf", args: [address] })
      .then((raw) => { if (on) setBalance(Number(fromBaseUnits(raw as bigint))); }).catch(() => {});
    fetch(`${SCAN}/api/v2/addresses/${address}/token-transfers?token=${USDC}`)
      .then((r) => r.json())
      .then((d) => {
        if (!on) return;
        const items = (d.items || []).map((t: Record<string, unknown>): Tx => {
          const tot = (t.total || {}) as { value?: string; decimals?: string };
          const dec = Number(tot.decimals || 6);
          const amount = tot.value ? Number(tot.value) / 10 ** dec : 0;
          const from = ((t.from || {}) as { hash?: string }).hash || "";
          const to = ((t.to || {}) as { hash?: string }).hash || "";
          const dir: "in" | "out" = from.toLowerCase() === address.toLowerCase() ? "out" : "in";
          return { dir, amount, counter: dir === "out" ? to : from, ts: new Date(String(t.timestamp)).getTime(), hash: String(t.transaction_hash) };
        });
        setTxs(items.filter((t: Tx) => t.amount > 0));
      })
      .catch(() => setTxs([]));
    return () => { on = false; };
  }, [address]);

  const received = (txs || []).filter((t) => t.dir === "in").reduce((a, t) => a + t.amount, 0);
  const sent = (txs || []).filter((t) => t.dir === "out").reduce((a, t) => a + t.amount, 0);
  const count = (txs || []).length;

  // cumulative balance over time (oldest → newest) for the area chart
  const chrono = [...(txs || [])].sort((a, b) => a.ts - b.ts);
  let run = 0;
  const series = chrono.map((t) => (run += t.dir === "in" ? t.amount : -t.amount));
  const W = 760, H = 200, pad = 12;
  const max = Math.max(0.001, ...series) * 1.2;
  const x = (i: number) => pad + (series.length <= 1 ? W - 2 * pad : i * ((W - 2 * pad) / (series.length - 1)));
  const y = (v: number) => H - pad - (Math.max(0, v) / max) * (H - 2 * pad);
  let dPath = series.length ? `M${x(0)} ${y(series[0]!)}` : "";
  for (let i = 1; i < series.length; i++) dPath += ` L${x(i)} ${y(series[i]!)}`;
  const area = series.length ? `${dPath} L${x(series.length - 1)} ${H - pad} L${x(0)} ${H - pad} Z` : "";

  const inflowPct = received + sent > 0 ? (received / (received + sent)) * 100 : 50;

  return (
    <div className="md:col-span-12 w-full">
      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div>
          <div className="text-[27px] font-extrabold tracking-tight flex items-center gap-2.5">
            Treasury overview <span className="text-[9px] font-extrabold tracking-[0.12em] text-[#2f8f3e] border border-[#2f8f3e] rounded px-1.5 py-0.5">● LIVE</span>
          </div>
          <div className="text-[11px] text-[#0a0a0a]/50 mt-1.5">USDC on Base · live from chain {txs === null ? "· loading…" : ""}</div>
        </div>
        <a href={`${SCAN}/address/${address}`} target="_blank" rel="noreferrer" className="bg-[#FDDA24] text-[#0a0a0a] font-extrabold text-[12px] rounded-lg px-3.5 py-2 no-underline">View on explorer ↗</a>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className={[card, "ring-2 ring-[#FDDA24]"].join(" ")}><div className={lbl}>USDC balance</div><div className={big}>{balance === null ? "—" : `$${usd(balance)}`}</div><div className="text-[11px] mt-1.5 text-[#0a0a0a]/50">on Base · non-custodial</div></div>
        <div className={card}><div className={lbl}>Total received</div><div className={big}>{txs === null ? "—" : `$${usd(received)}`}</div><div className="text-[11px] mt-1.5 text-[#0a0a0a]/50">inflows · USDC</div></div>
        <div className={card}><div className={lbl}>Total sent</div><div className={big}>{txs === null ? "—" : `$${usd(sent)}`}</div><div className="text-[11px] mt-1.5 text-[#0a0a0a]/50">outflows · USDC</div></div>
        <div className={card}><div className={lbl}>Transactions</div><div className={big}>{txs === null ? "—" : count}</div><div className="text-[11px] mt-1.5 text-[#0a0a0a]/50">on-chain · scam-filtered</div></div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <div className={[card, "lg:col-span-2"].join(" ")}>
          <div className={lbl}>Balance over time</div>
          <div className="text-[22px] font-extrabold mt-1 tabular-nums">{balance === null ? "—" : `$${usd(balance)}`}</div>
          <svg viewBox="0 0 760 200" width="100%" height="200" className="mt-2">
            <defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b5e853" stopOpacity="0.5" /><stop offset="1" stopColor="#b5e853" stopOpacity="0" /></linearGradient></defs>
            {area && <path d={area} fill="url(#vg)" />}
            {dPath && <path d={dPath} fill="none" stroke="#0a0a0a" strokeWidth="2.2" />}
            {series.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="#0a0a0a" />)}
          </svg>
        </div>
        <div className={card}>
          <div className={lbl}>Inflow vs outflow</div>
          <div className="flex items-center gap-4 mt-4">
            <svg viewBox="0 0 140 140" width="140" height="140">
              <circle cx="70" cy="70" r="52" fill="none" stroke="#0a0a0a" strokeWidth="18" />
              <circle cx="70" cy="70" r="52" fill="none" stroke="#b5e853" strokeWidth="18" strokeDasharray={`${(inflowPct / 100) * 327} 327`} transform="rotate(-90 70 70)" />
            </svg>
            <div className="text-[12px] leading-[2.1] flex-1">
              <div><span className="inline-block w-3.5 h-3.5 rounded-full align-middle mr-1.5 bg-[#b5e853]" />Received <b className="float-right">${usd(received)}</b></div>
              <div className="mt-2.5"><span className="inline-block w-3.5 h-3.5 rounded-full align-middle mr-1.5 bg-[#0a0a0a]" />Sent <b className="float-right">${usd(sent)}</b></div>
            </div>
          </div>
        </div>
      </div>

      <div className={card}>
        <div className="flex justify-between items-center mb-1"><div className={lbl}>Recent transactions</div><span className="text-[#0a0a0a]/50 text-[11px]">USDC · Base · real</span></div>
        <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full min-w-[560px] text-[12.5px]">
          <thead><tr>{["Direction", "Counterparty", "Amount", "Status", "Time", "Tx"].map((h) => <th key={h} className="text-left text-[#0a0a0a]/50 text-[10px] uppercase tracking-[0.12em] font-semibold pb-3 px-2">{h}</th>)}</tr></thead>
          <tbody>
            {txs === null && <tr><td className="py-4 px-2 text-[#0a0a0a]/40" colSpan={6}>Loading from chain…</td></tr>}
            {txs && txs.length === 0 && <tr><td className="py-4 px-2 text-[#0a0a0a]/40" colSpan={6}>No USDC transactions yet.</td></tr>}
            {(txs || []).map((t) => (
              <tr key={t.hash} className="border-t border-[#0a0a0a]/10">
                <td className="py-3 px-2"><span className={["text-[10px] font-extrabold rounded-full px-2.5 py-1", t.dir === "in" ? "text-[#2f8f3e] border border-[#2f8f3e]/40 bg-[#b5e853]/25" : "text-[#0a0a0a] border border-[#0a0a0a]/20 bg-[#0a0a0a]/5"].join(" ")}>{t.dir === "in" ? "↓ received" : "↑ sent"}</span></td>
                <td className="py-3 px-2 font-mono text-[#0a0a0a]/55">{t.counter.slice(0, 8)}…{t.counter.slice(-4)}</td>
                <td className="py-3 px-2 font-extrabold font-mono">${usd(t.amount)}<small className="block text-[#0a0a0a]/50 font-semibold text-[10px]">{t.amount.toFixed(2)} USDC</small></td>
                <td className="py-3 px-2"><span className="text-[10px] font-extrabold text-[#2f8f3e]">✓ confirmed</span></td>
                <td className="py-3 px-2 text-[#0a0a0a]/50">{ago(t.ts)}</td>
                <td className="py-3 px-2"><a className="font-mono text-[#0a0a0a]/45 hover:text-[#0a0a0a] no-underline" href={`${SCAN}/tx/${t.hash}`} target="_blank" rel="noreferrer">{t.hash.slice(0, 8)}… ↗</a></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
