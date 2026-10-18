# AUTHORSHIP & INTELLECTUAL PROPERTY DECLARATION
## Declaração de Autoria e Propriedade Intelectual — Slippay

**Author / Sole creator — Autor / Criador único:**
**Manuel Guilherme Galmanus**

**Owning entity — Titular:** Bluewave AI · CNPJ **66.381.800/0001-08** · Blumenau, Santa Catarina, Brasil
**Contact:** manuel@bluewaveai.online · +55 47 9745-5602

**Declaration date — Data da declaração:** 2026-06-01

---

## 1. Declaration — Declaração

I, **Manuel Guilherme Galmanus**, declare that I am the **sole author, inventor and copyright owner** of the work known as **"Slippay"** — its source code, smart-contract architecture, cryptographic design, protocol specifications, written copy, visual design and all derivative artifacts contained in this repository — conceived and authored by me.

Eu, **Manuel Guilherme Galmanus**, declaro ser o **único autor, inventor e titular dos direitos autorais** da obra denominada **"Slippay"** — seu código-fonte, arquitetura de contratos inteligentes, desenho criptográfico, especificações de protocolo, textos, design visual e todos os artefatos derivados contidos neste repositório, concebidos e desenvolvidos por mim.

All rights are reserved by the author. Copyright authorship is asserted independently of any distribution license present in this repository; the license governs use, **not** authorship or ownership.

Todos os direitos reservados ao autor. A autoria e titularidade dos direitos autorais são afirmadas de forma independente de qualquer licença de distribuição presente neste repositório; a licença rege o **uso**, não a autoria nem a titularidade.

---

## 2. Original works authored — Obras originais de autoria

Non-exhaustive list of original technical works created by the author:

- **Slippay payment architecture** — a PIX↔Stellar dollar-payments rail ("a dollar account that lives in Pix").
- **On-chain biometric authorization** — a Soroban smart-wallet whose `__check_auth` verifies a **real WebAuthn (passkey / Face ID) assertion** on-chain (base64url challenge binding + `SHA256(authenticatorData ‖ SHA256(clientDataJSON))` digest + native secp256r1 verification). Authoring a payment from a device biometric, verified by the contract, with no seed phrase.
- **Provably-bounded autonomous-agent payments** — delegated ed25519 agent sessions with on-chain windowed-budget + allowlist + immutable absolute-ceiling enforcement, plus a recipient-redirection guard (consent pinned at charge time).
- **`axlc`** — a Rust SMT-backed compiler/verifier for agent spending bounds (`bind` / `constrain` / `prove` / `invariant`).
- **SEP-24 off-ramp integration**, the QR payment-request format, and the browser passkey-pay client library.
- **Autonomous agent-to-agent (A2A) payment circuit** — a buyer agent that, **with no human in the loop**, settles a seller agent's HTTP-402 charge in USDC, gated by a **non-custodial signed spending mandate** and a **portable ed25519 agent-integrity attestation** (verifiable on-chain *and* offline), recording a **signed audit registry** of every payment (who paid whom, how much, under which mandate). Proven end-to-end on Stellar mainnet (§3).
- **Agent-integrity attestation (AIA)** — an integrity oracle answering the question payment rails do not ("is this agent still operating inside its committed surface?") as a portable ed25519 verdict the Soroban gate verifies on-chain and any off-chain party verifies too.
- **Zero-knowledge proofs (Groth16, Stellar mainnet)** — proof-of-mandate and proof-of-KYC (age + sanctions), zero-PII, with an on-chain verifier.
- **Comex B2B treasury (Base/EVM)** — a non-custodial corporate (non-biometric; email + MFA) dollar account: holds USDC, sends/receives, and buys R$→USD through a licensed FX partner, with the WYSIWYS signing gate ported to EVM (viem), transparent fee disclosure and live exchange-rate quoting.
- The accompanying **SSL agent specifications** and the cognitive/operational architecture authored by the same individual.

---

## 3. IMMUTABLE ON-CHAIN EVIDENCE OF CREATION — Prova imutável de criação (Stellar mainnet)

