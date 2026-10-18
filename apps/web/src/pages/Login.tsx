import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/auth.tsx";
import { Logo } from "../components/Logo.tsx";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] flex flex-col">
      <header className="max-w-[1400px] w-full mx-auto px-8 md:px-12 py-8 flex items-center justify-between">
        <Logo />
        <Link to="/signup" className="text-xs uppercase tracking-[0.18em] hover:opacity-60">
          No account? Sign up
        </Link>
      </header>

      <main className="flex-1 flex items-center">
        <div className="max-w-[1400px] w-full mx-auto px-8 md:px-12 grid md:grid-cols-12 gap-16 py-16">
          <div className="md:col-span-3 text-xs uppercase tracking-[0.18em] text-[#0a0a0a]/55">
            001. Log in
          </div>
          <div className="md:col-span-6">
            <h1 className="text-6xl md:text-8xl font-medium tracking-[-0.04em] leading-[0.9]">
              Welcome back.
            </h1>
            <form onSubmit={async (e) => {
              e.preventDefault(); setErr(null); setLoading(true);
              const { error } = await supabase.auth.signInWithPassword({ email, password });
              setLoading(false);
              if (error) setErr(error.message); else nav("/dashboard");
            }} className="mt-16 max-w-md space-y-8">
              <Field label="Email" type="email" value={email} onChange={setEmail} required autoFocus />
              <Field label="Password" type="password" value={password} onChange={setPassword} required />
              <button disabled={loading}
                className="w-full bg-[#0a0a0a] text-[#f1eee7] py-5 text-sm uppercase tracking-[0.18em] hover:bg-[#1a1a1a] disabled:opacity-50">
                {loading ? "..." : "Log in"}
              </button>
              {err && <div className="text-sm text-red-700 border-l-2 border-red-700 pl-3">{err}</div>}
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({ label, type, value, onChange, required, autoFocus }: {
  label: string; type: string; value: string; onChange: (v: string) => void;
  required?: boolean; autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block mb-2">{label}</span>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        required={required} autoFocus={autoFocus}
        className="w-full bg-transparent border-b border-[#0a0a0a]/30 py-3 text-lg tracking-tight focus:outline-none focus:border-[#0a0a0a] transition-colors"
      />
    </label>
  );
}
