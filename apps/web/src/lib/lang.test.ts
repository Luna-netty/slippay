import { describe, it, expect, vi, afterEach } from "vitest";
import { detectLang, persistLang, isLang, LANG_KEY, type Lang } from "./lang.ts";

// Contract under test: docs/product/locale-strategy.md.
// Canonical key is "slippay_lang"; "slippay.lang" is the legacy per-page key
// used by pages that predate this helper (they are independent stores).
const LEGACY_KEY = "slippay.lang";

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

type Storage = ReturnType<typeof memoryStorage>;

function stubBrowser(opts: { language?: string; storage?: Storage } = {}) {
  const storage = opts.storage ?? memoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("navigator", opts.language === undefined ? {} : { language: opts.language });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isLang — the only legal locale values", () => {
  it("accepts exactly pt and en", () => {
    expect(isLang("pt")).toBe(true);
    expect(isLang("en")).toBe(true);
  });

  it("rejects unsupported values, including case variants of the real locales", () => {
    for (const v of ["fr", "", "PT", "EN", "pt-BR", "en-US", null, undefined, 42]) {
      expect(isLang(v)).toBe(false);
    }
  });
});

describe("detectLang — detection order", () => {
  it("defaults to pt when there is no window (SSR / tests)", () => {
    expect(typeof window).toBe("undefined");
    expect(detectLang()).toBe("pt");
  });

  it("uses pt for a PT browser when nothing is stored", () => {
    stubBrowser({ language: "pt-BR" });
    expect(detectLang()).toBe("pt");
  });

  it("uses en only for an explicitly English browser", () => {
    stubBrowser({ language: "en-US" });
    expect(detectLang()).toBe("en");
    vi.unstubAllGlobals();
    stubBrowser({ language: "en" });
    expect(detectLang()).toBe("en");
  });

  it("keeps the PT default for any non-PT, non-EN browser", () => {
    stubBrowser({ language: "fr-FR" });
    expect(detectLang()).toBe("pt");
    vi.unstubAllGlobals();
    stubBrowser({ language: "es-ES" });
    expect(detectLang()).toBe("pt");
  });

  it("falls back to pt when the browser exposes no language", () => {
    stubBrowser();
    expect(detectLang()).toBe("pt");
  });
});

describe("detectLang — persisted value wins over the browser", () => {
  it("returns a stored pt even on an English browser", () => {
    const storage = memoryStorage();
    storage.setItem(LANG_KEY, "pt");
    stubBrowser({ language: "en-US", storage });
    expect(detectLang()).toBe("pt");
  });

  it("returns a stored en even on a PT browser", () => {
    const storage = memoryStorage();
    storage.setItem(LANG_KEY, "en");
    stubBrowser({ language: "pt-BR", storage });
    expect(detectLang()).toBe("en");
  });
});

describe("detectLang — unsupported stored values are ignored", () => {
  it("falls through to the browser rule for garbage values", () => {
    for (const garbage of ["fr", "", "PT", "pt-BR", "nonsense"]) {
      const storage = memoryStorage();
      storage.setItem(LANG_KEY, garbage);
      stubBrowser({ language: "en-US", storage });
      expect(detectLang()).toBe("en");
      vi.unstubAllGlobals();
      stubBrowser({ language: "pt-BR", storage });
      expect(detectLang()).toBe("pt");
      vi.unstubAllGlobals();
    }
  });

  it("never reads the legacy per-page key", () => {
    const storage = memoryStorage();
    storage.setItem(LEGACY_KEY, "en");
    expect(LANG_KEY).not.toBe(LEGACY_KEY);
    stubBrowser({ language: "pt-BR", storage });
    expect(detectLang()).toBe("pt");
  });

  it("falls back to the browser rule when storage reads throw", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("window", { localStorage: blocked });
    vi.stubGlobal("localStorage", blocked);
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(detectLang()).toBe("en");
  });
});

describe("persistLang — persistence round-trip", () => {
  it("pins the canonical storage key", () => {
    expect(LANG_KEY).toBe("slippay_lang");
  });

  it("writes en under the canonical key, and detectLang reads it back", () => {
    stubBrowser({ language: "pt-BR" });
    persistLang("en");
    expect(localStorage.getItem(LANG_KEY)).toBe("en");
    expect(detectLang()).toBe("en");
  });

  it("writes pt so the choice sticks on an English browser", () => {
    stubBrowser({ language: "en-US" });
    persistLang("pt");
    expect(localStorage.getItem(LANG_KEY)).toBe("pt");
    expect(detectLang()).toBe("pt");
  });

  it("never persists an unsupported value", () => {
    stubBrowser({ language: "en-US" });
    persistLang("fr" as Lang);
    expect(localStorage.length).toBe(0);
    expect(detectLang()).toBe("en");
  });

  it("ignores writes when storage throws (private mode)", () => {
    const blocked = {
      setItem: () => {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("window", { localStorage: blocked });
    vi.stubGlobal("localStorage", blocked);
    vi.stubGlobal("navigator", { language: "pt-BR" });
    expect(() => persistLang("en")).not.toThrow();
    expect(detectLang()).toBe("pt");
  });
});
