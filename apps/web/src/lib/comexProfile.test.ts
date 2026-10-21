import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCompanyDoc, setCompanyDoc, isValidDoc } from "./comexProfile.ts";

// The UI normalizes masked input to digits before validating (Exchange.tsx).
const normalize = (raw: string): string => raw.replace(/\D/g, "");

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
}

const VALID_CPF = "52998224725";   // 11 digits
const VALID_CNPJ = "11222333000181"; // 14 digits

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isValidDoc — CPF (11) / CNPJ (14) digit-count rule", () => {
  it("accepts a valid 11-digit CPF and a valid 14-digit CNPJ", () => {
    expect(isValidDoc(VALID_CPF)).toBe(true);
    expect(isValidDoc(VALID_CNPJ)).toBe(true);
  });

  it("rejects documents with the wrong digit count", () => {
    for (const n of [0, 1, 10, 12, 13, 15, 20]) {
      expect(isValidDoc("1".repeat(n))).toBe(false);
    }
  });

  it("normalizes masked input before validating (CPF .- and CNPJ ./ masks)", () => {
    expect(normalize("529.982.247-25")).toBe(VALID_CPF);
    expect(isValidDoc(normalize("529.982.247-25"))).toBe(true);

    expect(normalize("11.222.333/0001-81")).toBe(VALID_CNPJ);
    expect(isValidDoc(normalize("11.222.333/0001-81"))).toBe(true);
  });

  it("rejects non-numeric input once normalized", () => {
    expect(normalize("abc-def")).toBe("");
    expect(isValidDoc(normalize("abc-def"))).toBe(false);
  });

  it("accepts an all-same-digit number today — the rule is length-only (known 4P gap)", () => {
    // The module does not implement the usual repeated-digit CPF/CNPJ check;
    // this pins current behavior so a future fix changes this test.
    expect(isValidDoc("1".repeat(11))).toBe(true);
    expect(isValidDoc("0".repeat(14))).toBe(true);
  });
});

describe("company document persistence (localStorage)", () => {
  it("stores and reads back a document keyed by the lowercased wallet address", () => {
    setCompanyDoc("0xABC", VALID_CPF);

    expect(getCompanyDoc("0xabc")).toBe(VALID_CPF);
    expect(getCompanyDoc("0xABC")).toBe(VALID_CPF);
    expect(localStorage.getItem("slippay.comex.doc.0xabc")).toBe(VALID_CPF);
  });

  it("returns an empty string for an unknown or missing account", () => {
    expect(getCompanyDoc("0xdead")).toBe("");
    expect(getCompanyDoc(null)).toBe("");
    expect(getCompanyDoc(undefined)).toBe("");
    expect(getCompanyDoc("")).toBe("");
  });

  it("ignores writes when there is no account", () => {
    setCompanyDoc(null, VALID_CPF);
    expect(localStorage.length).toBe(0);
  });

  it("degrades gracefully when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      length: 0,
    });

    expect(getCompanyDoc("0xabc")).toBe("");
    expect(() => setCompanyDoc("0xabc", VALID_CPF)).not.toThrow();
  });
});
