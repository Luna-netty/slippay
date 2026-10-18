// /manifesto — bilingual (PT/EN, shares the landing language). Editorial Yeezy
// monumental register. The thesis: don't trust the AI, trust the rules; money
// should become software simple enough to disappear.

import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { LiveProof } from "../components/LiveProof.tsx";
import { V3Ribbon } from "../components/V3Ribbon.tsx";

const display = { fontFamily: "'DM Sans', sans-serif" } as const;
type Lang = "pt" | "en";

const C = {
  en: {
    home: "Home", cta: "Get started",
    blocks: [
      { h: "We wanted money to feel effortless again. So we built SlipPay.", p: ["Not because the world needed another bank. Not because it needed another fintech.", "Because managing money still feels harder than it should. Every year, technology gets smarter — yet somehow money stays complicated.", "More accounts. More approvals. More fees. More things standing between you and your own money.", "We thought there had to be a better way."] },
      { h: "AI changed how we work. Soon it will change how we manage money.", p: ["That's exciting. And a little terrifying.", "You already trust AI with emails, research, code, writing, and decisions. But money is different. A typo in an email is annoying. A mistake with your money is expensive.", "That's why we never believed the future should be “Trust the AI.”", "The future is: trust the rules."], accent: "trust the rules." },
      { h: "Intelligence should move your money. Rules should protect it.", p: ["The AI can do the work. Monitor invoices. Track subscriptions. Handle recurring payments. Execute tasks automatically.", "But every action must pass through rules you approved beforehand. Limits. Recipients. Budgets. Policies.", "The AI can make suggestions. The rules decide what actually happens."] },
      { h: "Your money should stay yours. Always.", p: ["Not ours. Not a bank's. Not an intermediary's. Yours.", "We built SlipPay so your money stays under your control while software does the repetitive work around it.", "No asking permission. No waiting for approvals. No wondering if someone can freeze your account.", "Just money that belongs to you and works for you."] },
      { h: "The technology is complicated. Using it shouldn't be.", p: ["You don't need to understand blockchains. You don't need to learn crypto. You don't need to memorize twelve words. You don't need to become an expert in anything.", "You open an app. You tap a button. It works.", "The most important technologies eventually disappear. Electricity did. The internet did. Smartphones did. Money should too."] },
      { h: "We believe money will become software.", p: ["Programmable. Instant. Global. Always available.", "But most importantly: simple. Simple enough that anyone can use it. Simple enough that nobody needs to think about the technology underneath. Simple enough that it feels obvious."] },
      { h: "That's what we're building.", p: ["Real dollars. Instant payments. Automation with limits. Control without complexity.", "Already running on the real network. Already moving real money. Not a prototype. Not a promise.", "A glimpse of what money looks like when technology finally gets out of the way."], welcome: "Welcome to SlipPay." },
    ],
  },
  pt: {
    home: "Início", cta: "Começar",
    blocks: [
      { h: "A gente queria que dinheiro fosse leve de novo. Por isso construímos o SlipPay.", p: ["Não porque o mundo precisava de mais um banco. Não porque precisava de mais uma fintech.", "Porque cuidar do dinheiro ainda é mais difícil do que deveria. Todo ano a tecnologia fica mais esperta — e mesmo assim o dinheiro continua complicado.", "Mais contas. Mais aprovações. Mais taxas. Mais coisas entre você e o seu próprio dinheiro.", "A gente achou que tinha um jeito melhor."] },
      { h: "A IA mudou como a gente trabalha. Logo vai mudar como a gente cuida do dinheiro.", p: ["Isso é empolgante. E um pouco assustador.", "Você já confia IA com email, pesquisa, código, escrita e decisões. Mas dinheiro é diferente. Um erro de digitação num email é chato. Um erro com o seu dinheiro é caro.", "Por isso nunca acreditamos que o futuro fosse “Confie na IA.”", "O futuro é: confie nas regras."], accent: "confie nas regras." },
      { h: "A inteligência deve mover seu dinheiro. As regras devem protegê-lo.", p: ["A IA pode fazer o trabalho. Monitorar faturas. Acompanhar assinaturas. Cuidar dos pagamentos recorrentes. Executar tarefas automaticamente.", "Mas cada ação passa por regras que você aprovou antes. Limites. Destinatários. Orçamentos. Políticas.", "A IA sugere. As regras decidem o que realmente acontece."] },
      { h: "Seu dinheiro deve continuar seu. Sempre.", p: ["Não nosso. Não de um banco. Não de um intermediário. Seu.", "Construímos o SlipPay pra o seu dinheiro continuar sob o seu controle enquanto o software faz o trabalho repetitivo em volta.", "Sem pedir permissão. Sem esperar aprovação. Sem se perguntar se alguém pode congelar sua conta.", "Só dinheiro que é seu e trabalha pra você."] },
      { h: "A tecnologia é complicada. Usar não deveria ser.", p: ["Você não precisa entender de blockchain. Não precisa aprender cripto. Não precisa decorar doze palavras. Não precisa virar especialista em nada.", "Você abre um app. Toca um botão. Funciona.", "As tecnologias mais importantes acabam desaparecendo. A eletricidade desapareceu. A internet desapareceu. O smartphone desapareceu. O dinheiro também deveria."] },
      { h: "A gente acredita que o dinheiro vai virar software.", p: ["Programável. Instantâneo. Global. Sempre disponível.", "Mas, acima de tudo: simples. Simples o bastante pra qualquer um usar. Simples o bastante pra ninguém precisar pensar na tecnologia embaixo. Simples o bastante pra parecer óbvio."] },
      { h: "É isso que estamos construindo.", p: ["Dólar de verdade. Pagamentos instantâneos. Automação com limites. Controle sem complexidade.", "Já rodando na rede real. Já movendo dinheiro real. Não é protótipo. Não é promessa.", "Um vislumbre de como o dinheiro fica quando a tecnologia finalmente sai do caminho."], welcome: "Bem-vindo ao SlipPay." },
    ],
  },
} as const;

