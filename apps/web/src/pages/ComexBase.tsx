import { useState } from "react";
import { useComexBaseWallet } from "../lib/comexBase.tsx";
import ComexBaseDashboard from "./comex/base/Dashboard.tsx";

// VERIFY-WITH-KEYS: MFA gate — Privy embeds MFA enforcement via PRIVY_CONFIG
// (mfa.noPromptOnMfaRequired: false in comexBase.tsx). Privy handles the MFA
// flow before returning authenticated=true. No separate useMfaEnrollment gate
// needed here unless we want to block unenrolled users manually.

export default function ComexBase() {
  const { ready, authenticated, login } = useComexBaseWallet();
  const [loggingIn, setLoggingIn] = useState(false);

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
    // login() resolves when the Privy modal closes (success or cancel); awaiting
    // it gives click feedback without leaving the button stuck.
    const handleLogin = async () => {
      setLoggingIn(true);
      try { await login(); } catch { /* user cancelled */ } finally { setLoggingIn(false); }
    };
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
                onClick={handleLogin}
                disabled={loggingIn}
                className="bg-[#FDDA24] text-[#0a0a0a] px-10 py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#e5c420] disabled:opacity-50"
              >
                {loggingIn ? "Entrando..." : "Entrar"}
              </button>
              <p className="mt-4 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">
                Acesso por e-mail e verificação em duas etapas
              </p>
              <p className="mt-8 text-[10px] uppercase tracking-[0.14em] text-[#0a0a0a]/40 max-w-sm leading-relaxed">
                Carteira da empresa · você assina · câmbio liquidado pela 4P (licenciada) · USDC by Circle
              </p>
            </div>
          </div>
        </main>

        <footer className="border-t border-[#0a0a0a]/10">
          <div className="max-w-[1400px] mx-auto px-8 md:px-12 py-6 text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/45">
            Non-custodial · USDC by Circle · Base · Slippay
          </div>
        </footer>
      </div>
    );
  }

  // 3. Authenticated + wallet ready → dashboard
  return <ComexBaseDashboard />;
}
