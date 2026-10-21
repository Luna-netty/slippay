import type { ReactNode } from "react";
import type { Lang } from "../lib/lang.ts";

// Landing copy, PT + EN. Markup-bearing strings (headlines/paragraphs with
// <em>/<br/>) are JSX nodes so emphasis survives translation. Plain strings
// (labels, component props) stay strings. Both langs share the same shape.
//
// POSITIONING (2026-06-01): DOLLAR INBOX — the dollar account for Brazilians
// who EARN in dollars (freelancers, IT/dev exporters, creators, gig workers).
// The wedge: you earn in dollars and lose 5–12% on the way in (StoneX ~10-day
// holds on one typo, Payoneer/Wise 2–5% skim, frozen accounts, 3.5% IOF +
// spread on every conversion). Slippay: the dollar arrives and STAYS a dollar —
// yours, that nobody can freeze — and becomes reais on Pix only when YOU choose.
// No 12-word seed phrase. The incumbents (Nubank, Inter, C6, Nomad, Wise) all
// optimize the INVERSE flow (sending reais OUT to buy US stocks), so the inbound
// dollar-EARNER is who they ignore — that's the opening.
//
// LANGUAGE: PT is PRIMARY (audience reads Portuguese). EN is the secondary
// mirror. PT voice: "você" + 3rd person. NEVER creole BR-PT ("você recebe",
// never "tu recebe/tu pode").
//
// HARD HONESTY (NON-NEGOTIABLE — this is pre-revenue; the overclaim risk now is
// faking a working product):
//   - The receive→hold→spend-via-Pix LOOP is NOT live. The Pix on/off-ramp needs
//     a LICENSED partner still being set up. Say it plainly: early access /
//     waitlist, "o Pix entra via um parceiro licenciado (em definição)". Do NOT
//     present "spend in reais via Pix today" as a working feature.
//   - What IS real: the no-seed-phrase self-custody wallet design + the agent
//     spend-limit PROOF. But the proof/agent wallet is TESTNET + self-audited —
//     mark "pending mainnet + outside audit", never "proven in production".
//   - REGULATORY: STRICTLY DOMESTIC — hold dollars + spend domestically +
//     receive your own inbound. NEVER claim cross-border SEND / remittance —
//     Res 561 (effective Oct 1 2026) bans stablecoin on the offshore leg. No
//     remittance claims anywhere.
//   - "The money is yours, never ours" (self-custody) is true and load-bearing.
//   - No jargon in the lead (no USDC/Stellar/Soroban/testnet/seed-phrase as
//     jargon in headlines — say "dollars", "a test version", "no password to
//     memorize"). Jargon only in the for-builders footnote, if at all.

const dot = <span className="inline-block align-baseline ml-1.5 w-2 md:w-2.5 h-2 md:h-2.5 bg-[#FDDA24]" />;