The following are **public, cryptographically timestamped, tamper-proof** records on the **Stellar public network (mainnet)**, each **signed by the author's own deployer key**. A blockchain ledger cannot be back-dated or forged; these establish the existence and creation date of the work with cryptographic certainty.

A seguir, registros **públicos, criptograficamente datados e impossíveis de adulterar** na **rede principal do Stellar**, cada um **assinado pela chave do próprio autor**. Um ledger blockchain não pode ser pré-datado nem forjado; estes estabelecem a existência e a data de criação da obra com certeza criptográfica.

**Author's signing key (deployer) — Chave assinante do autor:**
`GCEYFLGNHCW4EIEX5LAVYGIGPT2KLHHVB6EOUWKKALA2FT7RMCHI242P`

| Artifact | Identifier | Timestamp (UTC) | Ledger |
|---|---|---|---|
| Subscription contract (mainnet) | `CBJMQ6ZYQJ2OMM46FGXPEIKKZDRHHERBXUVE54ZN64FDPKN5DJKSEVQN` | 2026-05-16 | — |
| └ deploy tx | `cb90fccdc7b6c4d7cea33d5bc22ecc9083d4ac1c4e22c9e3cfd4f7d57f170d81` | 2026-05-16 21:27:27 | 62599887 |
| Smart-wallet wasm (mainnet, WebAuthn verifier) | hash `497adb62a98134658ab04edb8a7a4dd9b008432bfa5c0a38f8ec95cc07f5fe83` | 2026-06-01 | — |
| Real USDC payment (mainnet) | `05ae429b926d94770166e3425c77210260d2db0083fa81053059612775e510be` | 2026-06-01 19:30:44 | 62837330 |
| **Biometric-authorized payment (mainnet)** | `d9a7d17a18719ece53535d51423b8951f37b163e170a7bea2cb4d9588471ec31` | 2026-06-01 22:05:01 | 62838907 |
| **Autonomous agent-to-agent payment (mainnet)** | `34eb71b1c4446bf1b39a1d811370f93c24188e61458d56a126957b13d4eea13b` | 2026-06-26 12:16:54 | 63206144 |

Each is independently verifiable at `https://stellar.expert/explorer/public/tx/<hash>` and `https://horizon.stellar.org/transactions/<hash>`.

Supporting testnet records (development authorship trail): biometric pay `5b1d7d0a93cea5ede31ec2209e6e306b1730ac1f219ceae181fa9a292d16ac96`; bounded agent→agent `d845db5b868d108630123d200e499562bbb7ba049757a50b7942b528aede4179`; autonomous agent-to-agent x402 **full loop** (charge → autonomous pay → settle → delivery) `61db50c6ec5b6c6890045c4fe09b3c76bf7baa506a54af3c22da491cf81d55f1` (ledger 3291957, 2026-06-26).

---

## 4. Authorship trail — Trilha de autoria

- This Git repository, with its commit history signed/authored under the author's name, constitutes a continuous timestamped record of creation.
- The mainnet artifacts in §3 anchor that record to an immutable public ledger.

---

## 5. Reservation of rights — Reserva de direitos

© 2026 Manuel Guilherme Galmanus / Bluewave AI. The author asserts moral and economic authorship rights over the works described herein under applicable Brazilian (Lei 9.610/1998, Lei 9.609/1998) and international copyright law. This declaration is evidence of authorship and ownership and does not waive any right.

© 2026 Manuel Guilherme Galmanus / Bluewave AI. O autor afirma os direitos morais e patrimoniais de autor sobre as obras aqui descritas, nos termos da legislação brasileira (Lei 9.610/1998, Lei 9.609/1998) e internacional de direitos autorais. Esta declaração é prova de autoria e titularidade e não importa em renúncia de qualquer direito.

---

*Signed / Assinado:* **Manuel Guilherme Galmanus** — 2026-06-01
*Updated / Atualizado:* 2026-06-26 — added the comex B2B treasury (Base) and the autonomous agent-to-agent payment circuit, proven on Stellar mainnet (§3).
