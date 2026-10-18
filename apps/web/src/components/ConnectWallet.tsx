// Connect-wallet for the crypto-native path. Two doors:
//  - MetaMask (EVM): where most people's USDC actually lives (Base/Ethereum/...).
//    MetaMask cannot sign Stellar; its role here is to FUND SlipPay by bringing
//    USDC over via Circle CCTP (burn on EVM -> mint on Stellar).
//  - Stellar wallet (Freighter/Lobstr/xBull): for users who already hold USDC on
//    Stellar and want to drive the contracts directly.
import { useState } from "react";
import { connectWallet } from "../lib/wallet.ts";

function short(a: string) {
  return a.length <= 11 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// deno-lint-ignore no-explicit-any
type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<any> };
function getEth(): Eth | null {
  const w = window as unknown as { ethereum?: Eth };
  return w.ethereum ?? null;
}

export function ConnectWallet({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addr, setAddr] = useState<string | null>(null);
  const [kind, setKind] = useState<"evm" | "stellar" | null>(null);

  async function metamask() {
    setOpen(false); setBusy(true);
    try {
      const eth = getEth();
      if (!eth) { window.open("https://metamask.io/download/", "_blank"); return; }
      const accs: string[] = await eth.request({ method: "eth_requestAccounts" });
      if (accs?.[0]) { setAddr(accs[0]); setKind("evm"); }
    } catch { /* user rejected */ } finally { setBusy(false); }
  }

  async function stellar() {
    setOpen(false); setBusy(true);
    try {
      const a = await connectWallet();
      if (a) { setAddr(a); setKind("stellar"); }
    } catch { /* closed */ } finally { setBusy(false); }
  }

  if (addr) {
    return (
      <button onClick={() => { setAddr(null); setKind(null); }} className={className} title={addr}>
        {kind === "evm" ? "Ⓜ " : "✦ "}{short(addr)}
      </button>
    );
  }

  return (
    <span className="relative inline-flex">
      <button onClick={() => setOpen((v) => !v)} disabled={busy} className={className}>
        {busy ? "..." : "Conectar carteira"}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 z-50 w-60 bg-[#f1eee7] border border-[#0a0a0a]/15 rounded-xl shadow-[0_18px_50px_-24px_rgba(10,10,10,0.4)] overflow-hidden text-left normal-case tracking-normal">
          <button onClick={metamask} className="w-full text-left px-4 py-3.5 hover:bg-[#0a0a0a]/[0.04] border-b border-[#0a0a0a]/8">
            <div className="text-[14px] font-semibold text-[#0a0a0a]">MetaMask</div>
            <div className="text-[12px] text-[#0a0a0a]/55 leading-snug mt-0.5">Traga seu USDC de Base, Ethereum e outras redes</div>
          </button>
          <button onClick={stellar} className="w-full text-left px-4 py-3.5 hover:bg-[#0a0a0a]/[0.04]">
            <div className="text-[14px] font-semibold text-[#0a0a0a]">Carteira Stellar</div>
            <div className="text-[12px] text-[#0a0a0a]/55 leading-snug mt-0.5">Freighter, Lobstr, xBull</div>
          </button>
        </div>
      )}
    </span>
  );
}
