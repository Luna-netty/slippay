import { useComexSolanaWallet } from "../lib/comexSolana.tsx";
import ComexSolanaDashboard from "./comex/solana/Dashboard.tsx";

// VERIFY-WITH-KEYS: add MFA gate here when Privy mfaMethods available for Solana embedded wallets
// (useMfaEnrollment from @privy-io/react-auth, gate on user.mfaMethods?.length > 0)

export default function ComexSolana() {
  const { ready, authenticated, login } = useComexSolanaWallet();

  // 1. SDK not ready yet
  if (!ready) {
    return (
      <div className="min-h-screen bg-[#f1eee7] flex items-center justify-center">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">
          Carregando...
        </div>
      </div>
    );
  }

  // 2. Not authenticated → landing
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] flex flex-col">
        <header className="max-w-[1400px] w-full mx-auto px-8 md:px-12 py-8 flex items-center justify-between">
          <div className="text-xs uppercase tracking-[0.18em]">Slippay</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55">
            Tesouraria corporativa
          </div>
        </header>

        <main className="flex-1 flex items-center">
          <div className="max-w-[1400px] w-full mx-auto px-8 md:px-12 grid md:grid-cols-12 gap-8 md:gap-16 py-16 md:py-24">
            <div className="md:col-span-3 text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55">
              <span className="inline-block w-3 h-3 bg-[#0a0a0a] mr-2 align-middle" />
              001. Comex
            </div>

            <div className="md:col-span-6">
              <h1 className="text-5xl md:text-7xl font-medium tracking-[-0.03em] leading-[0.92] mb-8">
                Conta da empresa
              </h1>
              <p className="text-base text-[#0a0a0a]/65 mb-3 max-w-sm">
                Gerencie seu saldo em dólares, envie pagamentos internacionais e
                acesse câmbio corporativo — tudo em uma conta não-custodial.
              </p>
              <p className="text-sm text-[#0a0a0a]/45 mb-10 max-w-sm">
                Sem banco intermediário. Só a sua empresa e seus dólares.
              </p>

              <button
                onClick={login}
                className="bg-[#FDDA24] text-[#0a0a0a] px-10 py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#e5c420]"
              >
                Entrar
              </button>
            </div>
          </div>
        </main>

        <footer className="border-t border-[#0a0a0a]/10">
          <div className="max-w-[1400px] mx-auto px-8 md:px-12 py-6 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">
            Non-custodial · USDC by Circle · Solana · Slippay
          </div>
        </footer>
      </div>
    );
  }

  // 3. Authenticated + wallet ready → dashboard
  return <ComexSolanaDashboard />;
}
