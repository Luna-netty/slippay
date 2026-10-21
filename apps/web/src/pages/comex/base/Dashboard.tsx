import { useEffect, useState } from "react";
import { useComexBaseWallet } from "../../../lib/comexBase.tsx";
import { publicClient, usdcAddress, fromBaseUnits } from "../../../lib/chain/base/usdc.ts";
import BaseBalance from "./Balance.tsx";
import BaseSend from "./Send.tsx";
import BaseExchange from "./Exchange.tsx";
import BaseOverview from "./Overview.tsx";

type Tab = "Overview" | "Saldo" | "Enviar" | "Câmbio" | "Render";
const TABS: Tab[] = ["Overview", "Saldo", "Enviar", "Câmbio", "Render"];

const ERC20_BALANCE_OF_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

export default function ComexBaseDashboard() {
  const { email, address, logout } = useComexBaseWallet();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [stripBalance, setStripBalance] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Always-on balance in the strip — refreshes on tab change so it reflects a
  // buy/receive/send without leaving the page.
  useEffect(() => {
    if (!address) return;
    let on = true;
    publicClient.readContract({ address: usdcAddress(), abi: ERC20_BALANCE_OF_ABI, functionName: "balanceOf", args: [address] })
      .then((raw) => { if (on) setStripBalance(fromBaseUnits(raw as bigint)); })
      .catch(() => { /* leave last */ });
    return () => { on = false; };
  }, [address, activeTab]);

  const copyAddr = () => {
    if (!address) return;
    navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  const NUM: Record<Tab, string> = { Overview: "", Saldo: "001", Enviar: "002", Câmbio: "003", Render: "004" };

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] flex flex-col md:flex-row">
      {/* Sidebar (md+) / top nav bar (mobile) */}
      <aside className="w-full md:w-[212px] bg-[#0a0a0a] text-[#f1eee7] flex md:flex-col shrink-0 md:sticky md:top-0 md:h-screen items-center md:items-stretch px-2 md:px-0 py-2 md:py-0 gap-1 md:gap-0">
        <div className="px-2 md:px-5 md:pt-6 md:pb-5 shrink-0">
          <div className="font-extrabold text-[16px] md:text-[18px] tracking-tight">slippay</div>
          <div className="hidden md:block mt-5 text-[9px] uppercase tracking-[0.18em] text-[#f1eee7]/40">Conta da empresa</div>
        </div>
        <nav className="flex md:flex-col md:flex-1 md:px-3 gap-1 overflow-x-auto md:overflow-visible min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={[
                "shrink-0 md:w-full text-left px-3 py-2 md:py-2.5 rounded-lg text-[11px] md:text-[12px] uppercase tracking-[0.13em] md:mb-1 transition-colors flex items-center gap-2",
                activeTab === tab
                  ? "bg-[#FDDA24] text-[#0a0a0a] font-bold"
                  : "text-[#f1eee7]/60 hover:bg-[#f1eee7]/10 hover:text-[#f1eee7]",
              ].join(" ")}
            >
              {NUM[tab] && <span className="hidden md:inline text-[9px] opacity-50 tabular-nums">{NUM[tab]}</span>}
              {tab}
            </button>
          ))}
        </nav>
        <button
          onClick={logout}
          className="shrink-0 md:m-3 text-left px-3 py-2 md:py-3 text-[10px] uppercase tracking-[0.18em] text-[#f1eee7]/45 hover:text-[#f1eee7] md:border-t md:border-[#f1eee7]/12"
        >
          Sair
        </button>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* top strip — email · wallet · balance */}
        <div className="border-b border-[#0a0a0a]/10">
          <div className="px-4 md:px-12 py-3 md:py-4 flex items-center gap-3 sm:gap-6">
            {email && (
              <div className="text-[10px] text-[#0a0a0a]/70 truncate max-w-[40vw] sm:max-w-none">{email}</div>
            )}
            {address && (
              <button
                onClick={copyAddr}
                title="Copiar endereço"
                className="font-mono text-[10px] text-[#0a0a0a]/45 hover:text-[#0a0a0a]/80 shrink-0 transition-colors"
              >
                <span className="text-[#0a0a0a]/35">carteira </span>{address.slice(0, 6)}…{address.slice(-4)}{copied ? " ✓" : ""}
              </button>
            )}
            {stripBalance !== null && (
              <div className="ml-auto text-[11px] tabular-nums text-[#0a0a0a] shrink-0">
                $ {Number(stripBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="text-[#0a0a0a]/40"> USDC</span>
              </div>
            )}
          </div>
        </div>

        {/* panel */}
        <main className="flex-1">
          <div className="w-full px-4 md:px-12 py-6 md:py-10 grid md:grid-cols-12 gap-6 md:gap-12">
            {activeTab !== "Overview" && (
            <div className="md:col-span-3 text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55">
              <span className="inline-block w-3 h-3 bg-[#FDDA24] mr-2 align-middle" />
              {activeTab === "Saldo" && "001. Saldo"}
              {activeTab === "Enviar" && "002. Enviar"}
              {activeTab === "Câmbio" && "003. Câmbio"}
              {activeTab === "Render" && "004. Render"}
            </div>
          )}

          {activeTab === "Overview" && <BaseOverview />}
          {activeTab === "Saldo" && <BaseBalance onNavigate={setActiveTab} />}
          {activeTab === "Enviar" && <BaseSend />}
          {activeTab === "Câmbio" && <BaseExchange />}
          {activeTab === "Render" && (
            <div className="md:col-span-9 max-w-xl">
              <div className="text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55 mb-8 block">
                Rendimento
              </div>
              <p className="text-sm text-[#0a0a0a]/55">
                Rendimento — fase 2
              </p>
            </div>
          )}
        </div>
      </main>
      </div>
    </div>
  );
}
