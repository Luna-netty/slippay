# Slippay — Tesouraria/Câmbio B2B Comex · Fase 1 (design)

**Data:** 2026-06-22
**Objetivo:** colocar o Slippay funcionando, em produção, **para UMA empresa** (cliente de peças de avião/comex), o mínimo para o sócio Mário fechar o contrato.

## Escopo (fase 1 — só este cliente)
Quatro capacidades, em produção, na rede Stellar, non-custodial:
1. **Conta da empresa** — carteira corporativa, login e-mail/senha, **sem biometria**, **non-custodial** (a empresa controla, Slippay nunca segura a chave).
2. **Trocar R$ ↔ USD** — câmbio via **PagFinance** (parceiro licenciado, em Stellar).
3. **Enviar e receber** USDC.
4. **Render** o USD parado — **DeFindex** (num toque, autorizado pela empresa).

**Fora de escopo (fases futuras):** multi-tenant/onboarding self-service de várias empresas, auto-sweep de yield sem interação, camada ZK de KYC/atestação, integração 4P.

## Stack (tudo em Stellar, tudo non-custodial)
| Peça | Solução | Estado |
|---|---|---|
| Carteira corporativa | **Privy user/client wallet** (e-mail/senha, TEE, Ed25519 raw-sign) | a construir |
| Câmbio R$↔USD | **PagFinance** (Stellar, `blockchain: stellar`) | `lib/pagfinance.ts` existe |
| Enviar/receber USDC | `lib/stellar.ts` (`buildUsdcPaymentTx`) + Privy raw-sign | existe (assinatura via Wallets Kit hoje; trocar p/ Privy) |
| Render | **DeFindex** | `lib/defindex.ts` integrado |

### Decisão de custódia (a viga — mantém fora do VASP)
- **Privy USER wallet, não server wallet.** A empresa autentica e autoriza; Slippay nunca controla a chave. O guia oficial DeFindex+Privy usa *server* wallet (automação) — **não seguir isso**, porque servidor-detém-chave = custodial = VASP.
- Assinatura Stellar: montar XDR → hash → `privy.rawSign` (Ed25519) → anexar `DecoratedSignature` → submeter. Mesmo mecanismo do guia, mas autorização do lado da empresa.
- Yield = ação explícita ("aplicar agora"), não auto-sweep. Auto-sweep exigiria autoridade delegada → fase 2 + revisão jurídica.

### Regulatório (não-bloqueante se a estrutura for respeitada)
- "Trocar R$↔USD" pra comex = **câmbio**. A perna de câmbio roda **na PagFinance (licenciada)**; Slippay é só a plataforma non-custodial. Confirmar com a PagFinance a estrutura "ela origina o câmbio".
- Non-custodial (user wallet) mantém Slippay fora das obrigações de custódia (BCB 519/520/521). Informativo, não é parecer jurídico — validar com advogado antes de produção.

## Referências
- Privy chains: suporta Ed25519 (Stellar) via raw-sign — https://docs.privy.io/wallets/overview/chains
- Guia DeFindex+Privy (usa server wallet — adaptar p/ user wallet): https://github.com/paltalabs/privy-defindex-guide
- DeFindex API: https://api.defindex.io/docs

## Gate antes de codar a carteira
A carteira é a única peça perigosa (custódia, recuperação sem seed, multi-usuário). **Threat-model dela antes de implementar.**

## Critério de "pronto" (fase 1)
A empresa de peças de avião consegue, em produção: entrar na conta, trocar R$↔USD, enviar/receber USDC, e aplicar o saldo pra render — sem Slippay nunca segurar os fundos. Mário fecha em cima disso.