export default function Manifesto() {
  const [lang, setLang] = useState<Lang>(() => {
    try { const s = localStorage.getItem("slippay.lang"); if (s === "pt" || s === "en") return s; } catch { /* */ }
    return (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("pt")) ? "pt" : "en";
  });
  useEffect(() => { try { localStorage.setItem("slippay.lang", lang); } catch { /* */ } }, [lang]);
  const t = C[lang];

  return (
    <div className="relative min-h-screen bg-transparent text-[#0a0a0a] overflow-x-hidden">
      <V3Ribbon />
      <style>{`::selection{background:#2563eb;color:#ffffff}`}</style>
      <header className="px-6 md:px-12 py-7 flex items-center justify-between border-b border-[#0a0a0a]/10">
        <Link to="/" className="text-xl font-bold tracking-[-0.06em] lowercase" style={display}>slippay<span className="text-[#2563eb]">.</span></Link>
        <div className="flex items-center gap-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/50">
            <button onClick={() => setLang("pt")} className={lang === "pt" ? "text-[#0a0a0a]" : "hover:opacity-80"}>PT</button>
            <span className="opacity-30 mx-1">/</span>
            <button onClick={() => setLang("en")} className={lang === "en" ? "text-[#0a0a0a]" : "hover:opacity-80"}>EN</button>
          </div>
          <Link to="/" className="text-[10px] uppercase tracking-[0.24em] text-[#0a0a0a]/55 hover:text-[#0a0a0a]">{t.home}</Link>
        </div>
      </header>

      <main className="max-w-[1000px] mx-auto px-6 md:px-12 pt-16 md:pt-28 pb-24">
        {t.blocks.map((blk, i) => (
          <section key={i} className={i === 0 ? "" : "mt-28 md:mt-44 pt-16 md:pt-24 border-t border-[#0a0a0a]/10"}>
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#6f6862] mb-8">{String(i + 1).padStart(3, "0")}</div>
            <h2 className="font-bold uppercase tracking-[-0.05em] leading-[0.88] text-[clamp(2.25rem,6.5vw,5rem)] max-w-[20ch]" style={display}>
              {"accent" in blk && blk.accent
                ? <>{blk.h.replace(blk.accent, "")}<span className="text-[#6f6862]">{blk.accent}</span></>
                : blk.h}
            </h2>
            <div className="mt-10 flex flex-col gap-5 max-w-[58ch]">
              {blk.p.map((para, j) => <p key={j} className="text-xl md:text-2xl leading-relaxed text-[#0a0a0a]/65">{para}</p>)}
              {"welcome" in blk && blk.welcome && <p className="text-2xl md:text-3xl font-semibold tracking-[-0.02em] text-[#6f6862] mt-4" style={display}>{blk.welcome}</p>}
            </div>
          </section>
        ))}

        <div className="mt-28 pt-16 border-t border-[#0a0a0a]/10 flex flex-wrap items-center gap-7">
          <Link to="/account" className="lift inline-flex items-center rounded-full px-10 py-4 text-[11px] uppercase tracking-[0.22em] bg-[#0a0a0a] text-white">{t.cta}</Link>
          <Link to="/" className="text-[12px] uppercase tracking-[0.18em] text-[#6f6862] hover:text-[#0a0a0a] border-b border-[#0a0a0a]/20 pb-1">{t.home}</Link>
        </div>
        <div className="mt-16"><LiveProof dark lang={lang} /></div>
      </main>
    </div>
  );
}