export interface HomeStrings {
  nav: { how: string; docs: string; login: string; signup: string; home: string; agents: string };
  mobileFooter: string;
  // BRIDGE — the single handoff line + button from the human landing (A) to the
  // builder/agent page (B). Sits low on the home page; the home stays zero-tech.
  bridge: { line: ReactNode; button: string };
  // AGENTS PAGE (Narrativa B) — the credibility surface for builders, investors
  // and the Stellar ecosystem. Leads with the verifiable on-chain artifacts, NOT
  // the abstract claim. Framed WITH Stellar's passkey primitive, never "first".
  agents: {
    badge: string; h1: ReactNode; sub: ReactNode;
    liveLabel: string;        // eyebrow over the mainnet proof (the lead)
    certLabel: string;        // eyebrow over the axlc spend-limit proof
    standardLabel: string;    // eyebrow over the x402 backing
    demoCta: string;          // "Ver a demo x402 →"
    back: string;             // "← a conta em dólar"
  };
  // PAYMENT FLOW — the biometric "point, look, paid" section next to the
  // animated device. Was hardcoded PT; now bilingual.
  payflow: { label: string; h2: string; body: string; cta: string };
  hero: {
    badge: string; eyebrow: string; h1: ReactNode; sub: ReactNode; cta: string; status: ReactNode;
  };
  // BUILT FOR WHAT'S NEXT — the agent future is the MOAT, not the headline.
  // x402's PUBLIC backing = authority for the rail the agent-future builds on.
  // Attributed to x402 (not Slippay); the source line states plainly that
  // Slippay is not a member, so the authority is borrowed honestly. The agent
  // spend-limit proof is labeled ROADMAP (testnet + outside audit pending).
  standard: {
    label: string; h2: ReactNode; backersLabel: string; backers: string[]; source: string; bridge: ReactNode;
  };
  // THE PAIN — the dollar-earner loses 5–12% on the way in. Concrete, human:
  // StoneX 10-day holds, the freeze, the 2–5% skim, the 3.5% IOF. Only b2 and b3
  // render on the page.
  gap: {
    label: string;
    b1: ReactNode;
    b2Label: string; b2: ReactNode;
    b3Label: string; b3: ReactNode;
  };
  // LOSS CALCULATOR — makes the abstract "5–12%" concrete and emotional.
  // STATUS-QUO LOSS ONLY: never computes a "Slippay saves you $X" figure, since
  // the full receive→hold→Pix loop is early-access. The ~1–2% target is stated
  // as context (consistent with proof.proveLabel), not as a delivered saving.
  calc: {
    label: string; title: string; lossLabel: string; youReceive: string;
    perMonth: string; perYear: string; over3y: string; foot: string;
  };
  // HOW YOU USE IT — the plain 3-step consumer flow (face login → get paid in
  // dollars → cash out on Pix). Answers "how does a person actually use this?".
  howto: {
    label: string; h2: ReactNode; steps: { n: string; t: string; b: string }[]; foot: string;
  };
  // HOW IT'S DIFFERENT — three plain reasons: no seed phrase, self-custody, the
  // dollar rail costs ~1–2% not 5–12%. The for-builders terminal card is the
  // only place jargon/formula appears.
  proof: {
    label: string; kicker: string; h2: ReactNode; body: string;
    invariantLabel: string; invariantBody: string;
    certLabel: string; certBody: string;
    proveLabel: string; proveBody: string;
    refuseLabel: string; refuseBody: string;
    codeToggle: string; codeAside: string;
    codeTitle: string; code: string;
    runline: string;
    specLink: string;
    seeItWork: string;
  };
  // HONEST STATUS — the loop is not live (Pix via a licensed partner being
  // defined), self-custody wallet design is real, agent proof is testnet +
  // outside audit to come. Strictly domestic.
  status: {
    label: string; kicker: string; h2: ReactNode; body: ReactNode;
    cNetwork: string; cNetworkV: string;
    cAudit: string; cAuditV: string;
    cBound: string; cBoundV: string;
    cChain: string; cChainV: string;
    mainnetLabel: string; mainnetBody: string; mainnetContract: string; mainnetTx: string; mainnetBio: string; mainnetNote: string;
  };
  // CTA — one waitlist ask.
  cta: { kicker: string; h2: ReactNode; body: string; button: string; spec: string };
  footer: {
    product: string; resources: string; legal: string;
    fSignup: string; fLogin: string; fHow: string;
    fApi: string; fGuides: string; fAudits: string; fX402: string; fSsl: string;
    fTerms: string; fPrivacy: string;
  };
}

