import { useEffect, useState } from "react";
import { authFetch } from "../lib/apiAuth.ts";

interface SubscriptionRow {
  id: string;
  external_ref: string | null;
  buyer_email: string | null;
  asset_code: "USDC" | "PYUSD";
  brl_amount: string | number;
  period_seconds: number;
  max_periods: number | null;
  charges_done: number;
  status: "active" | "paused" | "cancelled" | "expired";
  next_charge_at: string;
  last_charge_at: string | null;
  created_at: string;
}

const STATUS_DOT: Record<string, string> = {
  active:    "bg-[#FDDA24]",
  paused:    "bg-amber-500",
  cancelled: "bg-[#0a0a0a]/30",
  expired:   "bg-[#0a0a0a]/30",
};

const PERIODS = [
  { label: "1 day",    seconds: 86_400 },
  { label: "1 week",   seconds: 604_800 },
  { label: "30 days",  seconds: 2_592_000 },
  { label: "90 days",  seconds: 7_776_000 },
  { label: "365 days", seconds: 31_536_000 },
];

function fmtPeriod(s: number) {
  const days = Math.round(s / 86_400);
  if (days < 7)   return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60)  return `${Math.round(days / 7)} weeks`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} years`;
}

export default function DashboardSubscriptions() {
  const [subs, setSubs]       = useState<SubscriptionRow[] | null>(null);
  const [showForm, setShow]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [chargeBusy, setChargeBusy] = useState<string | null>(null);

  // form state
  const [brl, setBrl]                 = useState("");
  const [periodSeconds, setPeriodSec] = useState(2_592_000);
  const [maxPeriods, setMaxPeriods]   = useState<string>("");
  const [externalRef, setExtRef]      = useState("");
  const [buyerEmail, setBuyerEmail]   = useState("");
  const [assetCode, setAssetCode]     = useState<"USDC" | "PYUSD">("USDC");

  async function load() {
    const r = await authFetch("/v1/subscriptions");
    const j = await r.json();
    setSubs(j.subscriptions ?? []);
  }
  useEffect(() => {
    let alive = true;
    load();
    const id = setInterval(() => alive && load(), 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setCreating(true);
    try {
      const r = await authFetch("/v1/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brl_amount: Number(brl).toFixed(2),
          period_seconds: periodSeconds,
          asset_code: assetCode,
          max_periods: maxPeriods ? Number(maxPeriods) : undefined,
          external_ref: externalRef || undefined,
          buyer_email: buyerEmail || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? `http ${r.status}`); return; }
      setShow(false);
      setBrl(""); setMaxPeriods(""); setExtRef(""); setBuyerEmail("");
      load();
    } finally {
      setCreating(false);
    }
  }

  async function handleCharge(id: string) {
    setChargeBusy(id);
    try {
      const r = await authFetch(`/v1/subscriptions/${id}/charge`, { method: "POST" });
      const j = await r.json();
      if (j.checkout_url) {
        window.open(j.checkout_url, "_blank", "noopener");
      } else if (j.error) {
        setError(`charge: ${j.error}`);
      }
      load();
    } finally {
      setChargeBusy(null);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm("Cancel subscription? This stops future charges.")) return;
    await authFetch(`/v1/subscriptions/${id}/cancel`, { method: "POST" });
    load();
  }

  if (subs === null) {
    return <div className="text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55">Loading...</div>;
  }

  return (
    <div className="max-w-6xl">
      <div className="text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-3">002. Subscriptions</div>
      <div className="flex items-baseline justify-between mb-16 flex-wrap gap-6">
        <h1 className="text-5xl md:text-7xl font-medium tracking-[-0.04em] leading-[0.95]">
          {subs.length} {subs.length === 1 ? "subscription" : "subscriptions"}
        </h1>
        <button onClick={() => setShow(s => !s)}
          className="bg-[#0a0a0a] text-[#f1eee7] px-6 py-3 text-[10px] uppercase tracking-[0.22em] hover:bg-[#1a1a1a]">
          {showForm ? "Close" : "+ New subscription"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate}
          className="mb-12 border border-[#0a0a0a]/15 p-6 md:p-8 grid grid-cols-12 gap-6">
          <label className="col-span-12 md:col-span-3">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block mb-2">BRL amount</span>
            <input type="number" step="0.01" min="0.01" required
              value={brl} onChange={e => setBrl(e.target.value)}
              className="w-full bg-transparent border-b border-[#0a0a0a]/30 py-2 text-lg tabular-nums focus:outline-none focus:border-[#0a0a0a]" />
          </label>
          <label className="col-span-12 md:col-span-3">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block mb-2">Period</span>
            <select value={periodSeconds} onChange={e => setPeriodSec(Number(e.target.value))}
              className="w-full bg-transparent border-b border-[#0a0a0a]/30 py-2 text-lg focus:outline-none focus:border-[#0a0a0a]">
              {PERIODS.map(p => <option key={p.seconds} value={p.seconds}>{p.label}</option>)}
            </select>
          </label>
          <label className="col-span-6 md:col-span-3">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block mb-2">Asset</span>
            <select value={assetCode} onChange={e => setAssetCode(e.target.value as "USDC" | "PYUSD")}
              className="w-full bg-transparent border-b border-[#0a0a0a]/30 py-2 text-lg focus:outline-none focus:border-[#0a0a0a]">
              <option value="USDC">USDC (Circle)</option>
              <option value="PYUSD">PYUSD (PayPal)</option>
            </select>
          </label>
          <label className="col-span-6 md:col-span-3">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block mb-2">Max charges (optional)</span>
            <input type="number" min="1" max="120" placeholder="∞"
              value={maxPeriods} onChange={e => setMaxPeriods(e.target.value)}
              className="w-full bg-transparent border-b border-[#0a0a0a]/30 py-2 text-lg tabular-nums focus:outline-none focus:border-[#0a0a0a]" />
          </label>
          <label className="col-span-12 md:col-span-6">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block mb-2">External ref (your ID)</span>
            <input type="text" maxLength={120} placeholder="e.g. customer-42-pro-plan"
              value={externalRef} onChange={e => setExtRef(e.target.value)}
              className="w-full bg-transparent border-b border-[#0a0a0a]/30 py-2 text-base focus:outline-none focus:border-[#0a0a0a]" />
          </label>
          <label className="col-span-12 md:col-span-6">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block mb-2">Buyer email (optional)</span>
            <input type="email" placeholder="buyer@example.com"
              value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)}
              className="w-full bg-transparent border-b border-[#0a0a0a]/30 py-2 text-base focus:outline-none focus:border-[#0a0a0a]" />
          </label>
          {error && <div className="col-span-12 text-sm text-red-700 font-mono">{error}</div>}
          <div className="col-span-12 flex gap-4 pt-4">
            <button type="submit" disabled={creating}
              className="bg-[#0a0a0a] text-[#f1eee7] px-8 py-3 text-[10px] uppercase tracking-[0.22em] hover:bg-[#1a1a1a] disabled:opacity-50">
              {creating ? "Creating..." : "Create subscription"}
            </button>
            <button type="button" onClick={() => setShow(false)}
              className="px-6 py-3 text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]">
              Cancel
            </button>
          </div>
        </form>
      )}

      {subs.length === 0 && !showForm
        ? (
          <div className="border border-[#0a0a0a]/10 p-8">
            <div className="text-base">No subscriptions yet.</div>
            <p className="text-sm text-[#0a0a0a]/55 mt-2 max-w-[60ch]">
              A subscription represents a recurring billing relationship. Each period
              you (or our scheduler) call <code className="text-xs bg-[#0a0a0a]/[0.04] px-1">POST /v1/subscriptions/:id/charge</code>
              to materialize an order; the buyer pays via the checkout URL; the listener
              confirms the on-chain payment and fires a <code className="text-xs bg-[#0a0a0a]/[0.04] px-1">subscription.charged</code> webhook.
            </p>
          </div>
        )
        : (
          <table className="w-full">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 text-left border-b border-[#0a0a0a]/20">
                <th className="py-4 font-normal">ID</th>
                <th className="font-normal">Ref</th>
                <th className="font-normal">BRL / period</th>
                <th className="font-normal">Asset</th>
                <th className="font-normal">Charges</th>
                <th className="font-normal">Status</th>
                <th className="font-normal">Next due</th>
                <th className="font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subs.map(s => (
                <tr key={s.id} className="border-b border-[#0a0a0a]/10 hover:bg-[#0a0a0a]/[0.02]">
                  <td className="py-4 font-mono text-xs text-[#0a0a0a]/70">{s.id.slice(0,8)}</td>
                  <td className="text-sm text-[#0a0a0a]/70">{s.external_ref ?? "—"}</td>
                  <td className="text-sm tabular-nums">
                    R$ {Number(s.brl_amount).toFixed(2)} <span className="text-[#0a0a0a]/55">/ {fmtPeriod(s.period_seconds)}</span>
                  </td>
                  <td className="text-xs uppercase tracking-[0.18em]">{s.asset_code}</td>
                  <td className="text-sm tabular-nums">{s.charges_done}{s.max_periods ? ` / ${s.max_periods}` : ""}</td>
                  <td>
                    <span className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em]">
                      <span className={`inline-block w-1.5 h-1.5 ${STATUS_DOT[s.status]}`} />
                      {s.status}
                    </span>
                  </td>
                  <td className="text-xs text-[#0a0a0a]/55 tabular-nums">
                    {new Date(s.next_charge_at).toLocaleString()}
                  </td>
                  <td className="text-right">
                    {s.status === "active" && (
                      <button onClick={() => handleCharge(s.id)}
                        disabled={chargeBusy === s.id}
                        className="text-[10px] uppercase tracking-[0.18em] border-b border-[#0a0a0a] hover:opacity-60 mr-4 disabled:opacity-30">
                        {chargeBusy === s.id ? "..." : "Charge"}
                      </button>
                    )}
                    {s.status !== "cancelled" && (
                      <button onClick={() => handleCancel(s.id)}
                        className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 hover:text-red-700">
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
