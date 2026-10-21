// Per-account company document (CPF/CNPJ), stored once and reused so the sell
// flow never asks for it again. 4P requires `person_document` on every off-ramp
// (their docs mark it Required); collecting it once keeps the per-sale flow to
// just amount + Pix key. Not a secret — a cadastral field. Phase 1: localStorage
// keyed by wallet address; phase 2 can move it to account metadata.

const key = (address: string) => `slippay.comex.doc.${address.toLowerCase()}`;

export function getCompanyDoc(address: string | null | undefined): string {
  if (!address) return "";
  try {
    return localStorage.getItem(key(address)) ?? "";
  } catch {
    return "";
  }
}

export function setCompanyDoc(address: string | null | undefined, doc: string): void {
  if (!address) return;
  try {
    localStorage.setItem(key(address), doc);
  } catch {
    /* storage unavailable — fall back to in-memory for this session */
  }
}

/** A document is valid if it is an 11-digit CPF or a 14-digit CNPJ (digits only). */
export function isValidDoc(digits: string): boolean {
  return digits.length === 11 || digits.length === 14;
}
