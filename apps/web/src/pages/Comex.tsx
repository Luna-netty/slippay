import { useComexWallet } from "../lib/comexPrivy.tsx";
import { useMfaEnrollment, usePrivy } from "@privy-io/react-auth";
import ComexDashboard from "./comex/Dashboard.tsx";

export default function Comex() {
  const { ready, authenticated, login } = useComexWallet();
  // useMfaEnrollment: kept at page level so MFA modal is accessible post-auth.
  // VERIFY-WITH-KEYS: gate is now implemented below. Confirm `user.mfaMethods` shape
  // matches the live Privy session (type: LinkedMfaAccount[]) before relying on it in prod.
  const { showMfaEnrollmentModal } = useMfaEnrollment();
  const { user } = usePrivy();

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
                className="bg-[#0a0a0a] text-[#f1eee7] px-10 py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a]"
              >
                Entrar
              </button>
            </div>
          </div>
        </main>

        <footer className="border-t border-[#0a0a0a]/10">
          <div className="max-w-[1400px] mx-auto px-8 md:px-12 py-6 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">
            Non-custodial · USDC by Circle · Slippay
          </div>
        </footer>
      </div>
    );
  }

  // 3. Authenticated — MFA gate
  // Block dashboard if no MFA method enrolled. Self-attest via mfaMethods array.
  if (!user || (user.mfaMethods?.length ?? 0) === 0) {
    return (
      <div className="min-h-screen bg-[#f1eee7] flex items-center justify-center">
        <div className="max-w-sm text-center space-y-6 px-8">
          <p className="text-sm text-[#0a0a0a]/70">
            Ative a verificação em duas etapas (2FA) para proteger a conta da empresa
          </p>
          <button
            onClick={showMfaEnrollmentModal}
            className="bg-[#0a0a0a] text-[#f1eee7] px-10 py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a]"
          >
            Ativar 2FA
          </button>
        </div>
      </div>
    );
  }

  // 4. Authenticated + MFA enrolled → dashboard
  return <ComexDashboard />;
}
