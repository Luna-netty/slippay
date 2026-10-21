// Persistent one-touch account. The user's passkey-bound smart wallet IS their
// account — no email, no password. Stored locally so they return to it.

export type Account = {
  walletId: string;
  credIdHex: string;
  pubKeyHex: string;
  network: "TESTNET" | "PUBLIC";
  funded: string;
  createdAt: string;
};

const KEY = "slippay.account.v1";

export function loadAccount(): Account | null {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
export function saveAccount(a: Account): void {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* private mode */ }
}
export function clearAccount(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
