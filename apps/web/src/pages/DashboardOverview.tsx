import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authFetch } from "../lib/apiAuth.ts";
import { CountUp } from "../components/CountUp.tsx";
import { LiveProof } from "../components/LiveProof.tsx";

const display = { fontFamily: "'DM Sans', sans-serif" } as const;
const EXPLORER_BASE =
  (import.meta.env.VITE_STELLAR_NETWORK ?? "TESTNET").toUpperCase() === "PUBLIC"
    ? "https://stellar.expert/explorer/public/tx"
    : "https://stellar.expert/explorer/testnet/tx";

interface OrderRow {
  id: string; usdc_amount: string; status: string; created_at: string; tx_hash: string | null;
}

export default function DashboardOverview() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [subs, setSubs] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await authFetch("/v1/orders");
        const j = await r.json();
        if (alive) setOrders(j.orders ?? []);
      } catch { if (alive) setOrders([]); }
      try {
        const r = await authFetch("/v1/subscriptions");
        const j = await r.json();
        if (alive) setSubs((j.subscriptions ?? []).length);
      } catch { if (alive) setSubs(0); }
    }
    load();
    const id = setInterval(load, 12_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const os = orders ?? [];
  const paid = os.filter((o) => o.status === "paid");
  const received = paid.reduce((a, o) => a + parseFloat(o.usdc_amount || "0"), 0);
  const saved = received * 0.029; // vs cards (~2.9%) net of SlipPay's near-zero fee
  const recent = os.slice(0, 5);

  const KPI = ({ label, value }: { label: string; value: React.ReactNode; accent?: boolean }) => (
    <div className="bg-[#0a0a0a] p-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/40">{label}</div>
      <div className={`mt-3 text-4xl md:text-5xl font-semibold tabular-nums tracking-[-0.02em] text-[#f1eee7]`} style={display}>{value}</div>
    </div>
  );

  return (
    <div className="max-w-[1100px]">
      <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#0a0a0a]/45">
        <span className="text-[#0a0a0a]/70">000</span><span className="h-px w-8 bg-current opacity-40" /><span>overview · live</span>
      </div>
      <h1 className="mt-8 font-bold uppercase tracking-[-0.05em] leading-[0.85] text-[clamp(2.5rem,8vw,6rem)]" style={display}>
        Your money, <span className="text-[#6f6862]">working.</span>
      </h1>

      {/* KPI grid */}
      <div className="mt-12 grid grid-cols-2 lg:grid-cols-4 gap-px bg-[#f1eee7]/10 border border-[#0a0a0a]/10 rounded-2xl overflow-hidden">
        <KPI label="received (USDC)" value={orders == null ? "…" : received.toLocaleString("en-US", { maximumFractionDigits: 2 })} accent />
        <KPI label="saved vs cards" value={orders == null ? "…" : <><span className="text-2xl align-top">$</span><CountUp to={Number(saved.toFixed(2))} format={(n) => n.toFixed(2)} /></>} />
        <KPI label="settled" value={orders == null ? "…" : paid.length} />
        <KPI label="autopilot mandates" value={subs == null ? "…" : subs} />
      </div>

      <div className="mt-10 grid lg:grid-cols-[1fr_1fr] gap-8">
        {/* autopilot / integrity */}
        <div className="rounded-2xl border border-[#0a0a0a]/12 p-7">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45">
            <span>autopilot</span>
            <span className="flex items-center gap-1.5 text-[#6f6862]"><span className="w-1.5 h-1.5 rounded-full bg-[#FDDA24] animate-pulse" /> integrity gate</span>
          </div>
          <p className="mt-4 text-lg leading-snug tracking-[-0.01em]" style={display}>
            {subs ? `${subs} mandate${subs === 1 ? "" : "s"} running within your rules.` : "No autopilot mandates yet."}
          </p>
          <p className="mt-2 text-sm text-[#0a0a0a]/55 leading-relaxed">
            Every autonomous charge requires a fresh, on-chain integrity attestation — no proof, no payment. You set the cap; the rule can't be bypassed.
          </p>
          <Link to="/dashboard/subscriptions" className="mt-5 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#0a0a0a]/60 hover:text-[#0a0a0a] border-b border-[#0a0a0a]/20 pb-1">Manage autopilot →</Link>
        </div>

        {/* quick actions */}
        <div className="rounded-2xl border border-[#0a0a0a]/12 p-7">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45">quick actions</div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Link to="/pay" className="lift rounded-full px-5 py-3.5 text-center text-[11px] uppercase tracking-[0.2em] bg-[#FDDA24] text-[#0a0a0a]">Pay</Link>
            <Link to="/cobrar" className="lift rounded-full px-5 py-3.5 text-center text-[11px] uppercase tracking-[0.2em] bg-[#FDDA24] text-[#0a0a0a] font-medium">Get paid</Link>
            <Link to="/withdraw-demo" className="rounded-full px-5 py-3.5 text-center text-[11px] uppercase tracking-[0.2em] border border-[#0a0a0a]/25 hover:border-[#0a0a0a]/60">Withdraw</Link>
            <Link to="/dashboard/settings" className="rounded-full px-5 py-3.5 text-center text-[11px] uppercase tracking-[0.2em] border border-[#0a0a0a]/25 hover:border-[#0a0a0a]/60">API key</Link>
          </div>
        </div>
      </div>

      {/* recent activity */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45">recent activity</div>
          <Link to="/dashboard/orders" className="text-[11px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]">All →</Link>
        </div>
        <div className="mt-4">
          {orders == null ? (
            <div className="py-6 font-mono text-[11px] uppercase tracking-[0.2em] text-[#0a0a0a]/40">loading…</div>
          ) : recent.length === 0 ? (
            <div className="py-6 text-sm text-[#0a0a0a]/55">No activity yet — send a one-touch pay link from <Link to="/cobrar" className="underline">Get paid</Link>.</div>
          ) : recent.map((o) => (
            <div key={o.id} className="flex items-baseline justify-between gap-4 py-4 border-t border-[#0a0a0a]/10">
              <span className="font-mono text-xs text-[#0a0a0a]/55">{o.id.slice(0, 8)}</span>
              <span className="tabular-nums" style={display}>{o.usdc_amount}<span className="text-[#0a0a0a]/45 text-sm"> USDC</span></span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 w-20 text-right">{o.status}</span>
              <span className="font-mono text-[11px] w-20 text-right">
                {o.tx_hash ? <a href={`${EXPLORER_BASE}/${o.tx_hash}`} target="_blank" rel="noreferrer" className="text-[#6f6862] hover:underline">{o.tx_hash.slice(0, 6)}↗</a> : <span className="text-[#0a0a0a]/25">—</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-12"><LiveProof /></div>
    </div>
  );
}