const pt: HomeStrings = {
  nav: { how: "Como funciona", docs: "Docs", login: "Entrar", signup: "Entrar na lista", home: "Início", agents: "Agents" },
  mobileFooter: "você ganha em dólar · o dólar chega e fica dólar · vira real no Pix só quando você quiser",
  bridge: {
    line: <>Uma conta feita para humanos hoje <em className="font-light">e agentes amanhã.</em></>,
    button: "Conheça Agents",
  },
  agents: {
    badge: "Para builders e a economia de agentes",
    h1: <>Pagamentos entre agentes,<br/><em className="not-italic">com o limite provado.{dot}</em></>,
    sub: <>Construído sobre o primitivo de passkey da Stellar. O que a gente acrescenta: <em className="font-light">provar, on-chain, que um agente não passa do limite que você definir</em> — e mostrar isso liquidado na mainnet, não no slide. Rede de teste para o limite do agente; mainnet e auditoria de fora a seguir.</>,
    liveLabel: "┃ Já vive na mainnet pública — confere on-chain",
    certLabel: "┃ O limite do agente, provado por máquina",
    standardLabel: "┃ O padrão que torna isso possível",
    demoCta: "Ver a demo x402",
    back: "← a conta em dólar",
  },
  payflow: {
    label: "┃ é assim que paga",
    h2: "Pague tocando na tela",
    body: "Aponta a câmera no QR, olha pra tela, e o dólar sai — sem senha, sem frase de doze palavras. Seu rosto autoriza, a blockchain confirma.",
    cta: "Testa no seu celular",
  },
  hero: {
    badge: "Acesso antecipado — entre na lista",
    eyebrow: "PARA QUEM RECEBE EM DÓLAR E JÁ VIU A CONTA CONGELAR",
    h1: <>Seu dólar <em className="not-italic">no Pix.{dot}</em></>,
    sub: <>Hoje você perde de 5% a 12% só pra receber: a plataforma segura dez dias, o intermediário fica com a parte dele, e ainda vem o IOF e o spread do banco. No Slippay <em className="font-light">o dólar chega e continua dólar</em> — seu, ninguém congela — e vira real no Pix quando você quiser. Sem senha de doze palavras.</>,
    cta: "Entrar na lista",
    status: <>Acesso antecipado. O dólar que chega e fica dólar — a chave é sua, ninguém congela — é o que estamos construindo; o Pix entra via um parceiro licenciado, em definição. A gente conta o estágio em voz alta. Pesquisa de mercado de 01/06/2026.</>,
  },
  standard: {
    label: "┃ Feito para o que vem a seguir",
    h2: <>Sua conta em dólar pronta pra quando um assistente de IA trabalhar por você: o limite que você põe, ele não consegue passar. <em className="font-light">Não é promessa, é trava. Ainda em teste.</em></>,
    backersLabel: "Por trás desse trilho (x402) — informação pública em x402.org",
    backers: ["Visa", "Mastercard", "American Express", "Stripe", "Coinbase", "Cloudflare", "Google", "Amazon · AWS", "Circle", "Shopify", "Fiserv", "Adyen"],
    source: "Padrão x402 · informação pública em x402.org. O Slippay constrói sobre ele — não faz parte desse grupo.",
    bridge: <>Eles tornam o pagamento de agentes possível. <em className="font-light">A gente acrescenta a parte que falta: provar que o agente não passa do limite que você definir. Em rede de teste hoje — mainnet e auditoria de fora a seguir.</em></>,
  },
  gap: {
    label: "┃ A dor",
    b1: <>Você fecha um trabalho em dólar e o dinheiro demora pra chegar. <em className="font-light">E quando chega, já chega menor.</em></>,
    b2Label: "Você perde em cinco lugares, não num só",
    b2: <>Você ganha em dólar e perde de 5% a 12% só na entrada. <em className="font-light">A plataforma segura seu dinheiro dez dias por um dado digitado errado.</em> O intermediário fica com 2% a 5%, a conta congela sem aviso, e cada conversão come 3,5% de IOF mais o spread.</>,
    b3Label: "O que ninguém resolve",
    b3: <>Bancos e fintechs olham pro caminho contrário: mandar real <em className="font-light">pra fora</em> comprar ação americana. <em className="font-light">Quem ganha dólar e quer manter dólar fica de fora</em> — é esse buraco que a gente preenche.</>,
  },
  calc: {
    label: "┃ Faz a conta",
    title: "Quanto você recebe por mês em dólar?",
    lossLabel: "O que você perde hoje só na entrada",
    youReceive: "Você recebe",
    perMonth: "por mês",
    perYear: "por ano",
    over3y: "em 3 anos",
    foot: "Conta feita sobre 5% a 12% — retenção, intermediário, IOF e spread, os mesmos vazamentos de cima. No Slippay esse caminho fica perto de 1% a 2%. Ainda em acesso antecipado.",
  },
  howto: {
    label: "┃ Como você usa",
    h2: <>Três passos.<br/><em className="font-light">Sua mãe consegue.</em></>,
    steps: [
      { n: "01", t: "Entra com o rosto", b: "Sem senha, sem frase de doze palavras pra decorar. Você entra com a digital ou o rosto, igual a qualquer aplicativo." },
      { n: "02", t: "Recebe em dólar", b: "O dólar que você ganha cai na sua conta e continua dólar — sob a sua chave, que ninguém congela." },
      { n: "03", t: "Saca no Pix quando quiser", b: "Precisou de real? Um toque e ele cai no seu Pix, por um parceiro licenciado. Só quando você decidir." },
    ],
    foot: "Sem decorar nada, sem intermediário, sem conta congelada. O Pix entra via parceiro licenciado — essa parte ainda está sendo montada.",
  },
  proof: {
    label: "┃ Como é diferente", kicker: "001 · Três motivos simples",
    h2: <>O dinheiro é seu — ninguém congela.<br/><em className="font-light">Sua chave, seu rosto, ninguém no meio tirando sua parte.</em></>,
    body: "Três motivos: você entra com o rosto, sem senha pra decorar. O dólar é seu — a chave fica com você, ninguém congela nem bloqueia. E o caminho custa ~1%, não 12%: você fica com o que ganhou. O real cai no Pix por um parceiro licenciado — ainda sendo montado, e a gente diz na cara.",
    invariantLabel: "Sem senha de doze palavras",
    invariantBody: "Você não decora frase secreta nenhuma. Entra pela biometria do celular, como qualquer aplicativo que você já usa. Sua mãe consegue usar. Não tem aquele papelzinho com doze palavras que, se você perder, perde o dinheiro.",
    certLabel: "Ninguém congela o seu dólar — nem a gente",
    certBody: "A chave da sua conta é sua, não nossa. Isso significa que a gente literalmente não consegue congelar nem bloquear o seu dólar — nem que quisesse, nem que mandassem. Diferente da plataforma que trava sua conta e te deixa dez dias no escuro.",
    proveLabel: "O caminho do dólar custa ~1% a 2%",
    proveBody: "O trilho que a gente usa para o dólar chegar e ficar dólar custa por volta de 1% a 2%, não os 5% a 12% que você perde hoje com hold, skim e spread. Você fica com mais do que ganhou.",
    refuseLabel: "Real no Pix só quando você quiser",
    refuseBody: "Seu dólar fica dólar o tempo todo. Quando você precisar de real, ele vira real no Pix por um parceiro licenciado — esse pedaço ainda está em definição, e a gente conta isso em voz alta em vez de fingir que já funciona.",
    codeToggle: "Para builders: como o limite do agente é provado",
    codeAside: "Isto é o que um desenvolvedor vê — você não precisa entender essa parte. É o roteiro do agente: o limite por janela é provado por máquina (Z3) para qualquer ordem de ações. Hoje roda em rede de teste (Stellar/Soroban), checado por nós, sem auditoria de fora ainda. O pior caso do total ao longo de uma janela móvel fica preso a cerca do dobro desse limite, por um passo geométrico enunciado que ainda não checamos por máquina.",
    codeTitle: "para quem é da área · a prova do limite de gasto do agente",
    code: `# roteiro · o limite de gasto do agente, provado por máquina
invariant spent_in_epoch <= window_cap

#  base: spent_in_epoch(s0) = 0 <= window_cap        ✓
#  step: ∀ a. spent' = spent + pay(a)
#        pay(a) <= remaining  ⇒  spent' <= window_cap ✓
#  lemma (declarado): janela ⊆ época_i ∪ época_{i+1}
#        ⇒  outflow_window <= 2 · window_cap

$ axlc prove agent_budget.axl
  limite por janela ............... PROVADO  (0.4s · rede de teste)
  política sem limite ............. RECUSADA (sem teto)`,
    runline: "PROVADO em rede de teste · roda em 0,4s · mainnet e auditoria de fora a seguir",
    specLink: "Para builders: ler a especificação ↗",
    seeItWork: "Ver o roteiro do agente",
  },
  status: {
    label: "┃ A verdade nua", kicker: "005 · Em que estágio a gente está, dito em voz alta",
    h2: <>O que já é real.<br/><em className="font-light">E o que ainda está sendo montado.</em></>,
    body: <>Já é real: a carteira sem senha de decorar — <em className="font-light">o dólar chega, fica dólar e é seu</em>. Ainda não no ar: o ciclo completo de virar real no Pix — <em className="font-light">via parceiro licenciado, em definição</em>. A prova de limite do agente roda em rede de teste, com auditoria de fora por vir. Por isso é acesso antecipado, não "use hoje". Tudo doméstico — sem remessa pra fora. Contar o estágio em voz alta é sinal de confiança.</>,
    cNetwork: "Carteira", cNetworkV: "Autocustódia · sem senha de decorar (em construção)",
    cAudit: "Pix", cAuditV: "Via parceiro licenciado · em definição",
    cBound: "Limite do agente", cBoundV: "Rede de teste · auditoria de fora por vir",
    cChain: "Alcance", cChainV: "Doméstico · sem remessa para fora",
    mainnetLabel: "Já vive na mainnet pública",
    mainnetBody: "O contrato Slippay, uma transação USDC e um pagamento autorizado por biometria estão liquidados na rede principal do Stellar — não é testnet, não é mockup. Confere on-chain:",
    mainnetContract: "Contrato na mainnet",
    mainnetTx: "Transação USDC",
    mainnetBio: "Pagamento por biometria",
    mainnetNote: "Transações de verificação. O toque de biometria no celular contra a mainnet e o ciclo completo com cliente e Pix ainda são acesso antecipado.",
  },
  cta: {
    kicker: "005 · Próximo passo",
    h2: <>O dólar que é seu,<br/><em className="font-light">no Pix quando você quiser.</em></>,
    body: "Entre na lista de acesso antecipado. A gente avisa quando o ciclo de receber, segurar e virar real no Pix estiver no ar com o parceiro licenciado. Sem remessa pra fora.",
    button: "Quero manter meu dólar em dólar",
    spec: "Para builders: ler a especificação",
  },
  footer: {
    product: "┃ Produto", resources: "┃ Recursos", legal: "┃ Legal",
    fSignup: "Entrar na lista", fLogin: "Entrar", fHow: "Como funciona",
    fApi: "Referência da API", fGuides: "Guias", fAudits: "Auditoria · de fora por vir", fX402: "Padrão x402", fSsl: "Especificação ↗",
    fTerms: "Termos", fPrivacy: "Privacidade",
  },
};

