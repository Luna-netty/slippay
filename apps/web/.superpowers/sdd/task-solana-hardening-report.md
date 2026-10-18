# task-solana-hardening-report

date: 2026-06-23
status: DONE
commit: 812b84a
tests: 50/50 pass (vitest run)
tsc: 0 errors (npx tsc --noEmit -p apps/web)
build: exit 0 (VITE_COMEX_ENABLED=1 npx vite build, 26s)

fixes applied:
- [I-1] solanaAuthorize.ts: split sendRawTransaction (sig captured) + confirmTransaction in separate try; return { signature, confirmed }; Send.tsx + Exchange.tsx show "enviado, confirmando..." state on confirmed=false
- [I-2] solanaAuthorize.ts: confirm callback now receives ownerAddress (base58 owner, not ATA); Send.tsx + Exchange.tsx pass ownerAddress as modal destination; new test asserts ownerAddress == TO.toBase58()
- [I-3] Exchange.tsx: PINNED_4P_RECEIVER = import.meta.env.VITE_4P_OFFRAMP_RECEIVER; sell disabled if unset; ordData.receiver !== PINNED_4P_RECEIVER blocks before sign; documented in .env.comex.example
- [M-1] solanaAuthorize.ts decodeUsdcTransfer: validates data[0] === 12 (TransferChecked discriminant) before any decode; throws "instrução SPL inesperada (não é TransferChecked)"; 2 new tests added
- [M-3] comexSolana.tsx: wallets[0] guarded with length check (wallets.length > 0 ? wallets[0] : undefined); tsc confirms ConnectedStandardSolanaWallet has no walletClientType field
