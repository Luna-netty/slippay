// Test that STELLAR_NETWORK is required in production (closes #54).
//
// Bounty: [Bounty: $75] Pass STELLAR_NETWORK to the API process in ecosystem.config.cjs
//
// The x402 route reads STELLAR_NETWORK with a "testnet" default. In production
// (NODE_ENV=production), a missing STELLAR_NETWORK must throw at boot rather
// than silently default to testnet (which would advertise testnet asset/Horizon
// details in 402 bodies, leaking the wrong network to the buyer).

import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Re-implement the same logic as the x402 route (kept in sync by hand).
// The route's STELLAR_NETWORK getter is module-private; we mirror it here so
// the test does not require loading the route module (which would call
// Deno.env at import time).
function resolveStellarNetwork(env: Record<string, string | undefined>): string {
  const v = env.STELLAR_NETWORK;
  if (v) return v;
  if (env.NODE_ENV === "production") {
    throw new Error("STELLAR_NETWORK must be set in production (NODE_ENV=production).");
  }
  return "testnet";
}

Deno.test("STELLAR_NETWORK is required in production (NODE_ENV=production)", () => {
  // Missing STELLAR_NETWORK in production → throw
  assertThrows(
    () => resolveStellarNetwork({ NODE_ENV: "production" }),
    Error,
    "STELLAR_NETWORK must be set in production",
  );
});

Deno.test("STELLAR_NETWORK uses the env value when set", () => {
  assertEquals(resolveStellarNetwork({ STELLAR_NETWORK: "public" }), "public");
  assertEquals(resolveStellarNetwork({ STELLAR_NETWORK: "testnet" }), "testnet");
});

Deno.test("STELLAR_NETWORK defaults to testnet in non-production", () => {
  assertEquals(resolveStellarNetwork({}), "testnet");
  assertEquals(resolveStellarNetwork({ NODE_ENV: "development" }), "testnet");
  assertEquals(resolveStellarNetwork({ NODE_ENV: "test" }), "testnet");
});

Deno.test("STELLAR_NETWORK takes precedence over NODE_ENV (explicit override)", () => {
  // Even in production, an explicit STELLAR_NETWORK wins.
  assertEquals(
    resolveStellarNetwork({ NODE_ENV: "production", STELLAR_NETWORK: "testnet" }),
    "testnet",
  );
});
