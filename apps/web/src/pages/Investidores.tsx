// /investidores — investor narrative (Seed / Series A). Serious register, same
// palette as the landing. Honest traction (proof-of-tech, pre-revenue). No
// em-dash. The thesis: payments execution moves from trusted backends to
// on-chain rules; the AI orchestrates, the contract controls.

import { Link } from "react-router-dom";
import { Logo } from "../components/Logo.tsx";

const AUDIT_CONTRACT = "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN";
const AUDIT_URL = `https://stellar.expert/explorer/public/contract/${AUDIT_CONTRACT}`;

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <div className={`font-mono text-[10px] uppercase tracking-[0.3em] ${dark ? "text-[#FDDA24]" : "text-[#A16207]"} mb-6`}>{children}</div>;
}

function Block({ k, title, children }: { k: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[#0a0a0a]/10">
      <div className="max-w-[1100px] mx-auto px-6 md:px-12 py-16 md:py-24 grid md:grid-cols-[200px_1fr] gap-8 md:gap-16">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#A16207]">{k}</div>
          <h2 className="mt-3 text-2xl md:text-3xl font-semibold tracking-[-0.02em] leading-tight">{title}</h2>
        </div>
        <div className="text-[17px] text-[#0a0a0a]/75 leading-relaxed space-y-5">{children}</div>
      </div>
    </section>
  );
}

const Li = ({ children }: { children: React.ReactNode }) => (
  <li className="flex gap-3"><span className="text-[#A16207] shrink-0">·</span><span>{children}</span></li>
);

export default function Investidores() {
  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a] overflow-x-hidden">
      <header className="px-6 md:px-12 py-7 flex items-center justify-between border-b border-[#0a0a0a]/10">
        <Link to="/"><Logo /></Link>
        <nav className="flex items-center gap-8 text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55">
          <Link to="/" className="hover:text-[#0a0a0a]">Home</Link>
          <a href="mailto:manuel@bluewaveai.online" className="inline-flex items-center rounded-full px-5 py-2.5 bg-[#FDDA24] text-[#0a0a0a] hover:opacity-90">Falar com a gente</a>
        </nav>
      </header>

      {/* HERO */}
      <section>
        <div className="max-w-[1100px] mx-auto px-6 md:px-12 pt-14 md:pt-24 pb-16 md:pb-24">
          <Eyebrow>SlipPay · seed</Eyebrow>
          <h1 className="text-[36px] leading-[1.0] md:text-[64px] md:leading-[0.98] font-semibold tracking-[-0.04em] max-w-[20ch]">
            Pagamentos automáticos em dólar, com execução baseada em regras on-chain.
          </h1>
          <p className="mt-9 text-xl md:text-2xl text-[#0a0a0a]/65 leading-relaxed max-w-[50ch]">
            A IA orquestra. O contrato controla. O dinheiro fica com o usuário, e cada transação é
            verificável publicamente.
          </p>
        </div>
      </section>

      <Block k="problema" title="A automação existe, mas não é segura nem verificável.">
        <p>Empresas dependem cada vez mais de pagamentos recorrentes globais: SaaS, APIs, fornecedores internacionais, equipes distribuídas.</p>
        <p>O modelo atual é frágil:</p>
        <ul className="space-y-2.5">
          <Li>Cartões têm taxas altas e chargebacks.</Li>
          <Li>Bancos são lentos e centralizados.</Li>
          <Li>A automação financeira depende de backends internos frágeis.</Li>
          <Li>Agentes de IA não podem receber dinheiro diretamente sem risco.</Li>
        </ul>
      </Block>

      <Block k="solução" title="Uma camada de execução financeira on-chain.">
        <ul className="space-y-2.5">
          <Li>As regras são definidas em smart contracts.</Li>
          <Li>Os pagamentos são executados automaticamente.</Li>
          <Li>Os fundos permanecem sob custódia do usuário.</Li>
          <Li>Cada transação é verificável on-chain.</Li>
        </ul>
        <p className="font-medium text-[#0a0a0a]">A IA atua como orquestrador. O contrato é o sistema de controle.</p>
      </Block>

      <Block k="como funciona" title="O usuário define. O dinheiro executa.">
        <ol className="space-y-2.5">
          <Li>O usuário deposita USDC numa carteira não-custodial.</Li>
          <Li>Define as regras de pagamento: limites, destinatários, políticas.</Li>
          <Li>O agente executa os pagamentos recorrentes automaticamente.</Li>
          <Li>O contrato valida cada transação antes de executar.</Li>
        </ol>
        <p className="font-medium text-[#0a0a0a]">Se estiver fora da regra, não executa.</p>
      </Block>

      <Block k="diferenciação" title="Por que não é só mais um.">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#A16207] mb-2">vs Stripe / cartões</div>
          <p>Stripe é custódia, aprovação centralizada e risco de bloqueio. A SlipPay é não-custodial, execução automática e regras imutáveis.</p>
        </div>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#A16207] mb-2">vs automação tradicional</div>
          <p>Os sistemas atuais dependem de um backend confiável. A SlipPay move a lógica crítica para o contrato on-chain.</p>
        </div>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#A16207] mb-2">vs agentes de IA financeiros</div>
          <p>Agentes são vulneráveis a prompt injection e a ataques. A SlipPay isola a decisão (IA) da execução (contrato).</p>
        </div>
      </Block>

      {/* SEGURANÇA — dark */}
      <section className="border-t border-[#0a0a0a]/10 bg-[#0a0a0a] text-[#f1eee7]">
        <div className="max-w-[1100px] mx-auto px-6 md:px-12 py-20 md:py-32">
          <Eyebrow dark>segurança</Eyebrow>
          <h2 className="text-3xl md:text-5xl font-semibold tracking-[-0.035em] leading-[1.0] max-w-[20ch]">O modelo de ameaça assume o comprometimento total do agente.</h2>
          <div className="mt-10 grid sm:grid-cols-2 gap-x-12 gap-y-3 max-w-[60ch] text-lg text-[#f1eee7]/65">
            {["Prompt injection", "Tool abuse", "Memória corrompida", "Dependências maliciosas"].map((x) => (
              <div key={x} className="flex gap-3 border-t border-[#f1eee7]/12 pt-3"><span className="text-[#FDDA24]">·</span><span>{x}</span></div>
            ))}
          </div>
          <p className="mt-10 text-xl md:text-2xl text-[#f1eee7]/80 max-w-[44ch] leading-relaxed">
            Mesmo assim, <span className="text-[#FDDA24] font-medium">o agente não consegue mover fundos fora das regras do contrato.</span>
          </p>
        </div>
      </section>

      <Block k="mercado · por que agora" title="A janela abriu.">
        <ul className="space-y-2.5">
          <Li>Stablecoins reduziram a fricção do dólar global.</Li>
          <Li>A infraestrutura on-chain amadureceu (Stellar, USDC e CCTP da Circle).</Li>
          <Li>Agentes de IA criam a necessidade de execução controlada.</Li>
          <Li>O risco da automação financeira nunca foi tão alto, e a demanda por automação auditável e não-custodial cresce com ele.</Li>
        </ul>
      </Block>

      <Block k="tração" title="Prova de tecnologia. Pré-receita.">
        <p>Estamos no estágio de prova de tecnologia, validando os primeiros casos antes de escalar.</p>
        <ul className="space-y-2.5">
          <Li>Pagamentos reais executados on-chain, na rede principal.</Li>
          <Li>Contratos públicos e verificáveis por qualquer pessoa.</Li>
          <Li>Motor de cobrança recorrente (autocharge com teto), checkout com split de taxa inescapável e recebimento cross-chain via CCTP, todos provados.</Li>
        </ul>
        <p className="text-[15px] text-[#0a0a0a]/45">Sem clientes pagantes ainda. A próxima etapa é fechar os primeiros casos reais.</p>
        <div className="pt-2">
          <a href={AUDIT_URL} target="_blank" rel="noreferrer" className="lift inline-flex items-center gap-2.5 rounded-full px-6 py-3 text-[11px] uppercase tracking-[0.18em] bg-[#FDDA24] text-[#0a0a0a]">Ver o contrato on-chain ↗</a>
        </div>
      </Block>

      <Block k="modelo de negócio" title="SaaS por volume de pagamentos automatizados.">
        <ul className="space-y-2.5">
          <Li>Planos por escala operacional (volume de pagamentos automatizados).</Li>
          <Li>Taxa por transação executada, abaixo do custo de cartão.</Li>
          <Li>Expansão para infraestrutura financeira enterprise.</Li>
        </ul>
      </Block>

      {/* TESE / VISÃO — dark */}
      <section className="border-t border-[#0a0a0a]/10 bg-[#0a0a0a] text-[#f1eee7]">
        <div className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-36">
          <Eyebrow dark>a tese</Eyebrow>
          <p className="text-lg text-[#f1eee7]/55 max-w-[44ch] leading-relaxed">Hoje, empresas automatizam pagamentos confiando em infraestrutura centralizada.</p>
          <h2 className="mt-8 text-4xl md:text-7xl font-semibold tracking-[-0.045em] leading-[0.97] max-w-[20ch]">
            Empresas definem as regras, e o dinheiro <span className="text-[#FDDA24]">executa sozinho dentro delas.</span>
          </h2>
          <p className="mt-12 text-2xl md:text-3xl font-medium tracking-[-0.02em] max-w-[26ch]">
            A próxima camada de pagamentos não é bancária. É programável.
          </p>
          <div className="mt-14 flex flex-wrap gap-4">
            <a href="mailto:manuel@bluewaveai.online" className="lift inline-flex items-center rounded-full px-8 py-4 text-[11px] uppercase tracking-[0.2em] bg-[#FDDA24] text-[#0a0a0a]">Falar com a gente</a>
            <Link to="/seguranca" className="lift inline-flex items-center rounded-full px-8 py-4 text-[11px] uppercase tracking-[0.2em] border border-[#f1eee7]/25 hover:border-[#f1eee7]">A arquitetura de segurança</Link>
          </div>
          <div className="mt-20 font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/30">slippay · a forma segura de deixar software mover dinheiro</div>
        </div>
      </section>
    </div>
  );
}
