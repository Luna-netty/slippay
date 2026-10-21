# Solana câmbio panel — task report

## Status

Commit: d695151 on feat/comex-treasury-phase1  
tsc: clean (0 errors)  
Vite build: successful (37.4s) — chunk size warning is pre-existing, not introduced here

## What is wired vs pending

### Buy (R$ -> USDC) — WIRED
- `status4p()` gates the panel; shows "câmbio em ativação" if `enabled=false`
- `quote4p(brl)` live on BRL input change
- `createOnramp4p({ amountBrl, receiverWallet, email, cpf })` on confirm — exact param names from ramp4p.ts
- Pix copia-e-cola displayed; polls `getOnramp4p(id)` every 4s until DONE_STATUSES

### Sell (USDC -> R$) — STRUCTURED, PENDING 4P off-ramp endpoint
- `quoteOfframp4p(usdc)` POST /v1/4p/offramp/quote — returns null fields gracefully on 503/404 (endpoint not live)
  - If brlOut is null after a valid input, panel shows "venda em ativação — endpoint 4P pendente" (no crash)
- `createOfframp4p({ usdc, pixKey, sender })` POST /v1/4p/offramp — gets receiver address + amount
- `authorizeSolanaPayment({ connection, from, to, usdcAmount, signTransaction, confirm })` — full gate: build->decode->assert->human_confirm->sign->send
- ConfirmTxModal wired (same pattern as Send.tsx)
- On-chain send failure after signature: shows "confirmando com a 4P" recovery state with the solscan link — never false success
- `getOfframp4p(id)` polls every 4s until settlement

## Exact 4P params used

### ramp4p.ts additions
- `quoteOfframp4p(usdc)` — body: `{ amountUsdc: usdc }` — POST /v1/4p/offramp/quote
- `createOfframp4p({ usdc, pixKey, sender })` — body: `{ amountUsdc, pixKey, senderWallet }` — POST /v1/4p/offramp
- `getOfframp4p(id)` — GET /v1/4p/offramp/:id

### authorizeSolanaPayment call (Exchange.tsx sell path)
```ts
authorizeSolanaPayment({
  connection: new Connection(rpcUrl()),
  from: new PublicKey(address),
  to: new PublicKey(ordData.receiver),  // from createOfframp4p response
  usdcAmount: ordData.amount,           // from createOfframp4p response
  signTransaction,                      // from useComexSolanaWallet()
  confirm: (decoded) => openConfirmModal(decoded),
})
```

## Files changed
- `apps/web/src/lib/ramp4p.ts` — added Offramp4pQuote interface + quoteOfframp4p + createOfframp4p + getOfframp4p
- `apps/web/src/pages/comex/solana/Exchange.tsx` — new file (BuyPanel + SellPanel + Exchange root with direction toggle)
- `apps/web/src/pages/comex/solana/Dashboard.tsx` — replaced Câmbio placeholder with `<Exchange />`
