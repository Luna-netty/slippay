import { describe, it, expect, vi, afterEach } from "vitest";
import { DARK, dk } from "./darkTheme.ts";

// Contract under test: docs/product/locale-strategy.md.
// darkTheme.ts is a static token module — no toggle, no prefers-color-scheme,
// no localStorage. These tests pin the defaults and the "no persistence" rule.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("DARK — default tokens", () => {
  it("pins the Secuury/V3 palette", () => {
    expect(DARK).toEqual({
      bg: "#0a0e1a",
      bg2: "#0d1322",
      ink: "#f3f5fb",
      muted: "#8a93ad",
      cyan: "#22d3ee",
      cyan2: "#38bdf8",
      line: "rgba(255,255,255,0.08)",
      ok: "#34d399",
      leak: "#fb7185",
    });
  });
});

describe("dk — class fragments stay on the DARK tokens", () => {
  it("builds the page/panel/muted/accent classes from the pinned tokens", () => {
    expect(dk.page).toBe(`min-h-screen bg-[${DARK.bg}] text-[${DARK.ink}]`);
    expect(dk.panel).toBe(`bg-[${DARK.bg2}] border border-white/10 rounded-2xl`);
    expect(dk.muted).toBe(`text-[${DARK.muted}]`);
    expect(dk.accent).toBe(`text-[${DARK.cyan}]`);
  });

  it("keeps the CTA gradient on cyan → cyan2", () => {
    expect(dk.cta).toContain(`from-[${DARK.cyan}]`);
    expect(dk.cta).toContain(`to-[${DARK.cyan2}]`);
    expect(dk.cta).toContain("bg-gradient-to-r");
  });

  it("keeps the ghost/label/card fragments on ink, cyan and bg2", () => {
    expect(dk.ghost).toContain(DARK.ink);
    expect(dk.ghost).toContain(DARK.cyan);
    expect(dk.label).toContain(DARK.muted);
    expect(dk.card).toContain(DARK.bg2);
    expect(dk.card).toContain(DARK.cyan);
  });

  it("exposes exactly the shared fragments, all as readonly strings", () => {
    expect(Object.keys(dk).sort()).toEqual(
      ["accent", "card", "cta", "ghost", "label", "muted", "page", "panel"],
    );
    for (const v of Object.values(dk)) expect(typeof v).toBe("string");
  });
});

describe("persistence — the theme is never persisted", () => {
  it("performs zero localStorage access when imported", async () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem, setItem });

    const fresh = await import("./darkTheme.ts");

    expect(fresh.DARK).toEqual(DARK);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("exposes no runtime theme switch — the exports are static data only", async () => {
    const fresh = await import("./darkTheme.ts");
    expect(Object.keys(fresh).sort()).toEqual(["DARK", "dk"]);
    for (const v of Object.values(fresh)) expect(typeof v).toBe("object");
  });
});
