# Slippay → Solana — plano de migração (iniciado 2026-06-17)

Decisão do operador: migrar o Slippay pra Solana (motivo: ecossistema — contato no
Superteam + grant/rede; Stellar não entregou SCF/grant). Migração **em paralelo**:
a Stellar fica viva (porquinho no ar) até a Solana funcionar. Nada é deletado.

## O que PORTA (mantém, ~zero reescrita)
- Frontend React inteiro: landing do porquinho, /cash, design, copy, decks.
- Integrações de ramp (4P/CriptoPix) — já miram EVM/Solana, não Stellar.
- Tese, marca, fluxos de UX.

## O que REESCREVE (camada on-chain → Solana, Rust/Anchor)
| Stellar (hoje) | Solana (alvo) | esforço |
|---|---|---|
| Carteira passkey (passkey-kit, Soroban smart wallet) | **Privy embedded wallet (Solana) com passkey/biometria** — CriptoPix já usa Privy; biometria nativa | médio (infra pronta) |
| Contrato de assinatura recorrente (Soroban CCT3…) | programa Anchor (recurring/mandate) | alto |
| Verifier ZK mainnet (Groth16 BN254, CBDS2YSL) | verifier ZK on Solana (a lógica de prova porta; on-chain refaz) | alto |
| axlc (mandate proof) | porta a lógica Rust; rebind on-chain | médio |
| agent_wallet / agent rail | programa Anchor | alto |
| relayer (gas sponsor Soroban) | fee payer Solana / Privy gasless | médio |

## Decisão de carteira (a chave da visão biométrica)
**Privy embedded wallet na Solana** = biometria/passkey, sem seed, carteira criada pra
o user. Mantém "tudo via biometria". (CriptoPix usa Privy → padrão provado no nosso caso.)
Alternativa: Solana passkey nativo (mais novo). Default: **Privy**.

## O GATE que sobrevive à migração (não é resolvido por migrar)
**Ramp Pix→USDC entregue numa carteira Solana.** Mesmo na Solana, precisa de um parceiro
licenciado. Candidatos: pixbr (faz Solana), CriptoPix (confirmar Solana), ou um parceiro
via **Superteam**. → confirmar ramp Solana ANTES de cortar.

## Ordem de execução (parallel-then-cutover)
1. **[plano — feito]** este doc.
2. Scaffold workspace Solana (Anchor + frontend wallet layer com Privy/Solana). NÃO toca no app live.
3. Carteira biométrica Solana (Privy) — provar criar + receber USDC.
4. Ligar o ramp (Pix→USDC→carteira Solana) — depende do parceiro.
5. Portar /cash pra a carteira Solana.
6. Programas Anchor: recurring → ZK → agent (na ordem de valor).
7. **Cutover:** trocar app.slippay.cc pra a versão Solana só quando 3–5 funcionarem. Stellar fica de backup.

## Validar com o contato Superteam (paralelo, não bloqueia o scaffold)
- grant/bounty que a Slippay pega? (qual, quanto, prazo)
- conexão com ramp Pix→USDC-Solana licenciado?
- créditos/infra (RPC, etc.)?

## Não-destrutivo
A Stellar (contratos mainnet, ZK verifier, SCF) NÃO é apagada. Fica como está; o moat
ZK/agente pode até reaparecer melhor na Solana (Superteam ama AI-agent + pagamentos).
