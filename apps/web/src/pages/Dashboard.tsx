import { Outlet, NavLink, Navigate, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth, supabase } from "../lib/auth.tsx";
import { authFetch } from "../lib/apiAuth.ts";
import { StellarAddressInput } from "../components/StellarAddressInput.tsx";
import { LiveProof } from "../components/LiveProof.tsx";
import { isValidAddress } from "../lib/chain/validate.ts";

const display = { fontFamily: "'DM Sans', sans-serif" } as const;

interface MerchantSummary {
  id: string;
  display_name: string;
  email: string;
  api_key_prefix: string;
  network: string;
  active: boolean;
}

const NAV: [string, string, boolean][] = [
  ["Overview", "/dashboard", true],
  ["Activity", "/dashboard/orders", false],
  ["Autopilot", "/dashboard/subscriptions", false],
  ["Settings", "/dashboard/settings", false],
];

export default function Dashboard() {
  const { session, loading } = useAuth();
  const [merchant, setMerchant] = useState<MerchantSummary | null>(null);
  const [needsCreate, setNeedsCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [stellarAddress, setStellarAddress] = useState("");
  const nav = useNavigate();
  const onboardNetwork = "TESTNET" as const;
  const addrFormatInvalid = stellarAddress.trim() !== "" && !isValidAddress(stellarAddress);

  useEffect(() => {
    if (!session) return;
    authFetch("/v1/merchants/me").then(async r => {
      if (r.status === 404) { setNeedsCreate(true); return; }
      const j = await r.json();
      setMerchant(j.merchant);
    });
  }, [session]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f1eee7] flex items-center justify-center">
        <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/55">
          <span className="w-1.5 h-1.5 rounded-full bg-[#FDDA24] animate-pulse" /> loading…
        </div>
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;

  if (needsCreate) {
    return (
      <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] grain flex flex-col">
        <header className="px-6 md:px-12 py-7">
          <span className="text-lg font-semibold tracking-[-0.04em]" style={display}>slippay<span className="text-[#FDDA24]">.</span></span>
        </header>
        <main className="flex-1 flex items-center">
          <div className="max-w-[820px] w-full mx-auto px-6 md:px-12 py-16">
            <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.3em] text-[#0a0a0a]/45">
              <span className="text-[#0a0a0a]/70">001</span><span className="h-px w-8 bg-current opacity-40" /><span>onboard</span>
            </div>
            <h1 className="mt-8 font-bold uppercase tracking-[-0.05em] leading-[0.85] text-[clamp(2.5rem,9vw,6rem)]" style={display}>
              Two fields <span className="text-[#6f6862]">and you're live.</span>
            </h1>
            <p className="mt-8 text-xl text-[#0a0a0a]/70 max-w-[46ch]">
              Your business name and the Stellar address where your dollars land.
              That's the whole setup — your API key shows once, right after.
            </p>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (addrFormatInvalid) return;
              setCreating(true);
              const body: Record<string, string> = { display_name: displayName };
              const addr = stellarAddress.trim();
              if (addr !== "") body.stellar_address = addr;
              const r = await authFetch("/v1/merchants", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              });
              setCreating(false);
              if (r.ok) {
                const j = await r.json();
                sessionStorage.setItem("slippay.fresh_api_key", j.api_key);
                setMerchant(j.merchant);
                setNeedsCreate(false);
                nav("/dashboard/settings");
              }
            }} className="mt-14 max-w-md space-y-8">
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block mb-2">Business name</span>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                  autoFocus required minLength={1} maxLength={120}
                  className="w-full bg-transparent border-b border-[#0a0a0a]/30 py-3 text-lg tracking-tight focus:outline-none focus:border-[#0a0a0a] transition-colors" />
              </label>
              <StellarAddressInput
                value={stellarAddress}
                onChange={setStellarAddress}
                network={onboardNetwork}
                hint="Where your dollars (USDC) land. You can also set this later in settings — but setting it now means you're ready to get paid immediately."
              />
              <button disabled={creating || addrFormatInvalid}
                title={addrFormatInvalid ? "Fix the Stellar address before continuing" : undefined}
                className="lift w-full rounded-full bg-[#FDDA24] text-[#0a0a0a] py-4 text-[11px] uppercase tracking-[0.22em] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
                {creating ? "…" : "Create account"}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#f1eee7] text-[#0a0a0a]">
      <aside className="w-64 shrink-0 bg-[#0a0a0a] text-[#f1eee7] p-7 flex flex-col">
        <span className="text-lg font-semibold tracking-[-0.04em]" style={display}>slippay<span className="text-[#FDDA24]">.</span></span>
        {merchant && (
          <div className="mt-8 mb-10">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#f1eee7]/45">account</div>
            <div className="text-base mt-1 truncate tracking-[-0.01em]" style={display}>{merchant.display_name}</div>
            <div className="mt-4 flex items-center gap-2">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${merchant.network === "mainnet" ? "bg-[#FDDA24]" : "bg-amber-400"} animate-pulse`} />
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#f1eee7]/70">{merchant.network}</span>
            </div>
          </div>
        )}
        <nav className="flex flex-col gap-1 mt-2">
          {NAV.map(([label, to, end]) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `relative px-3 py-2.5 text-[10px] uppercase tracking-[0.2em] transition-colors ${isActive ? "text-[#FDDA24]" : "text-[#f1eee7]/55 hover:text-[#f1eee7]"}`}>
              {({ isActive }) => (<>{isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] bg-[#FDDA24]" />}{label}</>)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto pt-8 space-y-5">
          <div className="scale-90 origin-left opacity-80"><LiveProof dark /></div>
          <button onClick={async () => { await supabase.auth.signOut(); nav("/login"); }}
            className="text-[10px] uppercase tracking-[0.2em] text-[#f1eee7]/45 hover:text-[#f1eee7] text-left">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 px-6 md:px-14 py-10 md:py-16 overflow-auto grain">
        <Outlet context={merchant} />
      </main>
    </div>
  );
}
