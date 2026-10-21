// /conformidade — one-pager regulatório/compliance. Audiência: advogado, parceiro
// VASP licenciado, regulador, investidor. Tese: o SlipPay é infraestrutura que
// torna pagamento automatizado auditável e à prova de desvio, alinhada à
// prioridade declarada do BC de usar inovação pra mitigar fraude e crime.
// HONESTO: não reivindica licença, autorização nem endosso do BC. Opera SOBRE um
// trilho de câmbio/VASP licenciado. Sem em-dash. Paleta da landing.

import { Link } from "react-router-dom";
import { Logo } from "../components/Logo.tsx";

const AUDIT_CONTRACT = "CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN";
const AUDIT_URL = `https://stellar.expert/explorer/public/contract/${AUDIT_CONTRACT}`;

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <div className={`font-mono text-[10px] uppercase tracking-[0.3em] ${dark ? "text-[#FDDA24]" : "text-[#A16207]"} mb-6`}>{children}</div>;
}

const PILLARS = [
  ["Regras imutáveis no contrato", "Limites de gasto, lista de destinatários e condições de pagamento vivem no smart contract, não em uma política interna. Desviar fundo para fora das regras é impossível por design, não por confiança."],
  ["Não-custodial", "Os fundos nunca passam por contas operadas pela SlipPay. Permanecem na carteira do titular. A superfície de custódia, que concentra risco de fraude e bloqueio, é eliminada."],
  ["Rastreabilidade total", "Cada pagamento é uma transação pública e verificável. A trilha de auditoria é nativa, e o rastreamento em cascata exigido em casos de fraude já é a forma padrão de operar, não uma exceção."],
  ["Falha fechada", "Se uma operação está fora das regras, ela não executa. Não existe estado intermediário nem pagamento parcial onde a fraude se esconde."],
  ["Resistente a comprometimento de agente", "O modelo de ameaça assume o comprometimento total do agente de IA: prompt injection, abuso de ferramenta, memória corrompida. Mesmo assim, o agente não consegue mover fundos fora das regras do contrato."],
  ["Identificação e origem dos recursos", "Via o parceiro licenciado, a entrada de recursos segue a identificação do titular e a comprovação de origem exigidas pela regulação do mercado de câmbio."],
];

