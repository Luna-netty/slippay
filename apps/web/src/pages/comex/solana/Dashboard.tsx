import { useState } from "react";
import { useComexSolanaWallet } from "../../../lib/comexSolana.tsx";
import SolanaBalance from "./Balance.tsx";
import SolanaSend from "./Send.tsx";
import Exchange from "./Exchange.tsx";

type Tab = "Saldo" | "Enviar" | "Câmbio" | "Render";
const TABS: Tab[] = ["Saldo", "Enviar", "Câmbio", "Render"];

export default function ComexSolanaDashboard() {
  const { email, address } = useComexSolanaWallet();
  const [activeTab, setActiveTab] = useState<Tab>("Saldo");

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] flex flex-col">
      {/* Account strip */}
      <div className="border-b border-[#0a0a0a]/10">
        <div className="max-w-[1400px] mx-auto px-8 md:px-12 py-4 flex items-center gap-6">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">
            Conta da empresa
          </div>
          {email && (
            <div className="text-[10px] text-[#0a0a0a]/70">{email}</div>
          )}
          {address && (
            <div className="font-mono text-[10px] text-[#0a0a0a]/40 hidden md:block">
              {address.slice(0, 8)}...{address.slice(-4)}
            </div>
          )}
        </div>
      </div>

      {/* Tab nav */}
      <nav className="border-b border-[#0a0a0a]/10">
        <div className="max-w-[1400px] mx-auto px-8 md:px-12 flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={[
                "py-4 px-6 text-[10px] uppercase tracking-[0.18em] border-b-2 transition-colors",
                activeTab === tab
                  ? "border-[#FDDA24] text-[#0a0a0a]"
                  : "border-transparent text-[#0a0a0a]/45 hover:text-[#0a0a0a]/70",
              ].join(" ")}
            >
              {tab}
            </button>
          ))}
        </div>
      </nav>

      {/* Panel */}
      <main className="flex-1 flex items-start">
        <div className="max-w-[1400px] w-full mx-auto px-8 md:px-12 py-16 grid md:grid-cols-12 gap-8 md:gap-16">
          <div className="md:col-span-3 text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55">
            <span className="inline-block w-3 h-3 bg-[#FDDA24] mr-2 align-middle" />
            {activeTab === "Saldo" && "001. Saldo"}
            {activeTab === "Enviar" && "002. Enviar"}
            {activeTab === "Câmbio" && "003. Câmbio"}
            {activeTab === "Render" && "004. Render"}
          </div>

          {activeTab === "Saldo" && <SolanaBalance />}
          {activeTab === "Enviar" && <SolanaSend />}
          {activeTab === "Câmbio" && <Exchange />}
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
  );
}
