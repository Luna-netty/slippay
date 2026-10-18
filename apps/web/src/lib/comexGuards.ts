// Corporate spending guards (phase 1, app-level). Above a threshold, a transfer
// needs a second approver before it can be authorized. Audit log records who did what.

/** True if the USD amount needs a second approver (>= the configured limit). */
export function requiresApproval(amountUsd: string, limitUsd: string): boolean {
  const a = Number(amountUsd);
  const l = Number(limitUsd);
  if (!Number.isFinite(a) || !Number.isFinite(l)) return true; // fail closed
  return a >= l;
}

export interface AuditEntry {
  at: string; actor: string; action: string; amount?: string; destination?: string; txHash?: string;
}

const AUDIT_KEY = "comex_audit_log";

/** Append an audit entry (local, append-only view). */
export function logAction(entry: AuditEntry): void {
  try {
    const cur = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]") as AuditEntry[];
    cur.push(entry);
    localStorage.setItem(AUDIT_KEY, JSON.stringify(cur));
  } catch { /* non-fatal */ }
}

export function readAudit(): AuditEntry[] {
  try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]") as AuditEntry[]; } catch { return []; }
}

/** Configured approval threshold in USD (env, default 5000). */
export function approvalLimitUsd(): string {
  return (import.meta.env.VITE_COMEX_APPROVAL_USD as string | undefined) ?? "5000";
}