export default function Conformidade() {
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
      <section className="border-b border-[#0a0a0a]/10">
        <div className="max-w-[1100px] mx-auto px-6 md:px-12 pt-14 md:pt-24 pb-16 md:pb-24">
          <Eyebrow>conformidade e mitigação de fraude</Eyebrow>
          <h1 className="text-[34px] leading-[1.0] md:text-[60px] md:leading-[0.98] font-semibold tracking-[-0.04em] max-w-[22ch]">
            Infraestrutura que torna o pagamento automatizado auditável e à prova de desvio.
          </h1>
          <p className="mt-9 text-xl md:text-2xl text-[#0a0a0a]/65 leading-relaxed max-w-[54ch]">
            O Banco Central tem como prioridade usar inovação para mitigar fraude e crime organizado. A
            arquitetura da SlipPay foi desenhada exatamente nessa direção: a decisão é separada da execução,
            e a execução obedece a regras gravadas em contrato, públicas e verificáveis.
          </p>
        </div>
      </section>

      {/* O PRINCÍPIO — dark */}
      <section className="border-b border-[#0a0a0a]/10 bg-[#0a0a0a] text-[#f1eee7]">
        <div className="max-w-[1100px] mx-auto px-6 md:px-12 py-20 md:py-32">
          <Eyebrow dark>o princípio</Eyebrow>
          <h2 className="text-3xl md:text-5xl font-semibold tracking-[-0.035em] leading-[1.0] max-w-[20ch]">
            A regra vive no contrato. <span className="text-[#FDDA24]">Não na pessoa, nem no agente.</span>
          </h2>
          <p className="mt-10 text-xl text-[#f1eee7]/70 leading-relaxed max-w-[52ch]">
            Quem decide o pagamento é a IA. Quem executa e valida é o contrato. Um agente comprometido, um
            insider mal-intencionado ou uma instrução fraudulenta esbarram no mesmo limite imutável: o
            contrato não executa nada fora do que foi previamente autorizado.
          </p>
        </div>
      </section>

      {/* COMO MITIGA FRAUDE */}
      <section className="border-b border-[#0a0a0a]/10">
        <div className="max-w-[1100px] mx-auto px-6 md:px-12 py-20 md:py-32">
          <Eyebrow>como a slippay mitiga fraude</Eyebrow>
          <div className="mt-12 grid md:grid-cols-2 gap-x-14 gap-y-9">
            {PILLARS.map(([t, b]) => (
              <div key={t} className="flex gap-4 border-t border-[#0a0a0a]/12 pt-6">
                <span className="text-[#A16207] text-lg shrink-0 leading-none mt-1">✓</span>
                <div>
                  <div className="text-[19px] font-semibold tracking-[-0.01em]">{t}</div>
                  <p className="mt-2 text-[15px] text-[#0a0a0a]/65 leading-relaxed">{b}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ALINHAMENTO REGULATÓRIO */}
      <section className="border-b border-[#0a0a0a]/10">
        <div className="max-w-[1100px] mx-auto px-6 md:px-12 py-20 md:py-32">
          <Eyebrow>posição regulatória</Eyebrow>
          <h2 className="text-3xl md:text-5xl font-semibold tracking-[-0.035em] leading-[1.0] max-w-[20ch]">Construída para operar dentro da regra, não em volta dela.</h2>
          <div className="mt-12 space-y-7 text-[17px] text-[#0a0a0a]/75 leading-relaxed max-w-[68ch]">
            <p><span className="font-semibold text-[#0a0a0a]">Opera sobre um trilho licenciado.</span> A SlipPay não pretende substituir uma instituição de câmbio nem uma instituição de pagamento. A entrada e a conversão de recursos passam por um parceiro autorizado a operar câmbio, sob as diretrizes vigentes para prestadores de serviços de ativos virtuais.</p>
            <p><span className="font-semibold text-[#0a0a0a]">Uso doméstico em real é do Pix.</span> A SlipPay não disputa o pagamento doméstico em real. Seu valor está no dólar digital, na automação auditável e na execução controlada, que o Pix não cobre.</p>
            <p><span className="font-semibold text-[#0a0a0a]">Câmbio integrado.</span> Operações com stablecoin seguem a regulação do mercado de câmbio, com identificação do titular e comprovação de origem dos recursos. A SlipPay carrega essas exigências para dentro do fluxo, junto ao parceiro licenciado.</p>
            <p><span className="font-semibold text-[#0a0a0a]">Parceira que reduz risco.</span> Para uma instituição licenciada, a SlipPay é a camada que torna o fluxo de stablecoin auditável, com regras imutáveis e à prova de desvio. Reduz o risco de fraude da operação, em vez de aumentá-lo.</p>
          </div>
        </div>
      </section>

      {/* O QUE NÃO É — honestidade de fronteira */}
      <section className="border-b border-[#0a0a0a]/10">
        <div className="max-w-[1100px] mx-auto px-6 md:px-12 py-20 md:py-28">
          <Eyebrow>fronteiras claras</Eyebrow>
          <h2 className="text-3xl md:text-5xl font-semibold tracking-[-0.035em] leading-[1.0] max-w-[18ch]">O que a SlipPay não é.</h2>
          <div className="mt-12 grid sm:grid-cols-2 gap-x-12 gap-y-3 max-w-[70ch] text-lg text-[#0a0a0a]/65">
            {[
              "Não é custódia. Os fundos não ficam conosco.",
              "Não é instituição de pagamento operando remessa por fora do câmbio.",
              "Não é stablecoin de real para pagamento doméstico.",
              "Não reivindica licença nem endosso de qualquer regulador.",
            ].map((x) => (
              <div key={x} className="flex gap-3 border-t border-[#0a0a0a]/12 pt-4"><span className="text-[#0a0a0a]/30">·</span><span>{x}</span></div>
            ))}
          </div>
          <p className="mt-10 text-xl text-[#0a0a0a]/80 max-w-[44ch] leading-relaxed">
            É uma camada de execução auditável e à prova de desvio, sobre um trilho licenciado.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#0a0a0a] text-[#f1eee7]">
        <div className="max-w-[1100px] mx-auto px-6 md:px-12 py-24 md:py-36 text-center">
          <h2 className="text-4xl md:text-6xl font-semibold tracking-[-0.045em] leading-[1.0] max-w-[20ch] mx-auto">Inovação a favor de quem fiscaliza, não contra.</h2>
          <div className="mt-12 flex flex-wrap justify-center gap-4">
            <a href="mailto:manuel@bluewaveai.online" className="lift inline-flex items-center rounded-full px-8 py-4 text-[11px] uppercase tracking-[0.2em] bg-[#FDDA24] text-[#0a0a0a]">Falar com a gente</a>
            <a href={AUDIT_URL} target="_blank" rel="noreferrer" className="lift inline-flex items-center rounded-full px-8 py-4 text-[11px] uppercase tracking-[0.2em] border border-[#f1eee7]/25 hover:border-[#f1eee7]">Ver o contrato on-chain</a>
            <Link to="/seguranca" className="lift inline-flex items-center rounded-full px-8 py-4 text-[11px] uppercase tracking-[0.2em] border border-[#f1eee7]/25 hover:border-[#f1eee7]">A arquitetura de segurança</Link>
          </div>
          <div className="mt-20 font-mono text-[10px] uppercase tracking-[0.22em] text-[#f1eee7]/30">slippay · execução auditável e à prova de desvio</div>
        </div>
      </section>
    </div>
  );
}
