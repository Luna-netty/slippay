# Final Fixes Report — feat/comex-treasury-phase1

**Status:** all 5 fixes applied, verified, committed

**Commit:** 40429e6 — `fix(comex): enforce MFA gate, un-blind DeFindex confirm, honest dual-control label, type/memo cleanups`

**tsc:** 0 errors (`npx tsc --noEmit -p apps/web`)

**vitest:** 36 passed, 0 failed (8 test files)

**vite build:** exit 0, built in 24.89s (pre-existing chunk-size warning, not an error)

## Fixes applied

1. **Comex.tsx** — MFA gate: blocks `ComexDashboard` when `user.mfaMethods.length === 0`, shows enrollment prompt with `showMfaEnrollmentModal()`.
2. **ConfirmTxModal.tsx** — added `intent?: string` prop, rendered bold above decoded summary.
3. **Yield.tsx** — deposit passes `intent: "Depósito de ${amount} USDC no cofre de rendimento (${vaultDisplay})"`, withdraw passes `intent: "Resgate de ${amount} USDC do cofre de rendimento"`.
4. **Send.tsx / Exchange.tsx** — second-approver checkbox relabeled to be honest about self-attestation and phase-2 roadmap.
5. **comexPrivy.tsx** — removed erroneous `as \`0x${string}\`` cast from `hexHash` (the `0x` prefix is already in the template literal on the next line).
6. **txguard.ts** — memo guard now only sets memo when `tx.memo.type === "text" && typeof tx.memo.value === "string"`, preventing Buffer/binary memo bleed.
