import { describe, it, expect } from "vitest";
import {
  PRODUCTION_ORIGINS,
  LOCAL_DEV_ORIGINS,
  ALLOWED_ORIGINS,
  ALLOWED_ORIGINS_SET,
  ALLOWED_ORIGINS_RE,
  DEV_TUNNEL_HOSTS,
  isAllowedOrigin,
} from "../src/index.ts";

describe("packages/shared origin allowlists", () => {
  describe("Production and dev origins integrity", () => {
    it("defines canonical production origins with HTTPS", () => {
      expect(PRODUCTION_ORIGINS).toEqual([
        "https://app.slippay.cc",
        "https://slippay.cc",
      ]);
      for (const origin of PRODUCTION_ORIGINS) {
        expect(origin.startsWith("https://")).toBe(true);
      }
    });

    it("defines local dev origins", () => {
      expect(LOCAL_DEV_ORIGINS).toEqual([
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ]);
    });

    it("clearly separates dev-only tunnel hosts from production origins", () => {
      expect(DEV_TUNNEL_HOSTS).toContain(".loca.lt");
      expect(DEV_TUNNEL_HOSTS).toContain(".ngrok-free.app");
      expect(DEV_TUNNEL_HOSTS).toContain(".ngrok.app");
      expect(DEV_TUNNEL_HOSTS).toContain(".trycloudflare.com");

      // Verify dev-tunnel hosts are not part of production origins
      for (const tunnel of DEV_TUNNEL_HOSTS) {
        for (const prodOrigin of PRODUCTION_ORIGINS) {
          expect(prodOrigin).not.toContain(tunnel);
        }
      }
    });

    it("populates ALLOWED_ORIGINS and ALLOWED_ORIGINS_SET with all allowed origins", () => {
      expect(ALLOWED_ORIGINS).toEqual([
        ...PRODUCTION_ORIGINS,
        ...LOCAL_DEV_ORIGINS,
      ]);
      expect(ALLOWED_ORIGINS_SET.size).toBe(4);
      expect(ALLOWED_ORIGINS_SET.has("https://app.slippay.cc")).toBe(true);
      expect(ALLOWED_ORIGINS_SET.has("https://slippay.cc")).toBe(true);
      expect(ALLOWED_ORIGINS_SET.has("http://localhost:5173")).toBe(true);
      expect(ALLOWED_ORIGINS_SET.has("http://127.0.0.1:5173")).toBe(true);
    });
  });

  describe("Origin validation and lookalike rejection", () => {
    it("passes each valid allowed origin via regex and helper", () => {
      const validOrigins = [
        "https://app.slippay.cc",
        "https://slippay.cc",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ];

      for (const origin of validOrigins) {
        expect(ALLOWED_ORIGINS_RE.test(origin), `Expected ${origin} to pass regex`).toBe(true);
        expect(isAllowedOrigin(origin), `Expected ${origin} to be allowed`).toBe(true);
      }
    });

    it("rejects lookalike domains attempting to spoof slippay.cc", () => {
      const spoofOrigins = [
        "https://slippay.cc.evil.tld",
        "https://app.slippay.cc.evil.tld",
        "https://slippay.cc.attacker.com",
        "https://evil-slippay.cc",
        "https://fake-app.slippay.cc",
        "https://app.slippay.cc:8080",
        "http://slippay.cc", // HTTP instead of HTTPS
        "http://app.slippay.cc",
        "https://admin.slippay.cc", // unauthorized subdomain
        "https://staging.slippay.cc",
        "http://evil.com/http://localhost:5173",
        "http://localhost:5174", // wrong dev port
        "https://example.com",
      ];

      for (const spoof of spoofOrigins) {
        expect(ALLOWED_ORIGINS_RE.test(spoof), `Expected spoof ${spoof} to fail regex`).toBe(false);
        expect(isAllowedOrigin(spoof), `Expected spoof ${spoof} to be rejected`).toBe(false);
      }
    });

    it("rejects empty or nullish origins safely", () => {
      expect(isAllowedOrigin(null)).toBe(false);
      expect(isAllowedOrigin(undefined)).toBe(false);
      expect(isAllowedOrigin("")).toBe(false);
    });
  });
});
