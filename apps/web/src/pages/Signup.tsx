import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/auth.tsx";
import { Logo } from "../components/Logo.tsx";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ kind: "err" | "info"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] flex flex-col">
      <header className="max-w-[1400px] w-full mx-auto px-8 md:px-12 py-8 flex items-center justify-between">
        <Logo />
        <Link to="/login" className="text-xs uppercase tracking-[0.18em] hover:opacity-60">
          Já tem conta? Entrar
        </Link>
      </header>

      <main className="flex-1 flex items-center">
        <div className="max-w-[1400px] w-full mx-auto px-8 md:px-12 grid md:grid-cols-12 gap-16 py-16">
          <div className="md:col-span-3 text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55">
            <span className="inline-block w-3 h-3 bg-[#FDDA24] mr-2 align-middle" />
            001. Criar conta
          </div>
          <div className="md:col-span-6">
            <h1 className="text-6xl md:text-8xl font-medium tracking-[-0.04em] leading-[0.9]">
              Comece a receber em dólar.
            </h1>
            <p className="mt-8 text-xl text-[#0a0a0a]/70 max-w-[44ch]">
              Primeira venda em menos de 5 minutos. Sem custódia, sem intermediário.
              O comprador assina uma vez e o dinheiro cai direto na sua carteira.
            </p>
            <form onSubmit={async (e) => {
              e.preventDefault(); setMsg(null); setLoading(true);
              const { data, error } = await supabase.auth.signUp({ email, password });
              setLoading(false);
              if (error) { setMsg({ kind: "err", text: error.message }); return; }
              if (data.session) nav("/dashboard");
              else setMsg({ kind: "info", text: "Confira seu e-mail pra confirmar." });
            }} className="mt-16 max-w-md space-y-8">
              <Field label="E-mail" type="email" value={email} onChange={setEmail} required autoFocus />
              <Field label="Senha" type="password" value={password} onChange={setPassword} required minLength={8} />
              <button disabled={loading}
                className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-50">
                {loading ? "..." : "Criar conta"}
              </button>
              {msg && (
                <div className={`text-sm border-l-2 pl-3 ${msg.kind === "err" ? "text-red-700 border-red-700" : "text-[#0a0a0a]/70 border-[#0a0a0a]/30"}`}>
                  {msg.text}
                </div>
              )}
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({ label, type, value, onChange, required, autoFocus, minLength }: {
  label: string; type: string; value: string; onChange: (v: string) => void;
  required?: boolean; autoFocus?: boolean; minLength?: number;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block mb-2">{label}</span>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        required={required} autoFocus={autoFocus} minLength={minLength}
        className="w-full bg-transparent border-b border-[#0a0a0a]/30 py-3 text-lg tracking-tight focus:outline-none focus:border-[#0a0a0a] transition-colors"
      />
    </label>
  );
}
