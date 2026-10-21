-- Canonical platform fee set to 2.97% (297 bp).
-- Supersedes 20260526114600_platform_fee_98bp.sql (which set 98 bp).
-- Matches DEFAULT_PLATFORM_FEE_BP in packages/shared/src/constants.ts.
--
-- Apply during the prod sync: prod's live DB still carries the older default.

alter table merchants alter column platform_fee_bp set default 297;

-- Bring existing merchants still on a prior default onto the canonical rate.
-- Only touches rows left at a known default (98 or 100); merchants with a
-- deliberately customized fee are left untouched.
update merchants set platform_fee_bp = 297 where platform_fee_bp in (98, 100);
