import { useEffect, useState } from "react";
import { authFetch } from "../lib/apiAuth.ts";

const display = { fontFamily: "'DM Sans', sans-serif" } as const;
const EXPLORER_BASE =
  (import.meta.env.VITE_STELLAR_NETWORK ?? "TESTNET").toUpperCase() === "PUBLIC"
    ? "https://stellar.expert/explorer/public/tx"
    : "https://stellar.expert/explorer/testnet/tx";

interface OrderRow {
  id: string;
  external_ref: string | null;
  brl_amount: string | number;
  usdc_amount: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  tx_hash: string | null;
}

const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber-500",
  paid: "bg-#FDDA24",
  underpaid: "bg-orange-500",
  expired: "bg-[#0a0a0a]/25",
  cancelled: "bg-[#0a0a0a]/25",
  dead: "bg-red-500",
};

export default function DashboardOrders() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      const r = await authFetch("/v1/orders");
      if (!alive) return;
      const j = await r.json();
      setOrders(j.orders ?? []);
    }
    load();
    const id = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (orders === null) {
    return (
      <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/55">
        <span className="w-1.5 h-1.5 rounded-full bg-[#FDDA24] animate-pulse" /> loading…
      </div>
    );
  }

  const paid = orders.filter((o) => o.status === "paid").length;

  return (
    <div className="max-w[1100px]">
      <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#0a0a0a]/45">
        <span className="text-[#0a0a0a]/70">001</span><span className="h-px w-8 bg-current opacity-40" /><span>activity · live</span>
      </div>
      <h1 className="mt-8 font-bold uppercase tracking-[-0.05em] leading-[0.85] text-[clamp(2.75rem,9vw,7rem)]" style={display}>
        {orders.length} <span className="text-[#0a0a0a]/30">{orders.length === 1 ? "payment" : "payments"}</span>
      </h1>
      {orders.length > 0 && (
        <div className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[#0a0a0a]/50">
          <span className="text-[#6f6862]">{paid} settled</span> · updates live
        </div>
      )}

      {orders.length === 0 ? (
        <div className="mt-14 rounded-2xl border border-[#0a0a0a]/12 p-8 max-w-[620px]">
          <div className="text-lg font-medium tracking-[-0.01em]" style={display}>No payments yet.</div>
          <p className="text-sm text-[#0a0a0a]/55 mt-2 leading-relaxed">
            Create one with a <span className="font-mono">POST /v1/orders</span> using your API key from Settings —
            or send a one-touch pay link from <span className="font-mono">/cobrar</span>. They appear here in real time.
          </p>
        </div>
      ) : (
        <div className="mt-14">
          <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto_auto] gap-6 pb-3 font-mono text-[9px] uppercase tracking-[0.2em] text-[#0a0a0a]/40 border-b border-[#0a0a0a]/15">
            <span>order</span><span>amount</span><span>status</span><span>when</span><span>tx</span>
          </div>
          {orders.map((o) => (
            <div key={o.id} className="grid grid-cols-2 md:grid-cols-[1fr_auto_auto_auto_auto] gap-x-6 gap-y-1 py-5 border-b border-[#0a0a0a]/10 hover:bg-[#0a0a0a]/[0.02] transition-colors items-baseline">
              <span className="font-mono text-xs text-[#0a0a0a]/60">{o.id.slice(0, 8)}{o.external_ref ? ` · ${o.external_ref}` : ""}</span>
              <span className="text-right md:text-left tabular-nums" style={display}>{o.usdc_amount}<span className="text-[#0a0a0a]/45 text-sm"> USDC</span></span>
              <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/65">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_DOT[o.status] ?? "bg-[#0a0a0a]/25"}`} />{o.status}
              </span>
              <span className="font-mono text-[11px] text-[#0a0a0a]/45 tabular-nums">{new Date(o.created_at).toLocaleDateString()}</span>
              <span className="font-mono text-[11px] text-right md:text-left">
                {o.tx_hash
                  ? <a href={`${EXPLORER_BASE}/${o.tx_hash}`} target="_blank" rel="noreferrer" className="text-[#6f6862] hover:underline underline-offset-4">{o.tx_hash.slice(0, 8)} ↗</a>
                  : <span className="text-[#0a0a0a]/25">—</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