const en: HomeStrings = {
  nav: { how: "How it works", docs: "Docs", login: "Log in", signup: "Join the list", home: "Home", agents: "Agents" },
  mobileFooter: "you earn in dollars · the dollar arrives and stays a dollar · it becomes reais on Pix only when you choose",
  bridge: {
    line: <>An account built for humans today <em className="font-light">and agents tomorrow.</em></>,
    button: "Explore Agents",
  },
  agents: {
    badge: "For builders and the agent economy",
    h1: <>Agent-to-agent payments,<br/><em className="not-italic">with the limit proven.{dot}</em></>,
    sub: <>Built on Stellar's passkey primitive. What we add: <em className="font-light">proving, on-chain, that an agent can't exceed the limit you set</em> — and showing it settled on mainnet, not on a slide. Testnet for the agent limit; mainnet and an outside audit to come.</>,
    liveLabel: "┃ Already live on public mainnet — verify on-chain",
    certLabel: "┃ The agent's limit, machine-proven",
    standardLabel: "┃ The standard that makes it possible",
    demoCta: "See the x402 demo",
    back: "← the dollar account",
  },
  payflow: {
    label: "┃ this is how you pay",
    h2: "Pay with a touch",
    body: "Point the camera at the QR, look at the screen, and the dollar goes out — no password, no twelve-word phrase. Your face authorizes, the blockchain confirms.",
    cta: "Try it on your phone",
  },
  hero: {
    badge: "Early access — join the list",
    eyebrow: "FOR PEOPLE WHO EARN IN DOLLARS AND HAVE WATCHED AN ACCOUNT FREEZE",
    h1: <>Your dollar account<br/><em className="not-italic">that lives in Pix.{dot}</em></>,
    sub: <>Today you lose 5% to 12% just to get paid: the platform holds it ten days, the middleman takes a cut, then come IOF and the bank's spread. With Slippay <em className="font-light">the dollar arrives and stays a dollar</em> — yours, nobody can freeze it — and becomes reais on Pix when you choose. No twelve-word seed phrase.</>,
    cta: "Get early access",
    status: <>Early access. The dollar that arrives and stays a dollar — your key, nobody can freeze it — is what we're building; Pix comes in through a licensed partner, still being set up. We say the stage out loud. Market survey as of 2026-06-01.</>,
  },
  standard: {
    label: "┃ Built for what's next",
    h2: <>Your dollar account, ready for when an AI assistant works for you: the limit you set, it can't cross. <em className="font-light">Not a promise — a lock. Still in testing.</em></>,
    backersLabel: "Behind these rails (x402) — public info at x402.org",
    backers: ["Visa", "Mastercard", "American Express", "Stripe", "Coinbase", "Cloudflare", "Google", "Amazon · AWS", "Circle", "Shopify", "Fiserv", "Adyen"],
    source: "x402 standard · public info at x402.org. Slippay builds on it — not a member of their group.",
    bridge: <>They make agent payments possible. <em className="font-light">We add the missing piece: proving the agent can't go over the limit you set. On a test network today — mainnet and an outside audit are next.</em></>,
  },
  gap: {
    label: "┃ The pain",
    b1: <>You close a job in dollars and the money takes its time to arrive. <em className="font-light">And when it lands, it already lands smaller.</em></>,
    b2Label: "You lose in five places, not one",
    b2: <>You earn in dollars and lose 5% to 12% just on the way in. <em className="font-light">The platform holds your money ten days over one mistyped detail.</em> The middleman skims 2% to 5%, the account freezes with no warning, and every conversion eats 3.5% IOF plus spread.</>,
    b3Label: "What nobody fixes",
    b3: <>Banks and fintechs all look at the opposite flow: sending reais <em className="font-light">out</em> to buy US stocks. <em className="font-light">The person who earns dollars and wants to keep dollars is left out</em> — that's the gap we fill.</>,
  },
  calc: {
    label: "┃ Run the numbers",
    title: "How much do you receive per month in dollars?",
    lossLabel: "What you lose today, just on the way in",
    youReceive: "You receive",
    perMonth: "per month",
    perYear: "per year",
    over3y: "over 3 years",
    foot: "Based on 5% to 12% — holds, middleman, IOF and spread, the same leaks as above. With Slippay this path is closer to 1% to 2%. Still in early access.",
  },
  howto: {
    label: "┃ How you use it",
    h2: <>Three steps.<br/><em className="font-light">Anyone can do it.</em></>,
    steps: [
      { n: "01", t: "Sign in with your face", b: "No password, no twelve-word phrase to memorize. Fingerprint or face, like any app you already use." },
      { n: "02", t: "Get paid in dollars", b: "The dollars you earn land in your account and stay dollars — under your key, that nobody can freeze." },
      { n: "03", t: "Cash out on Pix anytime", b: "Need reais? One tap and they land in your Pix, through a licensed partner. Only when you decide." },
    ],
    foot: "Nothing to memorize, no middleman, no frozen account. Pix comes in through a licensed partner — that part is still being set up.",
  },
  proof: {
    label: "┃ How it's different", kicker: "001 · Three plain reasons",
    h2: <>The money is yours — nobody can freeze it.<br/><em className="font-light">Your key, your face, no middleman taking a cut.</em></>,
    body: "Three reasons: you sign in with your face — no password to memorize. The dollar is yours — the key stays with you, nobody freezes or blocks it. And the path costs ~1%, not 12%: you keep what you earned. Reais land on Pix through a licensed partner — still being set up, and we say it plainly.",
    invariantLabel: "No twelve-word seed phrase",
    invariantBody: "You memorize no secret phrase. You sign in with your phone's biometrics, like any app you already use. Your mother can use it. There's no slip of paper with twelve words that, if you lose it, you lose the money.",
    certLabel: "Nobody can freeze your dollars — not even us",
    certBody: "The key to your account is yours, not ours. Which means we literally can't freeze or block your dollar — not if we wanted to, not if someone ordered us to. Unlike the platform that locks your account and leaves you ten days in the dark.",
    proveLabel: "The dollar's path costs ~1% to 2%",
    proveBody: "The rail we use to make the dollar arrive and stay a dollar costs around 1% to 2%, not the 5% to 12% you lose today to holds, skims and spread. You keep more of what you earned.",
    refuseLabel: "Reais on Pix only when you choose",
    refuseBody: "Your dollar stays a dollar the whole time. When you need reais, it becomes reais on Pix through a licensed partner — that piece is still being set up, and we say it out loud instead of pretending it already works.",
    codeToggle: "For builders: how the agent limit is proved",
    codeAside: "This is what a developer sees — you don't need to follow this part. It's the agent roadmap: the per-window limit is machine-proved (Z3) for any order of moves. Today it runs on a test network (Stellar/Soroban), checked by us, with no outside audit yet. The worst-case total over a rolling window is bounded to about twice that limit by a stated geometric step we haven't machine-checked yet.",
    codeTitle: "for builders · the agent spending-limit proof",
    code: `# roadmap · the agent spending limit, machine-checked
invariant spent_in_epoch <= window_cap

#  base: spent_in_epoch(s0) = 0 <= window_cap        ✓
#  step: ∀ a. spent' = spent + pay(a)
#        pay(a) <= remaining  ⇒  spent' <= window_cap ✓
#  lemma (stated): window ⊆ epoch_i ∪ epoch_{i+1}
#        ⇒  outflow_window <= 2 · window_cap

$ axlc prove agent_budget.axl
  per-window limit ................ PROVED   (0.4s · test network)
  policy with no limit ............ REFUSED  (no cap)`,
    runline: "PROVED on a test network · runs in 0.4s · mainnet and outside audit next",
    specLink: "For builders: read the spec ↗",
    seeItWork: "See the agent roadmap",
  },
  status: {
    label: "┃ The honest truth", kicker: "005 · What stage we're at, said out loud",
    h2: <>What's already real.<br/><em className="font-light">And what's still being built.</em></>,
    body: <>Already real: the no-seed-phrase wallet — <em className="font-light">the dollar arrives, stays a dollar, and is yours</em>. Not live yet: the full loop to reais on Pix — <em className="font-light">via a licensed partner, still being defined</em>. The agent spend-limit proof runs on testnet, with an outside audit still to come. That's why it's early access, not "use it today." All domestic — no money sent abroad. Saying the stage out loud is a sign you can trust us.</>,
    cNetwork: "Wallet", cNetworkV: "Self-custody · no password to memorize (in build)",
    cAudit: "Pix", cAuditV: "Via licensed partner · still being defined",
    cBound: "Agent limit", cBoundV: "Test network · outside audit to come",
    cChain: "Scope", cChainV: "Domestic · no sending abroad",
    mainnetLabel: "Already live on Stellar mainnet",
    mainnetBody: "The Slippay contract, a real USDC transaction and a biometric-authorized payment are settled on Stellar's public network — not testnet, not a mockup. Verify on-chain:",
    mainnetContract: "Mainnet contract",
    mainnetTx: "USDC transaction",
    mainnetBio: "Biometric payment",
    mainnetNote: "Verification transactions. The on-phone biometric tap against mainnet and the full loop with a customer and Pix are still early access.",
  },
  cta: {
    kicker: "005 · Next step",
    h2: <>The dollar that's yours,<br/><em className="font-light">on Pix when you choose.</em></>,
    body: "Join the early-access list. We'll tell you the moment the loop — receive, hold, turn into reais on Pix — is live with the licensed partner. No sending abroad.",
    button: "Keep my dollars in dollars",
    spec: "For builders: read the spec",
  },
  footer: {
    product: "┃ Product", resources: "┃ Resources", legal: "┃ Legal",
    fSignup: "Join the list", fLogin: "Log in", fHow: "How it works",
    fApi: "API reference", fGuides: "Guides", fAudits: "Audit · outside audit to come", fX402: "x402 standard", fSsl: "Spec ↗",
    fTerms: "Terms", fPrivacy: "Privacy",
  },
};

export const homeCopy: Record<Lang, HomeStrings> = { pt, en };
