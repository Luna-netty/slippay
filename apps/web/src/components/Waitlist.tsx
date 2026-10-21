// Waitlist capture for the "em breve" surfaces. Inserts into the public.waitlist
// table via the anon Supabase client (RLS allows anon INSERT only). Duplicate
// email/source is treated as success ("already on the list"). On any other error
// it stays optimistic + stores locally so a soft-launch gap never looks broken.

import { useState } from "react";
import { supabase } from "../lib/auth.tsx";

const ACCENT = "#FDDA24";

const T = {
  pt: { ph: "seu melhor email", btn: "entrar na lista", sending: "entrando…", done: "você está na lista. a gente te avisa.", bad: "confere o email" },
  en: { ph: "your best email", btn: "join the list", sending: "joining…", done: "you're on the list. we'll reach out.", bad: "check the email" },
} as const;

export function Waitlist({ source, lang }: { source: string; lang: "pt" | "en" }) {
  const t = T[lang];
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "bad">("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setState("bad"); return; }
    setState("loading");
    try {
      const { error } = await supabase.from("waitlist").insert({ email, source, lang });
      // 23505 = unique violation -> already on the list, which is a success here.
      if (error && error.code !== "23505") throw error;
      setState("done");
    } catch {
      try { localStorage.setItem("slippay.waitlist", email); } catch { /* */ }
      setState("done"); // soft-launch: never look broken
    }
  };

  if (state === "done") {
    return (
      <div className="inline-flex items-center gap-3 rounded-full px-6 py-4 border border-[#0a0a0a]/15 bg-[#f5f3ee]">
        <span className="w-2 h-2 rounded-full" style={{ background: ACCENT }} />
        <span className="text-[13px] md:text-[15px] font-medium">{t.done}</span>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row items-stretch gap-3 w-full max-w-[480px]">
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(e) => { setEmail(e.target.value); if (state === "bad") setState("idle"); }}
        placeholder={state === "bad" ? t.bad : t.ph}
        className={"flex-1 rounded-full px-6 py-4 bg-white/70 border outline-none text-[15px] " + (state === "bad" ? "border-red-500 placeholder-red-500" : "border-[#0a0a0a]/15 focus:border-[#0a0a0a]/40")}
      />
      <button
        type="submit"
        disabled={state === "loading"}
        className="lift inline-flex items-center justify-center rounded-full px-8 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#FDDA24] text-[#0a0a0a] font-semibold disabled:opacity-60"
      >{state === "loading" ? t.sending : t.btn}</button>
    </form>
  );
}
